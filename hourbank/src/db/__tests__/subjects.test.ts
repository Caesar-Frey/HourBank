import { createMigratedTestDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import {
  listStudentSubjects,
  addStudentSubject,
  renameStudentSubject,
  updateStudentSubject,
  archiveStudentSubject,
  getSubjectBalances,
  getSubjectBalance,
  getPrimarySubjectId,
  SubjectError,
} from '../subjects';
import { createStudent, updateStudent, listActiveStudents, createAdjustment, getStudent } from '../students';
import { createPackage } from '../packages';
import { currentBalance, lastNEntries, listLedger, getLedgerEntryById } from '../ledger';

const base = { fullName: 'Amahle Dlamini', grade: 10, subject: 'Maths', curriculum: 'CAPS' as const };

describe('subjects.ts', () => {
  let db: TestDb;
  beforeEach(() => { db = createMigratedTestDb(); });
  afterEach(() => resetDbSingleton());

  it('createStudent creates the primary subject from `subject`', () => {
    const s = createStudent(base);
    const subs = listStudentSubjects(s.id);
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ student_id: s.id, subject: 'Maths', status: 'active', sort_order: 0, grade: null });
    expect(getPrimarySubjectId(s.id)).toBe(subs[0].id);
  });

  it('createStudent accepts additional subjects', () => {
    const s = createStudent({ ...base, additionalSubjects: ['Physical Sciences', ' ', 'maths'] });
    expect(listStudentSubjects(s.id).map(x => x.subject)).toEqual(['Maths', 'Physical Sciences']);
  });

  it('adds, renames and updates subjects; rejects active duplicates', () => {
    const s = createStudent(base);
    const sci = addStudentSubject({ studentId: s.id, subject: 'Physical Sciences', grade: 11 });
    expect(sci).toMatchObject({ subject: 'Physical Sciences', grade: 11, sort_order: 1, status: 'active' });
    expect(() => addStudentSubject({ studentId: s.id, subject: ' maths ' })).toThrow(SubjectError);
    expect(() => addStudentSubject({ studentId: s.id, subject: '   ' })).toThrow(SubjectError);

    renameStudentSubject(sci.id, 'Science');
    expect(listStudentSubjects(s.id).map(x => x.subject)).toEqual(['Maths', 'Science']);
    expect(() => renameStudentSubject(sci.id, 'MATHS')).toThrow(SubjectError);

    updateStudentSubject(sci.id, { curriculum: 'IEB', grade: null });
    expect(listStudentSubjects(s.id)[1]).toMatchObject({ curriculum: 'IEB', grade: null });
  });

  it('renaming the primary subject keeps students.subject in sync', () => {
    const s = createStudent(base);
    renameStudentSubject(getPrimarySubjectId(s.id)!, 'Mathematics');
    expect(getStudent(s.id)!.subject).toBe('Mathematics');
  });

  it('updateStudent with a new subject renames the primary subject (legacy single-subject form)', () => {
    const s = createStudent(base);
    const primary = getPrimarySubjectId(s.id);
    updateStudent(s.id, { ...base, subject: 'Mathematics' });
    expect(getPrimarySubjectId(s.id)).toBe(primary);
    expect(listStudentSubjects(s.id).map(x => x.subject)).toEqual(['Mathematics']);
  });

  it('archives a subject (keeping its balance) but never the last active one', () => {
    const s = createStudent(base);
    const maths = getPrimarySubjectId(s.id)!;
    expect(() => archiveStudentSubject(maths)).toThrow(SubjectError);
    const sci = addStudentSubject({ studentId: s.id, subject: 'Science' });
    createPackage({ studentId: s.id, subjectId: sci.id, hoursAdded: 2, amountPaid: 1000, paymentMethod: 'eft' });
    archiveStudentSubject(sci.id);
    expect(listStudentSubjects(s.id).map(x => x.subject)).toEqual(['Maths']);
    expect(listStudentSubjects(s.id, { includeArchived: true }).map(x => x.status)).toEqual(['active', 'archived']);
    // archived subject with a balance still shows in balances
    expect(getSubjectBalances(s.id).map(b => [b.subject, b.status, b.balance_hours])).toEqual([
      ['Maths', 'active', 0],
      ['Science', 'archived', 2],
    ]);
    // re-adding the same name reactivates it with its balance intact
    const again = addStudentSubject({ studentId: s.id, subject: 'science' });
    expect(again.id).toBe(sci.id);
    expect(again.status).toBe('active');
    expect(getSubjectBalance(s.id, sci.id)).toBe(2);
  });

  it('archiving the primary subject moves students.subject to the next one', () => {
    const s = createStudent(base);
    addStudentSubject({ studentId: s.id, subject: 'Science' });
    archiveStudentSubject(getPrimarySubjectId(s.id)!);
    expect(getStudent(s.id)!.subject).toBe('Science');
  });

  describe('per-subject balances', () => {
    it('top-ups and adjustments hit only their subject; total is the sum', () => {
      const s = createStudent(base);
      const maths = getPrimarySubjectId(s.id)!;
      const sci = addStudentSubject({ studentId: s.id, subject: 'Science' });
      const { entry, pkg } = createPackage({ studentId: s.id, subjectId: sci.id, hoursAdded: 5, amountPaid: 2750, paymentMethod: 'eft' });
      expect(pkg.subject_id).toBe(sci.id);
      expect(entry).toMatchObject({ subject_id: sci.id, balance_after: 5 });
      createPackage({ studentId: s.id, hoursAdded: 3, amountPaid: 1650, paymentMethod: 'cash' }); // default → primary
      createAdjustment({ studentId: s.id, subjectId: sci.id, hoursDelta: -0.5, reason: 'Fix' });
      expect(getSubjectBalance(s.id, maths)).toBe(3);
      expect(getSubjectBalance(s.id, sci.id)).toBe(4.5);
      expect(currentBalance(s.id)).toBe(7.5);
      expect(getSubjectBalances(s.id).reduce((a, b) => a + b.balance_hours, 0)).toBe(7.5);
    });

    it("rejects another student's subject", () => {
      const a = createStudent(base);
      const b = createStudent({ ...base, fullName: 'Bongani' });
      const bMaths = getPrimarySubjectId(b.id)!;
      expect(() => createPackage({ studentId: a.id, subjectId: bMaths, hoursAdded: 1, amountPaid: 1, paymentMethod: 'eft' })).toThrow(SubjectError);
      expect(() => createAdjustment({ studentId: a.id, subjectId: bMaths, hoursDelta: 1, reason: 'x' })).toThrow(SubjectError);
    });

    it('balance_after is the running balance of that subject', () => {
      const s = createStudent(base);
      const sci = addStudentSubject({ studentId: s.id, subject: 'Science' });
      createPackage({ studentId: s.id, hoursAdded: 10, amountPaid: 1, paymentMethod: 'eft' });
      const { entry } = createPackage({ studentId: s.id, subjectId: sci.id, hoursAdded: 2, amountPaid: 1, paymentMethod: 'eft' });
      expect(entry.balance_after).toBe(2);
      expect(listLedger(s.id, { subjectId: sci.id }).map(e => e.balance_after)).toEqual([2]);
      expect(listLedger(s.id).map(e => [e.subject_name, e.balance_after])).toEqual([
        ['Science', 2],
        ['Maths', 10],
      ]);
      expect(lastNEntries(s.id, 1)[0].subject_id).toBe(sci.id);
      expect(getLedgerEntryById(entry.id)).toMatchObject({ subject_id: sci.id, subject_name: 'Science', balance_after: 2 });
    });

    it('a student inserted without any subject row gets one lazily on first write', () => {
      db.runSync(`INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at)
                  VALUES ('raw', 'Raw Row', 9, 'History', 'CAPS', 'active', '2026-10-01T00:00:00.000Z')`);
      expect(getSubjectBalances('raw')).toEqual([]);
      createPackage({ studentId: 'raw', hoursAdded: 4, amountPaid: 1, paymentMethod: 'eft' });
      expect(getSubjectBalances('raw').map(b => [b.subject, b.balance_hours])).toEqual([['History', 4]]);
    });

    it('ledger rows with no subject_id count towards the primary subject', () => {
      const s = createStudent(base);
      db.runSync(`INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, created_at)
                  VALUES ('legacy', ?, 'top_up', 3, 3, '2026-10-01T00:00:00.000Z')`, [s.id]);
      addStudentSubject({ studentId: s.id, subject: 'Science' });
      expect(getSubjectBalances(s.id).map(b => b.balance_hours)).toEqual([3, 0]);
    });

    it('listActiveStudents carries active subject balances', () => {
      const s = createStudent(base);
      const sci = addStudentSubject({ studentId: s.id, subject: 'Science' });
      createPackage({ studentId: s.id, subjectId: sci.id, hoursAdded: 2, amountPaid: 1, paymentMethod: 'eft' });
      const row = listActiveStudents().find(r => r.id === s.id)!;
      expect(row.current_balance).toBe(2);
      expect(row.subject_balances.map(b => [b.subject, b.balance_hours])).toEqual([['Maths', 0], ['Science', 2]]);
    });
  });
});
