import { getDb } from './client';
import { Session } from './schema';
import { LedgerEntry } from './schema';
import { appendEntryInTx } from './ledger';
import { newId } from './uuid';

export function createScheduled(data: {
  studentId: string;
  scheduledFor: string;
  estimatedDurationMinutes: number;
  mode: Session['mode'];
  topics?: string[];
  notes?: string;
}): Session {
  const db = getDb();
  const id = newId();
  const now = new Date().toISOString();
  const topicsJson = JSON.stringify(data.topics ?? []);

  db.runSync(
    `INSERT INTO sessions (id, student_id, mode, scheduled_for, estimated_duration_minutes, topics, session_notes, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
    [id, data.studentId, data.mode, data.scheduledFor, data.estimatedDurationMinutes, topicsJson, data.notes ?? null, now]
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
    topics: topicsJson,
    session_notes: data.notes ?? null,
    status: 'scheduled',
    verified_at: null,
    created_at: now,
  };
}

export function startSession(sessionId: string): Session {
  const db = getDb();
  const now = new Date().toISOString();

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
      `UPDATE sessions SET ended_at = ?, duration_minutes = ?, paused_seconds = ?, topics = ?, session_notes = ?, status = 'pending_verification' WHERE id = ? AND status = 'active'`,
      [data.endedAt, data.durationMinutes, data.pausedSeconds, topicsJson, data.sessionNotes ?? null, data.sessionId]
    );
    if (result.changes === 0) throw new Error(`Failed to end session ${data.sessionId} — status may have changed`);

    entry = appendEntryInTx({
      studentId: existing.student_id,
      type: 'session_deduction',
      hoursDelta: -(data.durationMinutes / 60),
      relatedSessionId: data.sessionId,
    });

    session = db.getFirstSync<Session>('SELECT * FROM sessions WHERE id = ?', [data.sessionId])!;
  });

  return { session: session!, entry: entry! };
}

export function cancelSession(sessionId: string): void {
  getDb().runSync(
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
    topics: string[];
    notes?: string;
  }
): void {
  getDb().runSync(
    `UPDATE sessions SET scheduled_for = ?, estimated_duration_minutes = ?, mode = ?, topics = ?, session_notes = ? WHERE id = ? AND status = 'scheduled'`,
    [data.scheduledFor, data.estimatedDurationMinutes, data.mode, JSON.stringify(data.topics), data.notes ?? null, sessionId]
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

export function autoVerifySweep(windowHours: number): number {
  const db = getDb();
  const result = db.runSync(
    `UPDATE sessions SET status = 'verified', verified_at = datetime('now')
     WHERE status = 'pending_verification' AND ended_at <= datetime('now', '-' || ? || ' hours')`,
    [windowHours]
  );
  return result.changes;
}

export function sessionsThisWeek(): number {
  const db = getDb();
  const startOfWeek = new Date();
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  const row = db.getFirstSync<{ total: number }>(
    `SELECT COALESCE(SUM(duration_minutes), 0) as total FROM sessions WHERE status IN ('pending_verification','verified') AND ended_at >= ?`,
    [startOfWeek.toISOString()]
  );
  return (row?.total ?? 0) / 60;
}
