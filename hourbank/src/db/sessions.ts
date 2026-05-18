import { getDb } from './client';
import { Session } from './schema';
import { LedgerEntry } from './schema';
import { appendEntryInTx } from './ledger';
import { newId } from './uuid';

export function getSession(sessionId: string): Session | null {
  const db = getDb();
  return db.getFirstSync<Session>('SELECT * FROM sessions WHERE id = ?', [sessionId]) ?? null;
}

export function createScheduled(data: {
  studentId: string;
  scheduledFor: string;
  estimatedDurationMinutes: number;
  mode: Session['mode'];
  session_type: Session['session_type'];
  topics?: string[];
  notes?: string;
}): Session {
  const db = getDb();
  const id = newId();
  const now = new Date().toISOString();
  const topicsJson = JSON.stringify(data.topics ?? []);

  db.runSync(
    `INSERT INTO sessions (id, student_id, mode, scheduled_for, estimated_duration_minutes, topics, session_notes, session_type, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
    [id, data.studentId, data.mode, data.scheduledFor, data.estimatedDurationMinutes, topicsJson, data.notes ?? null, data.session_type, now]
  );

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
  };
}

export function createUnscheduled(studentId: string, mode: Session['mode'], session_type: Session['session_type'] = 'general'): Session {
  const db = getDb();
  const id = newId();
  const now = new Date().toISOString();

  db.runSync(
    `INSERT INTO sessions (id, student_id, mode, scheduled_for, estimated_duration_minutes, topics, session_notes, session_type, status, created_at)
     VALUES (?, ?, ?, NULL, NULL, ?, NULL, ?, 'scheduled', ?)`,
    [id, studentId, mode, '[]', session_type, now]
  );

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
  };
}

export function startSession(sessionId: string): Session {
  const db = getDb();
  const now = new Date().toISOString();

  // Guard: throw if another session is already active/paused
  const existing = getActiveOrPausedSession();
  if (existing && existing.id !== sessionId) {
    throw new Error('ALREADY_ACTIVE');
  }

  // Guard: max_owe_hours check
  const targetSession = db.getFirstSync<{ student_id: string }>('SELECT student_id FROM sessions WHERE id = ?', [sessionId]);
  if (targetSession) {
    const profile = db.getFirstSync<{ max_owe_hours: number }>('SELECT max_owe_hours FROM tutor_profile LIMIT 1');
    const maxOwe = profile?.max_owe_hours ?? 0;
    if (maxOwe > 0) {
      const balRow = db.getFirstSync<{ bal: number }>(
        'SELECT COALESCE(SUM(hours_delta), 0) AS bal FROM ledger_entries WHERE student_id = ?',
        [targetSession.student_id]
      );
      const bal = balRow?.bal ?? 0;
      if (bal <= -maxOwe) {
        throw new Error('MAX_OWE_EXCEEDED');
      }
    }
  }

  db.runSync(
    `UPDATE sessions SET started_at = ?, status = 'active' WHERE id = ?`,
    [now, sessionId]
  );

  const session = db.getFirstSync<Session>('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  return session;
}

export function endSession(data: {
  sessionId: string;
  endedAt: string;
  durationMinutes: number;
  billedMinutes: number;
  pausedSeconds: number;
  topics: string[];
  sessionNotes?: string;
}): { session: Session; entry: LedgerEntry } {
  const db = getDb();
  let session: Session | null = null;
  let entry: LedgerEntry | null = null;

  db.withTransactionSync(() => {
    // read inside transaction
    const existing = db.getFirstSync<Session>('SELECT * FROM sessions WHERE id = ?', [data.sessionId]);
    if (!existing) throw new Error(`Session ${data.sessionId} not found`);
    if (existing.status !== 'active') throw new Error(`Session ${data.sessionId} is not active (status: ${existing.status})`);

    const topicsJson = JSON.stringify(data.topics);
    const result = db.runSync(
      `UPDATE sessions SET ended_at = ?, duration_minutes = ?, billed_minutes = ?, paused_seconds = ?, topics = ?, session_notes = ?, status = 'completed' WHERE id = ? AND status = 'active'`,
      [data.endedAt, data.durationMinutes, data.billedMinutes, data.pausedSeconds, topicsJson, data.sessionNotes ?? null, data.sessionId]
    );
    if (result.changes === 0) throw new Error(`Failed to end session ${data.sessionId} — status may have changed`);

    entry = appendEntryInTx({
      studentId: existing.student_id,
      type: 'session_deduction',
      hoursDelta: -(data.billedMinutes / 60),
      relatedSessionId: data.sessionId,
    });

    session = db.getFirstSync<Session>('SELECT * FROM sessions WHERE id = ?', [data.sessionId])!;
  });

  return { session: session!, entry: entry! };
}

export function cancelSession(sessionId: string): void {
  const db = getDb();
  const session = db.getFirstSync<Session>('SELECT status FROM sessions WHERE id = ?', [sessionId]);
  if (!session || !['scheduled', 'active', 'paused'].includes(session.status)) return;
  db.runSync(
    `UPDATE sessions SET status = 'cancelled' WHERE id = ?`,
    [sessionId]
  );
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
  }
): void {
  getDb().runSync(
    `UPDATE sessions SET scheduled_for = ?, estimated_duration_minutes = ?, mode = ?, topics = ?, session_notes = ?, session_type = ? WHERE id = ? AND status = 'scheduled'`,
    [data.scheduledFor, data.estimatedDurationMinutes, data.mode, JSON.stringify(data.topics), data.notes ?? null, data.session_type, sessionId]
  );
}

export function listUpcoming(studentId: string): Session[] {
  const db = getDb();
  return db.getAllSync<Session>(
    `SELECT * FROM sessions WHERE student_id = ? AND status = 'scheduled' AND scheduled_for >= datetime('now') ORDER BY scheduled_for ASC`,
    [studentId]
  );
}

export function listAllUpcoming(): Array<Session & { student_full_name: string; student_subject: string }> {
  const db = getDb();
  return db.getAllSync<Session & { student_full_name: string; student_subject: string }>(
    `SELECT sessions.*, students.full_name AS student_full_name, students.subject AS student_subject
     FROM sessions JOIN students ON sessions.student_id = students.id
     WHERE sessions.status = 'scheduled' AND sessions.scheduled_for >= datetime('now')
     ORDER BY sessions.scheduled_for ASC`
  );
}

export function listForStudent(studentId: string, limit?: number): Session[] {
  const db = getDb();
  if (limit !== undefined) {
    return db.getAllSync<Session>(
      `SELECT * FROM sessions WHERE student_id = ? AND status NOT IN ('scheduled','cancelled') ORDER BY created_at DESC LIMIT ?`,
      [studentId, limit]
    );
  }
  return db.getAllSync<Session>(
    `SELECT * FROM sessions WHERE student_id = ? AND status NOT IN ('scheduled','cancelled') ORDER BY created_at DESC`,
    [studentId]
  );
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

export function sessionsThisWeek(): number {
  const db = getDb();
  const startOfWeek = new Date();
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  const row = db.getFirstSync<{ total: number }>(
    `SELECT COALESCE(SUM(duration_minutes), 0) as total FROM sessions WHERE status = 'completed' AND ended_at >= ?`,
    [startOfWeek.toISOString()]
  );
  return (row?.total ?? 0) / 60;
}

export function sessionsThisWeekCount(): number {
  const db = getDb();
  const startOfWeek = new Date();
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  const row = db.getFirstSync<{ count: number }>(
    `SELECT COUNT(*) as count FROM sessions WHERE status = 'completed' AND ended_at >= ?`,
    [startOfWeek.toISOString()]
  );
  return row?.count ?? 0;
}

export function getSessionWithStudent(sessionId: string): (Session & { student_name: string; grade: number; subject: string; curriculum: string }) | null {
  const db = getDb();
  return db.getFirstSync<Session & { student_name: string; grade: number; subject: string; curriculum: string }>(
    `SELECT s.*, st.full_name as student_name, st.grade, st.subject, st.curriculum
     FROM sessions s
     JOIN students st ON s.student_id = st.id
     WHERE s.id = ?`,
    [sessionId]
  ) ?? null;
}
