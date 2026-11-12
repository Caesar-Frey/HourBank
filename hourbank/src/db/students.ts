import { getDb } from './client';
import { Student, Session, LedgerEntry, PreferredContact, ParentTravelMode } from './schema';
import { appendEntryInTx } from './ledger';
import { newId } from './uuid';
import { normaliseHours } from '../utils/balance';
import { insertSubjectInTx, resolveSubjectIdInTx, getPrimarySubjectId, updateStudentSubjectInTx } from './subjects';

/** Active subject + balance, as carried on student list rows. */
export type StudentSubjectBalanceSummary = { subject_id: string; subject: string; balance_hours: number };

export type StudentListRow = Student & {
  current_balance: number;
  next_session: Session | null;
  /** Active subjects in display order with their balances (migration 009). */
  subject_balances: StudentSubjectBalanceSummary[];
};

// ── Shared query helpers ──────────────────────────────────────────────────────

/** Subselect fields shared by listActiveStudents and listPausedStudents. */
const STUDENT_SELECT_FIELDS = `
  s.*,
  ROUND(COALESCE((
    SELECT SUM(le.hours_delta)
    FROM ledger_entries le
    WHERE le.student_id = s.id
  ), 0) * 60) / 60.0 AS current_balance,
  (
    SELECT json_object(
      'id', se.id, 'student_id', se.student_id, 'mode', se.mode,
      'scheduled_for', se.scheduled_for, 'estimated_duration_minutes', se.estimated_duration_minutes,
      'started_at', se.started_at, 'ended_at', se.ended_at, 'paused_seconds', se.paused_seconds,
      'duration_minutes', se.duration_minutes, 'topics', se.topics, 'session_notes', se.session_notes,
      'status', se.status, 'verified_at', se.verified_at, 'created_at', se.created_at
    )
    FROM sessions se
    WHERE se.student_id = s.id
      AND se.status = 'scheduled'
      AND datetime(se.scheduled_for) >= datetime('now')
    ORDER BY se.scheduled_for ASC
    LIMIT 1
  ) AS next_session_json,
  (
    SELECT json_group_array(json_object('subject_id', b.subject_id, 'subject', b.subject, 'balance_hours', b.balance_hours))
    FROM (
      SELECT subject_id, subject, balance_hours FROM student_subject_balances
      WHERE student_id = s.id AND status = 'active'
      ORDER BY sort_order
    ) b
  ) AS subject_balances_json
`;

type RawListRow = Student & {
  current_balance: number;
  next_session_json: string | null;
  subject_balances_json: string | null;
};

function mapRows(rows: RawListRow[]): StudentListRow[] {
  return rows.map(({ next_session_json, subject_balances_json, ...row }) => ({
    ...row,
    current_balance: normaliseHours(row.current_balance),
    next_session: next_session_json ? JSON.parse(next_session_json) as Session : null,
    subject_balances: subject_balances_json
      ? (JSON.parse(subject_balances_json) as StudentSubjectBalanceSummary[]).map(b => ({
          ...b,
          balance_hours: normaliseHours(b.balance_hours),
        }))
      : [],
  }));
}

/** Parent travel defaults for a new student: the tutor's travel config. */
function defaultParentTravel(): { mode: ParentTravelMode; perKm: number } {
  const p = getDb().getFirstSync<{ travel_mode: string | null; per_km_rate: number | null }>(
    'SELECT travel_mode, per_km_rate FROM tutor_profile LIMIT 1'
  );
  return { mode: p?.travel_mode === 'distance' ? 'per_km' : 'flat', perKm: p?.per_km_rate ?? 0 };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function createStudent(data: {
  fullName: string;
  grade: number;
  subject: string;
  curriculum: Student['curriculum'];
  travelFlatFee?: number;
  travelDistanceKm?: number;
  payoutRateOverride?: number | null;
  parentName?: string | null;
  parentPhone?: string | null;
  studentPhone?: string | null;
  preferredContact?: PreferredContact;
  /** Further subjects beyond `subject` (blank/duplicate names are skipped). */
  additionalSubjects?: string[];
  /** Per-subject grade/curriculum overrides, matched by name (case-insensitive); written in the same transaction. */
  subjectOverrides?: Array<{ subject: string; grade?: number | null; curriculum?: Student['curriculum'] | null }>;
  /** Parent travel charge; defaults to the tutor's travel config (flat fee = travelFlatFee). */
  parentTravelMode?: ParentTravelMode;
  parentTravelFlatFee?: number;
  parentTravelPerKm?: number;
}): Student {
  const db = getDb();
  const id = newId();
  const now = new Date().toISOString();
  const travelFlatFee = data.travelFlatFee ?? 0;
  const travelDistanceKm = data.travelDistanceKm ?? 0;
  const payoutRateOverride = data.payoutRateOverride ?? null;
  const parentName = blankToNull(data.parentName);
  const parentPhone = blankToNull(data.parentPhone);
  const studentPhone = blankToNull(data.studentPhone);
  const preferredContact: PreferredContact = data.preferredContact === 'student' ? 'student' : 'parent';

  const travelDefaults = defaultParentTravel();
  const parentTravelMode: ParentTravelMode = data.parentTravelMode ?? travelDefaults.mode;
  const parentTravelFlatFee = data.parentTravelFlatFee ?? travelFlatFee;
  const parentTravelPerKm = data.parentTravelPerKm ?? travelDefaults.perKm;

  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO students (id, full_name, grade, subject, curriculum, status, travel_flat_fee, travel_distance_km, payout_rate_override, parent_name, parent_phone, student_phone, preferred_contact, parent_travel_mode, parent_travel_flat_fee, parent_travel_per_km, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.fullName, data.grade, data.subject, data.curriculum, travelFlatFee, travelDistanceKm, payoutRateOverride, parentName, parentPhone, studentPhone, preferredContact, parentTravelMode, parentTravelFlatFee, parentTravelPerKm, now]
    );
    const override = (name: string) => {
      const o = data.subjectOverrides?.find(x => x.subject.trim().toLowerCase() === name.trim().toLowerCase());
      return o ? { grade: o.grade, curriculum: o.curriculum } : {};
    };
    insertSubjectInTx({ studentId: id, subject: data.subject, ...override(data.subject) });
    const seen = new Set([data.subject.trim().toLowerCase()]);
    for (const extra of data.additionalSubjects ?? []) {
      const key = extra.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      insertSubjectInTx({ studentId: id, subject: extra, ...override(extra) });
    }
  });

  return {
    id,
    full_name: data.fullName,
    grade: data.grade,
    subject: data.subject,
    curriculum: data.curriculum,
    status: 'active',
    created_at: now,
    travel_flat_fee: travelFlatFee,
    travel_distance_km: travelDistanceKm,
    payout_rate_override: payoutRateOverride,
    parent_name: parentName,
    parent_phone: parentPhone,
    student_phone: studentPhone,
    preferred_contact: preferredContact,
    parent_travel_mode: parentTravelMode,
    parent_travel_flat_fee: parentTravelFlatFee,
    parent_travel_per_km: parentTravelPerKm,
  };
}

function blankToNull(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export function listActiveStudents(): StudentListRow[] {
  const db = getDb();
  const rows = db.getAllSync<RawListRow>(`
    SELECT ${STUDENT_SELECT_FIELDS}
    FROM students s
    WHERE s.status = 'active'
    ORDER BY current_balance ASC
  `);
  return mapRows(rows);
}

export function listPausedStudents(): StudentListRow[] {
  const db = getDb();
  const rows = db.getAllSync<RawListRow>(`
    SELECT ${STUDENT_SELECT_FIELDS}
    FROM students s
    WHERE s.status = 'paused'
    ORDER BY current_balance ASC
  `);
  return mapRows(rows);
}

/**
 * One student. Archived students are hidden unless `includeArchived` (read-only
 * views: the student page, history, lesson and transaction detail — B6).
 */
export function getStudent(id: string, opts: { includeArchived?: boolean } = {}): Student | null {
  const db = getDb();
  if (opts.includeArchived) return db.getFirstSync<Student>('SELECT * FROM students WHERE id = ?', [id]) ?? null;
  return db.getFirstSync<Student>("SELECT * FROM students WHERE id = ? AND status != 'archived'", [id]) ?? null;
}

export function updateStudent(id: string, data: {
  fullName: string;
  grade: number;
  subject: string;
  curriculum: Student['curriculum'];
  travelFlatFee?: number;
  travelDistanceKm?: number;
  payoutRateOverride?: number | null;
  /** undefined = keep existing; null/'' = clear. */
  parentName?: string | null;
  /** undefined = keep existing; null/'' = clear. */
  parentPhone?: string | null;
  /** undefined = keep existing; null/'' = clear. */
  studentPhone?: string | null;
  /** undefined = keep existing. */
  preferredContact?: PreferredContact;
  /** undefined = keep existing. Rate changes never reprice recorded lessons. */
  parentTravelMode?: ParentTravelMode;
  parentTravelFlatFee?: number;
  parentTravelPerKm?: number;
}): void {
  const db = getDb();
  // Preserve existing travel/override/parent values when a caller omits them, so editing
  // a student's core fields never silently clobbers other config.
  const existing = db.getFirstSync<{
    travel_flat_fee: number;
    travel_distance_km: number;
    payout_rate_override: number | null;
    parent_name: string | null;
    parent_phone: string | null;
    student_phone: string | null;
    preferred_contact: PreferredContact | null;
  }>('SELECT travel_flat_fee, travel_distance_km, payout_rate_override, parent_name, parent_phone, student_phone, preferred_contact FROM students WHERE id = ?', [id]);

  const travelFlatFee = data.travelFlatFee ?? existing?.travel_flat_fee ?? 0;
  const travelDistanceKm = data.travelDistanceKm ?? existing?.travel_distance_km ?? 0;
  const payoutRateOverride =
    data.payoutRateOverride !== undefined ? data.payoutRateOverride : existing?.payout_rate_override ?? null;
  const parentName = data.parentName !== undefined ? blankToNull(data.parentName) : existing?.parent_name ?? null;
  const parentPhone = data.parentPhone !== undefined ? blankToNull(data.parentPhone) : existing?.parent_phone ?? null;

  const studentPhone = data.studentPhone !== undefined ? blankToNull(data.studentPhone) : existing?.student_phone ?? null;
  const preferredContact: PreferredContact =
    (data.preferredContact ?? existing?.preferred_contact) === 'student' ? 'student' : 'parent';

  db.withTransactionSync(() => {
    db.runSync(
      `UPDATE students SET full_name=?, grade=?, subject=?, curriculum=?, travel_flat_fee=?, travel_distance_km=?, payout_rate_override=?, parent_name=?, parent_phone=?, student_phone=?, preferred_contact=?,
         parent_travel_mode = COALESCE(?, parent_travel_mode),
         parent_travel_flat_fee = COALESCE(?, parent_travel_flat_fee),
         parent_travel_per_km = COALESCE(?, parent_travel_per_km)
       WHERE id=?`,
      [data.fullName, data.grade, data.subject, data.curriculum, travelFlatFee, travelDistanceKm, payoutRateOverride, parentName, parentPhone, studentPhone, preferredContact,
        data.parentTravelMode ?? null, data.parentTravelFlatFee ?? null, data.parentTravelPerKm ?? null, id]
    );
    // Legacy single-subject form: `subject` names the PRIMARY subject → rename it in place.
    const primary = getPrimarySubjectId(id);
    if (primary) {
      const current = db.getFirstSync<{ subject: string }>('SELECT subject FROM student_subjects WHERE id = ?', [primary]);
      if (current && data.subject.trim() && current.subject !== data.subject.trim()) {
        updateStudentSubjectInTx(primary, { subject: data.subject });
      }
    } else {
      resolveSubjectIdInTx(id);
    }
  });
}

export function pauseStudent(id: string): void {
  const db = getDb();
  const result = db.runSync("UPDATE students SET status = 'paused' WHERE id = ? AND status = 'active'", [id]);
  if (result.changes === 0) throw new Error('Student not found or already paused');
}

export function reactivateStudent(id: string): void {
  const db = getDb();
  const result = db.runSync("UPDATE students SET status = 'active' WHERE id = ? AND status = 'paused'", [id]);
  if (result.changes === 0) throw new Error('Student not found or not in paused state');
}

/**
 * Soft-delete a student. Also cancels every still-scheduled lesson for them
 * (cancel_reason 'student_archived') in the same transaction.
 * Returns how many lessons were cancelled so the UI can confirm it.
 */
export function archiveStudent(id: string): { cancelledLessons: number } {
  const db = getDb();
  let cancelledLessons = 0;

  db.withTransactionSync(() => {
    // Guard: student must exist and be active or paused (not already archived)
    const student = db.getFirstSync<Student>('SELECT * FROM students WHERE id = ?', [id]);
    if (!student) throw new Error(`Student ${id} not found`);
    if (student.status === 'archived') throw new Error(`Student ${id} is already archived`);

    // Guard: no active or paused sessions
    const activeSession = db.getFirstSync<{ id: string }>(
      "SELECT id FROM sessions WHERE student_id = ? AND status IN ('active', 'paused') LIMIT 1",
      [id]
    );
    if (activeSession) throw new Error(`Student ${id} has an active or paused session — end it before archiving`);

    cancelledLessons = db.runSync(
      "UPDATE sessions SET status = 'cancelled', cancel_reason = 'student_archived' WHERE student_id = ? AND status = 'scheduled'",
      [id]
    ).changes;

    db.runSync("UPDATE students SET status = 'archived' WHERE id = ?", [id]);
  });

  return { cancelledLessons };
}

/** Number of scheduled lessons that archiving would cancel (for the confirm dialog). */
export function countScheduledLessons(studentId: string): number {
  const row = getDb().getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sessions WHERE student_id = ? AND status = 'scheduled'",
    [studentId]
  );
  return row?.n ?? 0;
}

export function listArchivedStudents(): Array<Student & { current_balance: number }> {
  return getDb().getAllSync<Student & { current_balance: number }>(`
    SELECT s.*,
      COALESCE((SELECT SUM(le.hours_delta) FROM ledger_entries le WHERE le.student_id = s.id), 0) AS current_balance
    FROM students s
    WHERE s.status = 'archived'
    ORDER BY s.full_name COLLATE NOCASE ASC
  `).map(r => ({ ...r, current_balance: normaliseHours(r.current_balance) }));
}

/** Stamp that a top-up reminder was opened in WhatsApp for this student. */
export function markReminded(id: string, at: Date = new Date()): void {
  getDb().runSync('UPDATE students SET last_reminded_at = ? WHERE id = ?', [at.toISOString(), id]);
}

/** Un-archive: archived → active. Lessons cancelled by the archive are NOT restored. */
export function restoreStudent(id: string): void {
  const result = getDb().runSync(
    "UPDATE students SET status = 'active' WHERE id = ? AND status = 'archived'",
    [id]
  );
  if (result.changes === 0) throw new Error('Student not found or not archived');
}

/**
 * Append a balance correction to the ledger (append-only — never edits rows).
 * `hoursDelta` may be positive (credit) or negative (debit); `reason` is required.
 */
export function createAdjustment(data: {
  studentId: string;
  hoursDelta: number;
  reason: string;
  /** Subject balance to correct; omitted = the student's primary subject. */
  subjectId?: string | null;
}): LedgerEntry {
  const reason = data.reason.trim();
  if (!Number.isFinite(data.hoursDelta) || data.hoursDelta === 0) {
    throw new Error('Adjustment hours must be a non-zero number');
  }
  if (reason.length === 0) throw new Error('Adjustment requires a reason');
  const exists = getDb().getFirstSync<{ id: string }>('SELECT id FROM students WHERE id = ?', [data.studentId]);
  if (!exists) throw new Error(`Student ${data.studentId} not found`);
  let entry: LedgerEntry | null = null;
  getDb().withTransactionSync(() => {
    entry = appendEntryInTx({
      studentId: data.studentId,
      type: 'adjustment',
      hoursDelta: data.hoursDelta,
      reason,
      subjectId: data.subjectId,
    });
  });
  return entry!;
}
