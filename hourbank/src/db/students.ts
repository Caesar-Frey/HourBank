import { getDb } from './client';
import { Student, Session } from './schema';

export function createStudent(data: {
  fullName: string;
  grade: number;
  subject: string;
  curriculum: Student['curriculum'];
}): Student {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.runSync(
    `INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    [id, data.fullName, data.grade, data.subject, data.curriculum, now]
  );

  return {
    id,
    full_name: data.fullName,
    grade: data.grade,
    subject: data.subject,
    curriculum: data.curriculum,
    status: 'active',
    created_at: now,
  };
}

export function listActiveStudents(): Array<Student & { current_balance: number; next_session: Session | null }> {
  const db = getDb();
  const rows = db.getAllSync<Student & { current_balance: number; next_session_json: string | null }>(`
    SELECT
      s.*,
      COALESCE((
        SELECT SUM(le.hours_delta)
        FROM ledger_entries le
        WHERE le.student_id = s.id
      ), 0) AS current_balance,
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
          AND se.scheduled_for >= datetime('now')
        ORDER BY se.scheduled_for ASC
        LIMIT 1
      ) AS next_session_json
    FROM students s
    WHERE s.status = 'active'
    ORDER BY current_balance ASC
  `);

  return rows.map(row => ({
    ...row,
    next_session: row.next_session_json ? JSON.parse(row.next_session_json) as Session : null,
  }));
}

export function getStudent(id: string): Student | null {
  const db = getDb();
  return db.getFirstSync<Student>('SELECT * FROM students WHERE id = ?', [id]) ?? null;
}

export function archiveStudent(id: string): void {
  const db = getDb();
  db.runSync("UPDATE students SET status = 'archived' WHERE id = ?", [id]);
}
