import { getDb } from './client';
import { Student, Session } from './schema';
import { currentBalance } from './ledger';

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
  const students = db.getAllSync<Student>(
    `SELECT * FROM students WHERE status = 'active' ORDER BY full_name ASC`
  );

  return students.map((student) => {
    const balance = currentBalance(student.id);
    const nextSession = db.getFirstSync<Session>(
      `SELECT * FROM sessions WHERE student_id = ? AND status = 'scheduled' AND scheduled_for >= datetime('now') ORDER BY scheduled_for ASC LIMIT 1`,
      [student.id]
    );
    return {
      ...student,
      current_balance: balance,
      next_session: nextSession ?? null,
    };
  });
}

export function getStudent(id: string): Student | null {
  const db = getDb();
  return db.getFirstSync<Student>('SELECT * FROM students WHERE id = ?', [id]) ?? null;
}

export function archiveStudent(id: string): void {
  const db = getDb();
  db.runSync("UPDATE students SET status = 'archived' WHERE id = ?", [id]);
}
