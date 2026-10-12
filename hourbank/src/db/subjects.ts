/**
 * subjects.ts — a student's subjects, each with its own hours balance (migration 009).
 *
 * Balances are ledger-derived per subject. Ledger/session/package rows whose
 * subject_id is NULL (legacy writers) belong to the student's PRIMARY subject
 * (first active by sort_order), so the subject balances always add up to the
 * student's total. `students.subject` mirrors the primary subject's name so
 * screens that still read it keep working.
 */
import { getDb } from './client';
import { Student, StudentSubject } from './schema';
import { primarySubjectIdSql } from './migrations';
import { newId } from './uuid';

export type SubjectErrorCode = 'NOT_FOUND' | 'DUPLICATE' | 'INVALID_INPUT' | 'LAST_ACTIVE' | 'WRONG_STUDENT';

export class SubjectError extends Error {
  readonly code: SubjectErrorCode;
  constructor(code: SubjectErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'SubjectError';
    this.code = code;
    Object.setPrototypeOf(this, SubjectError.prototype);
  }
}

export function isSubjectError(e: unknown, code?: SubjectErrorCode): e is SubjectError {
  return e instanceof SubjectError && (code === undefined || e.code === code);
}

export type SubjectBalance = StudentSubject & { balance_hours: number };

const ORDER = `ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, sort_order, created_at, id`;

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function getStudentSubject(subjectId: string): StudentSubject | null {
  return getDb().getFirstSync<StudentSubject>('SELECT * FROM student_subjects WHERE id = ?', [subjectId]) ?? null;
}

/** Active subjects in display order (add `includeArchived` for all). */
export function listStudentSubjects(studentId: string, opts: { includeArchived?: boolean } = {}): StudentSubject[] {
  const where = opts.includeArchived ? '' : "AND status = 'active'";
  return getDb().getAllSync<StudentSubject>(
    `SELECT * FROM student_subjects WHERE student_id = ? ${where} ${ORDER}`,
    [studentId]
  );
}

/** The student's primary subject id, or null if they have no subject row yet. */
export function getPrimarySubjectId(studentId: string): string | null {
  const row = getDb().getFirstSync<{ id: string | null }>(`SELECT ${primarySubjectIdSql('?')} AS id`, [studentId]);
  return row?.id ?? null;
}

/**
 * Per-subject balances: every active subject, plus archived subjects whose
 * balance is not zero (so hours are never hidden). Display order.
 */
export function getSubjectBalances(studentId: string): SubjectBalance[] {
  const rows = getDb().getAllSync<SubjectBalance>(
    `SELECT ss.*, b.balance_hours
     FROM student_subjects ss
     JOIN student_subject_balances b ON b.subject_id = ss.id
     WHERE ss.student_id = ? AND (ss.status = 'active' OR ABS(b.balance_hours) > 1e-9)
     ORDER BY CASE ss.status WHEN 'active' THEN 0 ELSE 1 END, ss.sort_order, ss.created_at, ss.id`,
    [studentId]
  );
  return rows.map(r => ({ ...r, balance_hours: round6(r.balance_hours) }));
}

/** Hours balance of one subject (NULL-subject legacy rows count toward the primary). */
export function getSubjectBalance(studentId: string, subjectId: string): number {
  const row = getDb().getFirstSync<{ b: number }>(
    'SELECT balance_hours AS b FROM student_subject_balances WHERE student_id = ? AND subject_id = ?',
    [studentId, subjectId]
  );
  return round6(row?.b ?? 0);
}

// ── Resolution (used by every write path) ────────────────────────────────────

/**
 * The subject a write should be booked against. With `subjectId`, validates it
 * belongs to the student. Without it, the primary subject — created from
 * students.subject if the student has none yet. Call inside a transaction.
 */
export function resolveSubjectIdInTx(studentId: string, subjectId?: string | null): string {
  const db = getDb();
  if (subjectId) {
    const row = db.getFirstSync<{ student_id: string }>('SELECT student_id FROM student_subjects WHERE id = ?', [subjectId]);
    if (!row) throw new SubjectError('NOT_FOUND', `Subject ${subjectId} not found`);
    if (row.student_id !== studentId) throw new SubjectError('WRONG_STUDENT', 'Subject belongs to another student');
    return subjectId;
  }
  const primary = getPrimarySubjectId(studentId);
  if (primary) return primary;
  const student = db.getFirstSync<{ subject: string | null; created_at: string | null }>(
    'SELECT subject, created_at FROM students WHERE id = ?',
    [studentId]
  );
  if (!student) throw new SubjectError('NOT_FOUND', `Student ${studentId} not found`);
  const id = newId();
  db.runSync(
    `INSERT INTO student_subjects (id, student_id, subject, grade, curriculum, status, sort_order, created_at)
     VALUES (?, ?, ?, NULL, NULL, 'active', 0, ?)`,
    [id, studentId, (student.subject ?? '').trim() || 'General', new Date().toISOString()]
  );
  return id;
}

/** Keep students.subject = the primary subject's name (legacy readers). */
function syncPrimaryName(studentId: string): void {
  const db = getDb();
  const primary = getPrimarySubjectId(studentId);
  if (!primary) return;
  db.runSync(
    'UPDATE students SET subject = (SELECT subject FROM student_subjects WHERE id = ?) WHERE id = ?',
    [primary, studentId]
  );
}

function cleanName(name: string): string {
  const t = name.trim().replace(/\s+/g, ' ');
  if (!t) throw new SubjectError('INVALID_INPUT', 'Subject name is required');
  return t;
}

function findActiveByName(studentId: string, name: string, excludeId?: string): StudentSubject | null {
  return getDb().getFirstSync<StudentSubject>(
    `SELECT * FROM student_subjects WHERE student_id = ? AND status = 'active'
       AND subject = ? COLLATE NOCASE AND id != ?`,
    [studentId, name, excludeId ?? '']
  ) ?? null;
}

// ── Writes ───────────────────────────────────────────────────────────────────

/** Insert a subject row without its own transaction (createStudent uses this). */
export function insertSubjectInTx(data: {
  studentId: string;
  subject: string;
  grade?: number | null;
  curriculum?: Student['curriculum'] | null;
}): StudentSubject {
  const db = getDb();
  const name = cleanName(data.subject);
  if (findActiveByName(data.studentId, name)) {
    throw new SubjectError('DUPLICATE', `${name} is already one of this student's subjects`);
  }
  // Re-adding an archived subject brings it (and its balance) back.
  const archived = db.getFirstSync<StudentSubject>(
    `SELECT * FROM student_subjects WHERE student_id = ? AND status = 'archived' AND subject = ? COLLATE NOCASE
     ORDER BY created_at DESC LIMIT 1`,
    [data.studentId, name]
  );
  if (archived) {
    db.runSync(
      `UPDATE student_subjects SET status = 'active',
         grade = CASE WHEN ? THEN ? ELSE grade END,
         curriculum = CASE WHEN ? THEN ? ELSE curriculum END
       WHERE id = ?`,
      [data.grade !== undefined ? 1 : 0, data.grade ?? null, data.curriculum !== undefined ? 1 : 0, data.curriculum ?? null, archived.id]
    );
    syncPrimaryName(data.studentId);
    return getStudentSubject(archived.id)!;
  }
  const next = db.getFirstSync<{ n: number | null }>(
    'SELECT MAX(sort_order) AS n FROM student_subjects WHERE student_id = ?',
    [data.studentId]
  );
  const sortOrder = next?.n == null ? 0 : next.n + 1;
  const id = newId();
  const createdAt = new Date().toISOString();
  db.runSync(
    `INSERT INTO student_subjects (id, student_id, subject, grade, curriculum, status, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
    [id, data.studentId, name, data.grade ?? null, data.curriculum ?? null, sortOrder, createdAt]
  );
  return {
    id,
    student_id: data.studentId,
    subject: name,
    grade: data.grade ?? null,
    curriculum: data.curriculum ?? null,
    status: 'active',
    sort_order: sortOrder,
    created_at: createdAt,
  };
}

/** Add a subject (or reactivate an archived one with the same name). Throws SubjectError DUPLICATE/INVALID_INPUT. */
export function addStudentSubject(data: {
  studentId: string;
  subject: string;
  /** NULL/omitted = inherit the student's grade. */
  grade?: number | null;
  /** NULL/omitted = inherit the student's curriculum. */
  curriculum?: Student['curriculum'] | null;
}): StudentSubject {
  const db = getDb();
  const exists = db.getFirstSync<{ id: string }>('SELECT id FROM students WHERE id = ?', [data.studentId]);
  if (!exists) throw new SubjectError('NOT_FOUND', `Student ${data.studentId} not found`);
  let result: StudentSubject | null = null;
  db.withTransactionSync(() => {
    result = insertSubjectInTx(data);
  });
  return result!;
}

/** updateStudentSubject without its own transaction. */
export function updateStudentSubjectInTx(
  subjectId: string,
  patch: { subject?: string; grade?: number | null; curriculum?: Student['curriculum'] | null },
): StudentSubject {
  const db = getDb();
  const existing = getStudentSubject(subjectId);
  if (!existing) throw new SubjectError('NOT_FOUND', `Subject ${subjectId} not found`);
  const name = patch.subject !== undefined ? cleanName(patch.subject) : existing.subject;
  if (existing.status === 'active' && findActiveByName(existing.student_id, name, subjectId)) {
    throw new SubjectError('DUPLICATE', `${name} is already one of this student's subjects`);
  }
  db.runSync(
    'UPDATE student_subjects SET subject = ?, grade = ?, curriculum = ? WHERE id = ?',
    [
      name,
      patch.grade !== undefined ? patch.grade : existing.grade,
      patch.curriculum !== undefined ? patch.curriculum : existing.curriculum,
      subjectId,
    ]
  );
  syncPrimaryName(existing.student_id);
  return getStudentSubject(subjectId)!;
}

/** Change name / grade / curriculum. `undefined` = keep; `null` grade/curriculum = inherit. */
export function updateStudentSubject(
  subjectId: string,
  patch: { subject?: string; grade?: number | null; curriculum?: Student['curriculum'] | null },
): StudentSubject {
  let result: StudentSubject | null = null;
  getDb().withTransactionSync(() => {
    result = updateStudentSubjectInTx(subjectId, patch);
  });
  return result!;
}

export function renameStudentSubject(subjectId: string, name: string): StudentSubject {
  return updateStudentSubject(subjectId, { subject: name });
}

/**
 * Archive a subject: hidden from pickers, balance kept (and still listed by
 * getSubjectBalances while non-zero). Throws LAST_ACTIVE for the only active subject.
 */
export function archiveStudentSubject(subjectId: string): { balanceHours: number } {
  const db = getDb();
  const existing = getStudentSubject(subjectId);
  if (!existing) throw new SubjectError('NOT_FOUND', `Subject ${subjectId} not found`);
  if (existing.status === 'archived') return { balanceHours: getSubjectBalance(existing.student_id, subjectId) };
  const active = db.getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM student_subjects WHERE student_id = ? AND status = 'active'",
    [existing.student_id]
  )!.n;
  if (active <= 1) throw new SubjectError('LAST_ACTIVE', 'A student needs at least one subject');
  // Balance read BEFORE archiving: NULL-subject rows follow the primary, which may move.
  const balanceHours = getSubjectBalance(existing.student_id, subjectId);
  db.withTransactionSync(() => {
    db.runSync("UPDATE student_subjects SET status = 'archived' WHERE id = ?", [subjectId]);
    syncPrimaryName(existing.student_id);
  });
  return { balanceHours };
}
