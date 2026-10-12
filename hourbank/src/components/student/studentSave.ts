/**
 * studentSave.ts — turns the student form (incl. Subjects editor and parent
 * travel terms) into createStudent / updateStudent + subject API calls.
 * Integration-tested against the migrated test DB (__tests__/studentSave.test.ts).
 */
import { createStudent, updateStudent } from '../../db/students';
import {
  addStudentSubject,
  archiveStudentSubject,
  listStudentSubjects,
  updateStudentSubject,
} from '../../db/subjects';
import { Student } from '../../db/schema';
import { parseDecimal } from '../../utils/format';
import { studentContactPayload, StudentFormValues } from './flowLogic';
import { activeSubjectDrafts, cleanSubjectName, planSubjectChanges, SubjectDraft } from './subjectLogic';

type Curriculum = Student['curriculum'];

/** Shared createStudent/updateStudent fields (assumes validation passed). */
export function formValuesToPayload(v: StudentFormValues, travelMode: 'flat' | 'distance') {
  const payoutFlat = parseDecimal(v.travelFlatFee) ?? 0;
  return {
    fullName: v.fullName.trim(),
    grade: v.grade as number,
    curriculum: v.curriculum as Curriculum,
    travelFlatFee: payoutFlat,
    travelDistanceKm: parseDecimal(v.travelDistanceKm) ?? 0,
    parentTravelMode: v.parentTravelMode,
    // Blank parent flat fee = same as the tutor's flat travel fee for this student.
    parentTravelFlatFee: parseDecimal(v.parentTravelFlatFee) ?? (travelMode === 'flat' ? payoutFlat : 0),
    parentTravelPerKm: parseDecimal(v.parentTravelPerKm) ?? 0,
    ...studentContactPayload(v),
  };
}

function findActiveId(studentId: string, name: string): string | null {
  const k = cleanSubjectName(name).toLowerCase();
  return listStudentSubjects(studentId).find(s => s.subject.toLowerCase() === k)?.id ?? null;
}

function overrides(d: Pick<SubjectDraft, 'grade' | 'curriculum'>) {
  return { grade: d.grade, curriculum: (d.curriculum as Curriculum | null) };
}

export function createStudentFromForm(v: StudentFormValues, travelMode: 'flat' | 'distance'): Student {
  const active = activeSubjectDrafts(v.subjects).filter(d => cleanSubjectName(d.name) !== '');
  const [first, ...rest] = active;
  const student = createStudent({
    ...formValuesToPayload(v, travelMode),
    subject: cleanSubjectName(first.name),
    additionalSubjects: rest.map(d => cleanSubjectName(d.name)),
  });
  for (const d of active) {
    if (d.grade === null && d.curriculum === null) continue;
    const id = findActiveId(student.id, d.name);
    if (id) updateStudentSubject(id, overrides(d));
  }
  return student;
}

/**
 * Apply Subjects editor changes. Order: restore → add → archive → rename, so
 * the student always keeps an active subject. Re-running after a partial
 * failure is safe (already-present names are skipped).
 */
export function applySubjectChanges(studentId: string, initial: SubjectDraft[], current: SubjectDraft[]): void {
  const plan = planSubjectChanges(initial, current);
  for (const r of plan.restore) {
    if (!findActiveId(studentId, r.name)) addStudentSubject({ studentId, subject: r.name });
  }
  for (const a of plan.add) {
    const existing = findActiveId(studentId, a.name);
    if (existing) continue;
    addStudentSubject({
      studentId,
      subject: a.name,
      grade: a.grade,
      curriculum: a.curriculum as Curriculum | null,
    });
  }
  for (const id of plan.archive) archiveStudentSubject(id);
  for (const u of plan.update) {
    updateStudentSubject(u.id, {
      ...(u.patch.subject !== undefined ? { subject: u.patch.subject } : {}),
      ...(u.patch.grade !== undefined ? { grade: u.patch.grade } : {}),
      ...(u.patch.curriculum !== undefined ? { curriculum: u.patch.curriculum as Curriculum | null } : {}),
    });
  }
}

export function updateStudentFromForm(
  studentId: string,
  initial: StudentFormValues,
  v: StudentFormValues,
  travelMode: 'flat' | 'distance',
): void {
  applySubjectChanges(studentId, initial.subjects, v.subjects);
  // students.subject mirrors the primary subject; pass it through unchanged.
  const primary = listStudentSubjects(studentId)[0]?.subject
    ?? cleanSubjectName(activeSubjectDrafts(v.subjects)[0]?.name ?? '');
  updateStudent(studentId, { ...formValuesToPayload(v, travelMode), subject: primary });
}
