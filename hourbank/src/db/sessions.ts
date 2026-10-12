import { getDb } from './client';
import { Session, Student, ParentTravelMode } from './schema';
import { LedgerEntry } from './schema';
import { appendEntryInTx, currentBalance } from './ledger';
import { newId } from './uuid';
import { effectiveSubjectIdSql } from './migrations';
import { resolveSubjectIdInTx, getSubjectBalance, getPrimarySubjectId } from './subjects';
import { parentTravelCharge } from '../utils/travel';

// ── Typed errors ─────────────────────────────────────────────────────────────

export type SessionErrorCode =
  | 'NOT_FOUND'
  | 'NOT_STARTABLE'
  | 'ALREADY_ACTIVE'
  | 'OVER_OWE_LIMIT'
  | 'INVALID_STATE'
  | 'INVALID_INPUT';

export class SessionError extends Error {
  readonly code: SessionErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: SessionErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ? `${code}: ${message}` : code);
    this.name = 'SessionError';
    this.code = code;
    this.details = details;
    // Keep `instanceof` working when transpiled to ES5-style classes.
    Object.setPrototypeOf(this, SessionError.prototype);
  }
}

export function isSessionError(e: unknown, code?: SessionErrorCode): e is SessionError {
  return e instanceof SessionError && (code === undefined || e.code === code);
}

/** Lesson length assumed for owe checks when no booked length is known. */
export const DEFAULT_LESSON_MINUTES = 60;

const EPS = 1e-9;

// ── Reads ────────────────────────────────────────────────────────────────────

export function getSession(sessionId: string): Session | null {
  const db = getDb();
  return db.getFirstSync<Session>('SELECT * FROM sessions WHERE id = ?', [sessionId]) ?? null;
}

/** sessions.topics JSON → string[]; anything malformed reads as no topics. */
export function parseSessionTopics(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Persist the live timer's topic picks onto the in-flight session row so they
 * survive the app being killed (restored on resume / orphan recovery). Only an
 * active or paused lesson is touched; returns false otherwise. Sessions table
 * only — the ledger is never written here.
 */
export function saveLiveTopics(sessionId: string, topics: string[]): boolean {
  const db = getDb();
  const res = db.runSync(
    `UPDATE sessions SET topics = ? WHERE id = ? AND status IN ('active', 'paused')`,
    [JSON.stringify(topics), sessionId]
  );
  return res.changes > 0;
}

function mustGet(sessionId: string): Session {
  const s = getSession(sessionId);
  if (!s) throw new SessionError('NOT_FOUND', `Session ${sessionId} not found`);
  return s;
}

// ── Lesson travel (parent charge snapshot) ───────────────────────────────────

function assertValidKm(km: number | null | undefined): void {
  if (km !== undefined && km !== null && (!Number.isFinite(km) || km < 0)) {
    throw new SessionError('INVALID_INPUT', 'Travel km must be zero or more');
  }
}

/**
 * Km + parent travel charge to SNAPSHOT on a lesson being recorded. In-person:
 * km = explicit → booked → student default; charge at the student's CURRENT
 * parent rate. Online: no km, no charge. Call inside a transaction.
 */
function lessonTravelInTx(
  studentId: string,
  mode: Session['mode'],
  km: number | null | undefined,
  bookedKm: number | null | undefined,
): { travelKm: number | null; parentTravelFee: number } {
  if (mode === 'online') return { travelKm: null, parentTravelFee: 0 };
  const st = getDb().getFirstSync<{
    travel_distance_km: number | null;
    parent_travel_mode: ParentTravelMode | null;
    parent_travel_flat_fee: number | null;
    parent_travel_per_km: number | null;
  }>(
    'SELECT travel_distance_km, parent_travel_mode, parent_travel_flat_fee, parent_travel_per_km FROM students WHERE id = ?',
    [studentId]
  );
  const travelKm = km ?? bookedKm ?? st?.travel_distance_km ?? 0;
  return {
    travelKm,
    parentTravelFee: parentTravelCharge({
      lessonMode: 'in_person',
      parentTravelMode: st?.parent_travel_mode ?? 'none',
      flatFee: st?.parent_travel_flat_fee ?? 0,
      perKm: st?.parent_travel_per_km ?? 0,
      km: travelKm,
    }),
  };
}

// ── Create ───────────────────────────────────────────────────────────────────

export function createScheduled(data: {
  studentId: string;
  /** Lesson subject; omitted = the student's primary subject. */
  subjectId?: string | null;
  scheduledFor: string;
  estimatedDurationMinutes: number;
  mode: Session['mode'];
  session_type: Session['session_type'];
  topics?: string[];
  notes?: string;
  /** Km override for this lesson; omitted/null = student default. */
  travelKm?: number | null;
}): Session {
  const db = getDb();
  const id = newId();
  const now = new Date().toISOString();
  const topicsJson = JSON.stringify(data.topics ?? []);
  assertValidKm(data.travelKm);
  const travelKm = data.travelKm ?? null;
  let subjectId = '';

  db.withTransactionSync(() => {
    subjectId = resolveSubjectIdInTx(data.studentId, data.subjectId);
    db.runSync(
      `INSERT INTO sessions (id, student_id, mode, scheduled_for, estimated_duration_minutes, topics, session_notes, session_type, status, created_at, subject_id, travel_km)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`,
      [id, data.studentId, data.mode, data.scheduledFor, data.estimatedDurationMinutes, topicsJson, data.notes ?? null, data.session_type, now, subjectId, travelKm]
    );
  });

  return {
    id,
    student_id: data.studentId,
    mode: data.mode,
    scheduled_for: data.scheduledFor,
    estimated_duration_minutes: data.estimatedDurationMinutes,
    started_at: null,
    ended_at: null,
    paused_seconds: 0,
    duration_minutes: null,
    billed_minutes: null,
    paused_at: null,
    cancel_reason: null,
    topics: topicsJson,
    session_notes: data.notes ?? null,
    status: 'scheduled' as const,
    session_type: data.session_type,
    verified_at: null,
    updated_at: null,
    tutor_id: null,
    created_at: now,
    subject_id: subjectId,
    travel_km: travelKm,
    parent_travel_fee: null,
    edited_at: null,
  };
}

/**
 * @deprecated Non-atomic: leaves an orphan 'scheduled' row if the subsequent
 * startSession throws. Use `createAndStartUnscheduled`.
 */
export function createUnscheduled(studentId: string, mode: Session['mode'], session_type: Session['session_type'] = 'general'): Session {
  const db = getDb();
  const id = newId();
  const now = new Date().toISOString();

  let subjectId = '';
  db.withTransactionSync(() => {
    subjectId = resolveSubjectIdInTx(studentId);
    db.runSync(
      `INSERT INTO sessions (id, student_id, mode, scheduled_for, estimated_duration_minutes, topics, session_notes, session_type, status, created_at, subject_id)
       VALUES (?, ?, ?, NULL, NULL, ?, NULL, ?, 'scheduled', ?, ?)`,
      [id, studentId, mode, '[]', session_type, now, subjectId]
    );
  });

  return {
    id,
    student_id: studentId,
    mode,
    scheduled_for: null,
    estimated_duration_minutes: null,
    started_at: null,
    ended_at: null,
    paused_seconds: 0,
    duration_minutes: null,
    billed_minutes: null,
    paused_at: null,
    cancel_reason: null,
    topics: '[]',
    session_notes: null,
    status: 'scheduled' as const,
    session_type,
    verified_at: null,
    updated_at: null,
    tutor_id: null,
    created_at: now,
    subject_id: subjectId,
    travel_km: null,
    parent_travel_fee: null,
    edited_at: null,
  };
}

// ── Owe limit (nudge, never a hard block) ────────────────────────────────────

export type OweCheck = {
  balanceHours: number;
  projectedBalanceHours: number;
  /** 0 = owing not allowed; N > 0 = may owe up to N hours. */
  maxOweHours: number;
  lessonMinutes: number;
  /** true → UI should confirm ("Start anyway") and retry with allowOverOwe. */
  overLimit: boolean;
  /** Subject whose balance was checked (null = student has no subject rows; total used). */
  subjectId: string | null;
};

/**
 * Owe projection for a lesson of `lessonMinutes` against the SUBJECT's balance
 * (omitted subject = the student's primary subject).
 */
export function checkOweLimit(studentId: string, lessonMinutes: number, subjectId?: string | null): OweCheck {
  const db = getDb();
  const profile = db.getFirstSync<{ max_owe_hours: number }>('SELECT max_owe_hours FROM tutor_profile LIMIT 1');
  const maxOweHours = Math.max(0, profile?.max_owe_hours ?? 0);
  const sid = subjectId ?? getPrimarySubjectId(studentId);
  const balanceHours = sid ? getSubjectBalance(studentId, sid) : currentBalance(studentId);
  const projectedBalanceHours = balanceHours - lessonMinutes / 60;
  return {
    balanceHours,
    projectedBalanceHours,
    maxOweHours,
    lessonMinutes,
    overLimit: projectedBalanceHours < -maxOweHours - EPS,
    subjectId: sid,
  };
}

// ── Start ────────────────────────────────────────────────────────────────────

export type StartSessionOptions = {
  /** Tutor confirmed "Start anyway" after an OVER_OWE_LIMIT nudge. */
  allowOverOwe?: boolean;
  /** Injected clock (tests). */
  now?: Date;
};

/** Must be called inside withTransactionSync. */
function startSessionInTx(sessionId: string, opts: StartSessionOptions): Session {
  const db = getDb();
  const target = mustGet(sessionId);

  // Idempotent for the session that is already running — never resets started_at.
  if (target.status === 'active' || target.status === 'paused') return target;
  if (target.status !== 'scheduled') {
    throw new SessionError('NOT_STARTABLE', `Session ${sessionId} cannot be started (status: ${target.status})`, {
      status: target.status,
    });
  }

  const student = db.getFirstSync<{ status: Student['status'] }>('SELECT status FROM students WHERE id = ?', [target.student_id]);
  if (!student || student.status === 'archived') {
    throw new SessionError('NOT_STARTABLE', 'Student is archived', { studentStatus: student?.status ?? null });
  }

  const other = db.getFirstSync<{ id: string; student_id: string }>(
    "SELECT id, student_id FROM sessions WHERE status IN ('active','paused') AND id != ? LIMIT 1",
    [sessionId]
  );
  if (other) {
    throw new SessionError('ALREADY_ACTIVE', 'Another lesson is already in progress', {
      activeSessionId: other.id,
      activeStudentId: other.student_id,
    });
  }

  if (!opts.allowOverOwe) {
    const check = checkOweLimit(
      target.student_id,
      target.estimated_duration_minutes ?? DEFAULT_LESSON_MINUTES,
      target.subject_id ?? null,
    );
    if (check.overLimit) {
      const { overLimit: _overLimit, ...details } = check;
      throw new SessionError('OVER_OWE_LIMIT', 'Starting this lesson exceeds the owing limit', details);
    }
  }

  const startedAt = (opts.now ?? new Date()).toISOString();
  let changes = 0;
  try {
    changes = db.runSync(
      `UPDATE sessions SET started_at = ?, status = 'active', paused_at = NULL, paused_seconds = 0
       WHERE id = ? AND status = 'scheduled'`,
      [startedAt, sessionId]
    ).changes;
  } catch (e) {
    // sessions_one_in_flight unique index — a concurrent start won the race.
    if (e instanceof Error && /UNIQUE/i.test(e.message)) {
      throw new SessionError('ALREADY_ACTIVE', 'Another lesson is already in progress');
    }
    throw e;
  }
  if (changes === 0) throw new SessionError('NOT_STARTABLE', `Session ${sessionId} is no longer scheduled`);
  return mustGet(sessionId);
}

/**
 * Start a scheduled lesson (status 'scheduled' → 'active'), atomically.
 * Throws SessionError: NOT_FOUND | NOT_STARTABLE | ALREADY_ACTIVE | OVER_OWE_LIMIT.
 * OVER_OWE_LIMIT is a nudge — retry with `{ allowOverOwe: true }` after the tutor confirms.
 * Calling it for the session that is already active/paused returns it unchanged.
 */
export function startSession(sessionId: string, opts: StartSessionOptions = {}): Session {
  let result: Session | null = null;
  getDb().withTransactionSync(() => {
    result = startSessionInTx(sessionId, opts);
  });
  return result!;
}

/** Create an unscheduled lesson and start it in ONE transaction (no orphan row on failure). */
export function createAndStartUnscheduled(data: {
  studentId: string;
  /** Lesson subject; omitted = the student's primary subject. */
  subjectId?: string | null;
  /** Km override; omitted/null = student default. */
  travelKm?: number | null;
  mode: Session['mode'];
  sessionType?: Session['session_type'];
  /** Expected length; used for the owe projection (defaults to 60) and stored as estimate. */
  estimatedMinutes?: number;
  allowOverOwe?: boolean;
  now?: Date;
}): Session {
  const db = getDb();
  let result: Session | null = null;
  db.withTransactionSync(() => {
    const id = newId();
    const createdAt = (data.now ?? new Date()).toISOString();
    assertValidKm(data.travelKm);
    const subjectId = resolveSubjectIdInTx(data.studentId, data.subjectId);
    db.runSync(
      `INSERT INTO sessions (id, student_id, mode, scheduled_for, estimated_duration_minutes, topics, session_notes, session_type, status, created_at, subject_id, travel_km)
       VALUES (?, ?, ?, NULL, ?, '[]', NULL, ?, 'scheduled', ?, ?, ?)`,
      [id, data.studentId, data.mode, data.estimatedMinutes ?? null, data.sessionType ?? 'general', createdAt, subjectId, data.travelKm ?? null]
    );
    // Owe projection uses estimatedMinutes, or DEFAULT_LESSON_MINUTES when unknown.
    result = startSessionInTx(id, { allowOverOwe: data.allowOverOwe, now: data.now });
  });
  return result!;
}

// ── Pause / resume / discard ─────────────────────────────────────────────────

/** active → paused. Throws INVALID_STATE if the session is not active. */
export function pauseSession(sessionId: string, at: Date = new Date()): Session {
  const db = getDb();
  const changes = db.runSync(
    `UPDATE sessions SET paused_at = ?, status = 'paused' WHERE id = ? AND status = 'active'`,
    [at.toISOString(), sessionId]
  ).changes;
  if (changes === 0) throw new SessionError('INVALID_STATE', `Session ${sessionId} is not active`);
  return mustGet(sessionId);
}

/** paused → active, adding the closed pause interval to paused_seconds. */
export function resumeSession(sessionId: string, at: Date = new Date()): Session {
  const db = getDb();
  db.withTransactionSync(() => {
    const s = mustGet(sessionId);
    if (s.status !== 'paused') throw new SessionError('INVALID_STATE', `Session ${sessionId} is not paused`);
    const pausedSeconds = (s.paused_seconds ?? 0) + openPauseSeconds(s, at);
    db.runSync(
      `UPDATE sessions SET paused_at = NULL, paused_seconds = ?, status = 'active' WHERE id = ? AND status = 'paused'`,
      [pausedSeconds, sessionId]
    );
  });
  return mustGet(sessionId);
}

/**
 * Throw away an in-flight lesson (no deduction). Guarded: only active/paused.
 * Returns false (no-op) if the session was not in flight.
 */
export function discardSession(sessionId: string, at: Date = new Date()): boolean {
  const changes = getDb().runSync(
    `UPDATE sessions SET status = 'cancelled', cancel_reason = 'discarded', ended_at = ?, paused_at = NULL
     WHERE id = ? AND status IN ('active','paused')`,
    [at.toISOString(), sessionId]
  ).changes;
  return changes > 0;
}

// ── Elapsed time ─────────────────────────────────────────────────────────────

function openPauseSeconds(s: Pick<Session, 'status' | 'paused_at'>, until: Date): number {
  if (s.status !== 'paused' || !s.paused_at) return 0;
  return Math.max(0, Math.floor((until.getTime() - new Date(s.paused_at).getTime()) / 1000));
}

/**
 * Teaching seconds for a session: wall time since started_at minus all pauses.
 * Paused sessions are frozen at paused_at; completed/cancelled use ended_at.
 */
export function computeElapsedSeconds(
  session: Pick<Session, 'status' | 'started_at' | 'ended_at' | 'paused_at' | 'paused_seconds'>,
  now: Date = new Date(),
): number {
  if (!session.started_at) return 0;
  const end =
    (session.status === 'completed' || session.status === 'cancelled') && session.ended_at
      ? new Date(session.ended_at)
      : now;
  const wall = Math.floor((end.getTime() - new Date(session.started_at).getTime()) / 1000);
  const paused = (session.paused_seconds ?? 0) + openPauseSeconds(session, end);
  return Math.max(0, wall - paused);
}

// ── End / log ────────────────────────────────────────────────────────────────

export function endSession(data: {
  sessionId: string;
  endedAt: string;
  durationMinutes: number;
  billedMinutes: number;
  /**
   * @deprecated The DB is authoritative (paused_seconds + any open pause interval).
   * Kept for compatibility: the larger of the two is stored.
   */
  pausedSeconds?: number;
  topics: string[];
  sessionNotes?: string;
}): { session: Session; entry: LedgerEntry } {
  const db = getDb();
  let session: Session | null = null;
  let entry: LedgerEntry | null = null;

  db.withTransactionSync(() => {
    // read inside transaction
    const existing = db.getFirstSync<Session>('SELECT * FROM sessions WHERE id = ?', [data.sessionId]);
    if (!existing) throw new SessionError('NOT_FOUND', `Session ${data.sessionId} not found`);
    if (!['active', 'paused'].includes(existing.status)) {
      throw new SessionError('INVALID_STATE', `Session ${data.sessionId} cannot be ended (status: ${existing.status})`);
    }

    // Close an open pause interval if ending while paused.
    const dbPaused = (existing.paused_seconds ?? 0) + openPauseSeconds(existing, new Date(data.endedAt));
    const pausedSeconds = Math.max(dbPaused, data.pausedSeconds ?? 0);

    const topicsJson = JSON.stringify(data.topics);
    const subjectId = resolveSubjectIdInTx(existing.student_id, existing.subject_id);
    const travel = lessonTravelInTx(existing.student_id, existing.mode, undefined, existing.travel_km);
    const result = db.runSync(
      `UPDATE sessions SET ended_at = ?, duration_minutes = ?, billed_minutes = ?, paused_seconds = ?, paused_at = NULL, topics = ?, session_notes = ?, status = 'completed',
         subject_id = ?, travel_km = ?, parent_travel_fee = ?
       WHERE id = ? AND status IN ('active', 'paused')`,
      [data.endedAt, data.durationMinutes, data.billedMinutes, pausedSeconds, topicsJson, data.sessionNotes ?? null,
        subjectId, travel.travelKm, travel.parentTravelFee, data.sessionId]
    );
    if (result.changes === 0) throw new SessionError('INVALID_STATE', `Failed to end session ${data.sessionId} — status may have changed`);

    entry = appendEntryInTx({
      studentId: existing.student_id,
      type: 'session_deduction',
      hoursDelta: -(data.billedMinutes / 60),
      relatedSessionId: data.sessionId,
      subjectId,
    });

    session = db.getFirstSync<Session>('SELECT * FROM sessions WHERE id = ?', [data.sessionId])!;
  });

  return { session: session!, entry: entry! };
}

/**
 * @deprecated Use `recordLesson` (same behaviour; billed minutes first-class).
 * Record a lesson that already happened: completed session + deduction in one
 * transaction. With `sessionId`, completes that lesson ("Log as taught");
 * otherwise inserts a new completed lesson. Not subject to the owe limit.
 */
export function logPastSession(data: {
  studentId: string;
  /** Lesson subject; omitted = the booked lesson's subject, else the primary subject. */
  subjectId?: string | null;
  /** ISO start time; must not be in the future. */
  startedAt: string;
  /** Actual lesson length. */
  minutes: number;
  /** Defaults to `minutes`. */
  billedMinutes?: number;
  topics: string[];
  notes?: string;
  sessionId?: string;
  mode?: Session['mode'];
  sessionType?: Session['session_type'];
  travelKm?: number | null;
  now?: Date;
}): { session: Session; entry: LedgerEntry } {
  return recordLesson({
    sessionId: data.sessionId,
    studentId: data.studentId,
    subjectId: data.subjectId,
    startedAt: data.startedAt,
    minutes: data.minutes,
    billedMinutes: data.billedMinutes ?? data.minutes,
    topics: data.topics,
    notes: data.notes,
    mode: data.mode,
    sessionType: data.sessionType,
    travelKm: data.travelKm,
    now: data.now,
  });
}

/**
 * THE way a lesson gets recorded (primary flow; timer optional). One transaction:
 * - with `sessionId`: completes that scheduled lesson, or a running/paused timer lesson;
 * - without: inserts a new completed lesson.
 * Writes the session_deduction on the lesson's subject and snapshots travel km +
 * the parent travel charge (student's current rate). Not subject to the owe
 * limit (the lesson already happened).
 * Throws SessionError NOT_FOUND | INVALID_STATE | INVALID_INPUT; SubjectError for a foreign subject.
 */
export function recordLesson(data: {
  sessionId?: string;
  studentId: string;
  /** Omitted = the booked lesson's subject, else the student's primary subject. */
  subjectId?: string | null;
  /** ISO start; must not be in the future. */
  startedAt: string;
  /** Minutes charged to the balance (> 0). */
  billedMinutes: number;
  /** Actual length; defaults to billedMinutes. Drives ended_at. */
  minutes?: number;
  topics: string[];
  /** undefined = keep the booked lesson's notes. */
  notes?: string | null;
  /** Defaults to the booked lesson's mode, else in_person. */
  mode?: Session['mode'];
  sessionType?: Session['session_type'];
  /** Km for this lesson; omitted/null = booked km → student default. Ignored for online. */
  travelKm?: number | null;
  now?: Date;
}): { session: Session; entry: LedgerEntry } {
  const db = getDb();
  const billed = data.billedMinutes;
  const minutes = data.minutes ?? billed;
  const start = new Date(data.startedAt);
  const now = data.now ?? new Date();
  if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(billed) || billed <= 0) {
    throw new SessionError('INVALID_INPUT', 'Lesson length must be greater than zero');
  }
  if (Number.isNaN(start.getTime())) throw new SessionError('INVALID_INPUT', 'Invalid start time');
  if (start.getTime() > now.getTime() + 60_000) {
    throw new SessionError('INVALID_INPUT', 'A past lesson cannot start in the future');
  }
  assertValidKm(data.travelKm);

  const startedAt = start.toISOString();
  const endedAt = new Date(start.getTime() + minutes * 60_000).toISOString();
  const topicsJson = JSON.stringify(data.topics);
  let session: Session | null = null;
  let entry: LedgerEntry | null = null;

  db.withTransactionSync(() => {
    let id = data.sessionId;
    let subjectId: string;
    if (id) {
      const existing = mustGet(id);
      if (existing.student_id !== data.studentId) throw new SessionError('INVALID_INPUT', 'Session belongs to another student');
      if (!['scheduled', 'active', 'paused'].includes(existing.status)) {
        throw new SessionError('INVALID_STATE', `Session ${id} is not scheduled (status: ${existing.status})`);
      }
      subjectId = resolveSubjectIdInTx(data.studentId, data.subjectId ?? existing.subject_id);
      const mode = data.mode ?? existing.mode;
      const travel = lessonTravelInTx(data.studentId, mode, data.travelKm, existing.travel_km);
      const changes = db.runSync(
        `UPDATE sessions SET started_at = ?, ended_at = ?, duration_minutes = ?, billed_minutes = ?,
           paused_at = NULL, topics = ?, session_notes = CASE WHEN ? THEN ? ELSE session_notes END,
           mode = ?, session_type = COALESCE(?, session_type), subject_id = ?, travel_km = ?, parent_travel_fee = ?,
           status = 'completed'
         WHERE id = ? AND status IN ('scheduled', 'active', 'paused')`,
        [startedAt, endedAt, minutes, billed, topicsJson, data.notes !== undefined ? 1 : 0, data.notes ?? null,
          mode, data.sessionType ?? null, subjectId, travel.travelKm, travel.parentTravelFee, id]
      ).changes;
      if (changes === 0) {
        throw new SessionError('INVALID_STATE', `Session ${id} is not scheduled (status: ${existing.status})`);
      }
    } else {
      id = newId();
      subjectId = resolveSubjectIdInTx(data.studentId, data.subjectId);
      const mode = data.mode ?? 'in_person';
      const travel = lessonTravelInTx(data.studentId, mode, data.travelKm, null);
      db.runSync(
        `INSERT INTO sessions (id, student_id, mode, scheduled_for, estimated_duration_minutes, started_at, ended_at, paused_seconds,
           duration_minutes, billed_minutes, topics, session_notes, session_type, status, created_at, subject_id, travel_km, parent_travel_fee)
         VALUES (?, ?, ?, NULL, NULL, ?, ?, 0, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?)`,
        [id, data.studentId, mode, startedAt, endedAt, minutes, billed, topicsJson,
          data.notes ?? null, data.sessionType ?? 'general', now.toISOString(), subjectId, travel.travelKm, travel.parentTravelFee]
      );
    }

    entry = appendEntryInTx({
      studentId: data.studentId,
      type: 'session_deduction',
      hoursDelta: -(billed / 60),
      relatedSessionId: id,
      subjectId,
    });
    session = mustGet(id);
  });

  return { session: session!, entry: entry! };
}

/** True when the lesson is in a non-voided payout claim. */
export function isSessionInClaim(sessionId: string): boolean {
  return getDb().getFirstSync<{ x: number }>(
    `SELECT 1 AS x FROM claim_lines cl JOIN claims c ON c.id = cl.claim_id
     WHERE cl.session_id = ? AND c.voided_at IS NULL LIMIT 1`,
    [sessionId]
  ) != null;
}

export type EditLessonPatch = {
  billedMinutes?: number;
  /** New ISO start (not in the future). */
  startedAt?: string;
  /** New actual length (minutes). */
  minutes?: number;
  subjectId?: string;
  topics?: string[];
  /** null clears the notes. */
  notes?: string | null;
  /** null = back to the student default km. Changing km or mode re-prices travel at the CURRENT rate. */
  travelKm?: number | null;
  mode?: Session['mode'];
  sessionType?: Session['session_type'];
  now?: Date;
};

/**
 * Edit a recorded (completed) lesson in place — one transaction:
 * updates the session, UPDATES its session_deduction row (hours/subject; the
 * migration-009 guard allows only that), stamps edited_at. The parent travel
 * charge is recomputed only when km or mode change. Claim snapshots never change;
 * `inClaim` tells the UI to warn ("already in claim …") — a nudge, not a block.
 */
export function editLesson(sessionId: string, patch: EditLessonPatch): { session: Session; inClaim: boolean } {
  const db = getDb();
  const now = patch.now ?? new Date();
  let session: Session | null = null;

  if (patch.billedMinutes !== undefined && (!Number.isFinite(patch.billedMinutes) || patch.billedMinutes <= 0)) {
    throw new SessionError('INVALID_INPUT', 'Billed time must be greater than zero');
  }
  if (patch.minutes !== undefined && (!Number.isFinite(patch.minutes) || patch.minutes <= 0)) {
    throw new SessionError('INVALID_INPUT', 'Lesson length must be greater than zero');
  }
  assertValidKm(patch.travelKm);

  db.withTransactionSync(() => {
    const existing = mustGet(sessionId);
    if (existing.status !== 'completed') {
      throw new SessionError('INVALID_STATE', `Only recorded lessons can be edited (status: ${existing.status})`);
    }

    let startedAt = existing.started_at;
    if (patch.startedAt !== undefined) {
      const d = new Date(patch.startedAt);
      if (Number.isNaN(d.getTime())) throw new SessionError('INVALID_INPUT', 'Invalid start time');
      if (d.getTime() > now.getTime() + 60_000) throw new SessionError('INVALID_INPUT', 'A past lesson cannot start in the future');
      startedAt = d.toISOString();
    }
    const minutes = patch.minutes ?? existing.duration_minutes ?? existing.billed_minutes ?? 0;
    const billed = patch.billedMinutes ?? existing.billed_minutes ?? existing.duration_minutes ?? minutes;
    const endedAt =
      (patch.startedAt !== undefined || patch.minutes !== undefined) && startedAt
        ? new Date(new Date(startedAt).getTime() + minutes * 60_000).toISOString()
        : existing.ended_at;

    const subjectId = resolveSubjectIdInTx(existing.student_id, patch.subjectId ?? existing.subject_id);
    const mode = patch.mode ?? existing.mode;
    const kmChanged = patch.travelKm !== undefined && patch.travelKm !== existing.travel_km;
    const modeChanged = mode !== existing.mode;
    let travelKm = existing.travel_km ?? null;
    let parentTravelFee = existing.parent_travel_fee ?? null;
    if (kmChanged || modeChanged) {
      const t = lessonTravelInTx(existing.student_id, mode, patch.travelKm === undefined ? existing.travel_km : patch.travelKm, null);
      travelKm = t.travelKm;
      parentTravelFee = t.parentTravelFee;
    }

    db.runSync(
      `UPDATE sessions SET started_at = ?, ended_at = ?, duration_minutes = ?, billed_minutes = ?,
         topics = COALESCE(?, topics), session_notes = CASE WHEN ? THEN ? ELSE session_notes END,
         mode = ?, session_type = COALESCE(?, session_type), subject_id = ?, travel_km = ?, parent_travel_fee = ?,
         edited_at = ?
       WHERE id = ? AND status = 'completed'`,
      [startedAt, endedAt, minutes, billed,
        patch.topics !== undefined ? JSON.stringify(patch.topics) : null,
        patch.notes !== undefined ? 1 : 0, patch.notes ?? null,
        mode, patch.sessionType ?? null, subjectId, travelKm, parentTravelFee,
        now.toISOString(), sessionId]
    );

    const deduction = db.getFirstSync<{ id: string }>(
      `SELECT id FROM ledger_entries WHERE related_session_id = ? AND type = 'session_deduction' ORDER BY rowid ASC LIMIT 1`,
      [sessionId]
    );
    if (deduction) {
      db.runSync(
        'UPDATE ledger_entries SET hours_delta = ?, subject_id = ?, updated_at = ? WHERE id = ?',
        [-(billed / 60), subjectId, now.toISOString(), deduction.id]
      );
    } else {
      appendEntryInTx({
        studentId: existing.student_id,
        type: 'session_deduction',
        hoursDelta: -(billed / 60),
        relatedSessionId: sessionId,
        subjectId,
      });
    }
    session = mustGet(sessionId);
  });

  return { session: session!, inClaim: isSessionInClaim(sessionId) };
}

// ── Scheduled-lesson actions ─────────────────────────────────────────────────

/**
 * Student didn't show. Cancels the scheduled lesson with cancel_reason 'no_show'.
 * With `charge: true`, also deducts `minutes` (default: booked length, else 60)
 * and records them in billed_minutes.
 */
export function markNoShow(
  sessionId: string,
  opts: { charge: boolean; minutes?: number },
): { session: Session; entry: LedgerEntry | null } {
  const db = getDb();
  let session: Session | null = null;
  let entry: LedgerEntry | null = null;

  db.withTransactionSync(() => {
    const existing = mustGet(sessionId);
    if (existing.status !== 'scheduled') {
      throw new SessionError('INVALID_STATE', `Session ${sessionId} is not scheduled (status: ${existing.status})`);
    }
    const minutes = opts.charge ? opts.minutes ?? existing.estimated_duration_minutes ?? DEFAULT_LESSON_MINUTES : null;
    if (minutes !== null && (!Number.isFinite(minutes) || minutes <= 0)) {
      throw new SessionError('INVALID_INPUT', 'Charged minutes must be greater than zero');
    }
    db.runSync(
      `UPDATE sessions SET status = 'cancelled', cancel_reason = 'no_show', billed_minutes = ? WHERE id = ? AND status = 'scheduled'`,
      [minutes, sessionId]
    );
    if (minutes !== null) {
      entry = appendEntryInTx({
        studentId: existing.student_id,
        type: 'session_deduction',
        hoursDelta: -(minutes / 60),
        relatedSessionId: sessionId,
        reason: 'No-show',
        subjectId: existing.subject_id,
      });
    }
    session = mustGet(sessionId);
  });

  return { session: session!, entry };
}

/** Move a scheduled lesson to a new ISO start time (optionally new length). */
export function rescheduleSession(
  sessionId: string,
  newScheduledFor: string,
  /** travelKm: undefined = keep, null = back to student default. */
  opts: { estimatedDurationMinutes?: number; travelKm?: number | null } = {},
): Session {
  const when = new Date(newScheduledFor);
  if (Number.isNaN(when.getTime())) throw new SessionError('INVALID_INPUT', 'Invalid date');
  assertValidKm(opts.travelKm);
  const existing = mustGet(sessionId);
  const changes = getDb().runSync(
    `UPDATE sessions SET scheduled_for = ?, estimated_duration_minutes = COALESCE(?, estimated_duration_minutes),
       travel_km = CASE WHEN ? THEN ? ELSE travel_km END
     WHERE id = ? AND status = 'scheduled'`,
    [when.toISOString(), opts.estimatedDurationMinutes ?? null, opts.travelKm !== undefined ? 1 : 0, opts.travelKm ?? null, sessionId]
  ).changes;
  if (changes === 0) throw new SessionError('INVALID_STATE', `Session ${sessionId} is not scheduled (status: ${existing.status})`);
  return mustGet(sessionId);
}

/** Cancel a scheduled (not started) lesson. Throws INVALID_STATE otherwise. */
export function cancelScheduled(sessionId: string): void {
  const existing = mustGet(sessionId);
  const changes = getDb().runSync(
    `UPDATE sessions SET status = 'cancelled', cancel_reason = 'cancelled' WHERE id = ? AND status = 'scheduled'`,
    [sessionId]
  ).changes;
  if (changes === 0) throw new SessionError('INVALID_STATE', `Session ${sessionId} is not scheduled (status: ${existing.status})`);
}

/**
 * @deprecated Use `cancelScheduled` (scheduled) or `discardSession` (in flight).
 * Lenient legacy wrapper: no-op for completed/cancelled/missing sessions.
 */
export function cancelSession(sessionId: string): void {
  const session = getSession(sessionId);
  if (!session) return;
  if (session.status === 'scheduled') cancelScheduled(sessionId);
  else if (session.status === 'active' || session.status === 'paused') discardSession(sessionId);
}

export function updateScheduled(
  sessionId: string,
  data: {
    scheduledFor: string;
    estimatedDurationMinutes: number;
    mode: Session['mode'];
    session_type: Session['session_type'];
    topics: string[];
    notes?: string;
    /** undefined = keep. */
    subjectId?: string;
    /** undefined = keep; null = student default. */
    travelKm?: number | null;
  }
): void {
  const db = getDb();
  assertValidKm(data.travelKm);
  db.withTransactionSync(() => {
    const existing = db.getFirstSync<{ student_id: string }>('SELECT student_id FROM sessions WHERE id = ?', [sessionId]);
    const subjectId = existing && data.subjectId !== undefined ? resolveSubjectIdInTx(existing.student_id, data.subjectId) : null;
    db.runSync(
      `UPDATE sessions SET scheduled_for = ?, estimated_duration_minutes = ?, mode = ?, topics = ?, session_notes = ?, session_type = ?,
         subject_id = COALESCE(?, subject_id), travel_km = CASE WHEN ? THEN ? ELSE travel_km END
       WHERE id = ? AND status = 'scheduled'`,
      [data.scheduledFor, data.estimatedDurationMinutes, data.mode, JSON.stringify(data.topics), data.notes ?? null, data.session_type,
        subjectId, data.travelKm !== undefined ? 1 : 0, data.travelKm ?? null, sessionId]
    );
  });
}

// ── Lists ────────────────────────────────────────────────────────────────────

export function listUpcoming(studentId: string): Session[] {
  const db = getDb();
  return db.getAllSync<Session>(
    `SELECT * FROM sessions WHERE student_id = ? AND status = 'scheduled' AND datetime(scheduled_for) >= datetime('now') ORDER BY scheduled_for ASC`,
    [studentId]
  );
}

/**
 * A student's future scheduled lessons, each with the balance projected after it
 * (current balance minus all booked lessons up to and including that one).
 * Negative `projected_balance_after` → UI warns "will owe Xh".
 */
export function listUpcomingWithProjection(
  studentId: string,
  now: Date = new Date(),
): Array<Session & { projected_balance_after: number }> {
  const rows = getDb().getAllSync<Session>(
    `SELECT * FROM sessions WHERE student_id = ? AND status = 'scheduled' AND scheduled_for IS NOT NULL ORDER BY scheduled_for ASC`,
    [studentId]
  ).filter(s => new Date(s.scheduled_for!).getTime() >= now.getTime());
  // Per subject: each lesson draws on its own subject's balance.
  const primary = getPrimarySubjectId(studentId);
  const running = new Map<string, number>();
  return rows.map(s => {
    const key = s.subject_id ?? primary ?? '';
    if (!running.has(key)) running.set(key, key ? getSubjectBalance(studentId, key) : currentBalance(studentId));
    const next = running.get(key)! - (s.estimated_duration_minutes ?? DEFAULT_LESSON_MINUTES) / 60;
    running.set(key, next);
    return { ...s, projected_balance_after: Math.round(next * 1e6) / 1e6 };
  });
}

/** SQL select list adding the lesson's effective subject to a `sessions` row. */
const LESSON_SUBJECT_SELECT = `${effectiveSubjectIdSql('sessions')} AS subject_id,
  (SELECT ss.subject FROM student_subjects ss WHERE ss.id = ${effectiveSubjectIdSql('sessions')}) AS subject_name`;

export function listAllUpcoming(): Array<Session & { student_full_name: string; student_subject: string; subject_name: string | null }> {
  const db = getDb();
  return db.getAllSync<Session & { student_full_name: string; student_subject: string; subject_name: string | null }>(
    `SELECT sessions.*, students.full_name AS student_full_name,
            COALESCE((SELECT ss.subject FROM student_subjects ss WHERE ss.id = ${effectiveSubjectIdSql('sessions')}), students.subject) AS student_subject,
            ${LESSON_SUBJECT_SELECT}
     FROM sessions JOIN students ON sessions.student_id = students.id
     WHERE sessions.status = 'scheduled'
       AND datetime(sessions.scheduled_for) >= datetime('now')
       AND students.status NOT IN ('archived', 'paused')
     ORDER BY sessions.scheduled_for ASC`
  );
}

export type AgendaItem = Session & {
  student_full_name: string;
  /** The LESSON's subject name (falls back to students.subject). */
  student_subject: string;
  student_status: Student['status'];
  /** Lesson subject name (null only if the student has no subject rows). Always set by listAgenda. */
  subject_name?: string | null;
};

export type Agenda = {
  /** Active or paused lesson (0 or 1 item). Not repeated in the other buckets. */
  inProgress: AgendaItem[];
  /** Scheduled, not started, and the booked slot has already ended. Oldest first. */
  overdue: AgendaItem[];
  /** Scheduled for the rest of today (LOCAL day), slot not yet over. */
  today: AgendaItem[];
  /** Scheduled from LOCAL start of tomorrow onwards. */
  upcoming: AgendaItem[];
};

/**
 * Agenda buckets relative to `now` using LOCAL day boundaries.
 * A lesson is overdue once scheduled_for + booked length (default 60 min) has
 * passed without it being started. Excludes archived students.
 */
export function listAgenda(now: Date = new Date()): Agenda {
  const rows = getDb().getAllSync<AgendaItem>(
    `SELECT sessions.*, students.full_name AS student_full_name,
            COALESCE((SELECT ss.subject FROM student_subjects ss WHERE ss.id = ${effectiveSubjectIdSql('sessions')}), students.subject) AS student_subject,
            students.status AS student_status, ${LESSON_SUBJECT_SELECT}
     FROM sessions JOIN students ON sessions.student_id = students.id
     WHERE students.status != 'archived'
       AND (sessions.status IN ('active','paused')
            OR (sessions.status = 'scheduled' AND sessions.scheduled_for IS NOT NULL))`
  );

  const startOfTomorrow = new Date(now);
  startOfTomorrow.setHours(0, 0, 0, 0);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const nowMs = now.getTime();
  const tomorrowMs = startOfTomorrow.getTime();

  const agenda: Agenda = { inProgress: [], overdue: [], today: [], upcoming: [] };
  for (const r of rows) {
    if (r.status === 'active' || r.status === 'paused') {
      agenda.inProgress.push(r);
      continue;
    }
    const startMs = new Date(r.scheduled_for!).getTime();
    if (Number.isNaN(startMs)) continue;
    const endMs = startMs + (r.estimated_duration_minutes ?? DEFAULT_LESSON_MINUTES) * 60_000;
    if (endMs <= nowMs) agenda.overdue.push(r);
    else if (startMs < tomorrowMs) agenda.today.push(r);
    else agenda.upcoming.push(r);
  }
  const byStart = (a: AgendaItem, b: AgendaItem) =>
    new Date(a.scheduled_for ?? a.started_at ?? 0).getTime() - new Date(b.scheduled_for ?? b.started_at ?? 0).getTime();
  agenda.overdue.sort(byStart);
  agenda.today.sort(byStart);
  agenda.upcoming.sort(byStart);
  return agenda;
}

/** Recorded (non-scheduled, non-cancelled) lessons, newest first; optionally one subject. */
export function listForStudent(studentId: string, limit?: number, subjectId?: string): Session[] {
  const db = getDb();
  const params: (string | number)[] = [studentId];
  let where = `student_id = ? AND status NOT IN ('scheduled','cancelled')`;
  if (subjectId) {
    where += ` AND ${effectiveSubjectIdSql('sessions')} = ?`;
    params.push(subjectId);
  }
  let lim = '';
  if (limit !== undefined) {
    lim = 'LIMIT ?';
    params.push(limit);
  }
  return db.getAllSync<Session>(`SELECT * FROM sessions WHERE ${where} ORDER BY created_at DESC ${lim}`, params);
}

export function getActiveSession(): (Session & { student_full_name: string }) | null {
  const db = getDb();
  return db.getFirstSync<Session & { student_full_name: string }>(
    `SELECT sessions.*, students.full_name AS student_full_name
     FROM sessions JOIN students ON sessions.student_id = students.id
     WHERE sessions.status = 'active' LIMIT 1`
  ) ?? null;
}

export function getActiveOrPausedSession(): (Session & { student_full_name: string }) | null {
  const db = getDb();
  return db.getFirstSync<Session & { student_full_name: string }>(
    `SELECT sessions.*, students.full_name AS student_full_name
     FROM sessions JOIN students ON sessions.student_id = students.id
     WHERE sessions.status IN ('active','paused') LIMIT 1`
  ) ?? null;
}

// ── Week stats (Monday-start, local time; archived students excluded) ───────

function startOfLocalWeek(now: Date = new Date()): Date {
  const dow = now.getDay();              // 0=Sun, 1=Mon, ...
  const diff = dow === 0 ? -6 : 1 - dow; // Monday-start
  const start = new Date(now);
  start.setDate(now.getDate() + diff);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** Billed hours of lessons completed this week. */
export function sessionsThisWeek(): number {
  const db = getDb();
  const row = db.getFirstSync<{ total: number }>(
    `SELECT COALESCE(SUM(COALESCE(se.billed_minutes, se.duration_minutes)), 0) as total
     FROM sessions se JOIN students st ON st.id = se.student_id
     WHERE se.status = 'completed' AND se.ended_at >= ? AND st.status != 'archived'`,
    [startOfLocalWeek().toISOString()]
  );
  return (row?.total ?? 0) / 60;
}

export function sessionsThisWeekCount(): number {
  const db = getDb();
  const row = db.getFirstSync<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM sessions se JOIN students st ON st.id = se.student_id
     WHERE se.status = 'completed' AND se.ended_at >= ? AND st.status != 'archived'`,
    [startOfLocalWeek().toISOString()]
  );
  return row?.count ?? 0;
}

export function getSessionWithStudent(sessionId: string): (Session & { student_name: string; grade: number; subject: string; curriculum: string }) | null {
  const db = getDb();
  return db.getFirstSync<Session & { student_name: string; grade: number; subject: string; curriculum: string }>(
    `SELECT s.*, st.full_name as student_name, st.grade, st.curriculum,
            COALESCE((SELECT ss.subject FROM student_subjects ss WHERE ss.id = ${effectiveSubjectIdSql('s')}), st.subject) AS subject
     FROM sessions s
     JOIN students st ON s.student_id = st.id
     WHERE s.id = ?`,
    [sessionId]
  ) ?? null;
}
