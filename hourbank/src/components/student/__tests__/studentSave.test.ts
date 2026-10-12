import { createMigratedTestDb, resetDbSingleton } from '../../../db/__tests__/testDb';
import { getStudent } from '../../../db/students';
import { listStudentSubjects, getSubjectBalances } from '../../../db/subjects';
import { createAdjustment } from '../../../db/students';
import { StudentFormValues } from '../flowLogic';
import { newSubjectDraft, subjectDraftsFromRows } from '../subjectLogic';
import { createStudentFromForm, formValuesToPayload, updateStudentFromForm } from '../studentSave';

function form(over: Partial<StudentFormValues> = {}): StudentFormValues {
  return {
    fullName: 'Ana Botha',
    grade: 10,
    curriculum: 'CAPS',
    subjects: [newSubjectDraft('Maths')],
    parentName: '',
    parentPhone: '',
    studentPhone: '',
    preferredContact: 'parent',
    travelFlatFee: '60',
    travelDistanceKm: '12',
    parentTravelMode: 'flat',
    parentTravelFlatFee: '',
    parentTravelPerKm: '',
    ...over,
  };
}

function loadForm(id: string): StudentFormValues {
  const rows = listStudentSubjects(id, { includeArchived: true });
  const bal: Record<string, number> = {};
  for (const b of getSubjectBalances(id)) bal[b.id] = b.balance_hours;
  return form({ subjects: subjectDraftsFromRows(rows, bal) });
}

describe('formValuesToPayload', () => {
  it('blank parent flat fee falls back to the payout flat fee in flat mode', () => {
    expect(formValuesToPayload(form(), 'flat')).toMatchObject({
      travelFlatFee: 60, travelDistanceKm: 12, parentTravelMode: 'flat', parentTravelFlatFee: 60, parentTravelPerKm: 0,
    });
    expect(formValuesToPayload(form({ parentTravelFlatFee: '80' }), 'flat').parentTravelFlatFee).toBe(80);
    expect(formValuesToPayload(form({ parentTravelMode: 'per_km', parentTravelPerKm: '4,5' }), 'distance'))
      .toMatchObject({ parentTravelMode: 'per_km', parentTravelPerKm: 4.5, parentTravelFlatFee: 0 });
  });
});

describe('studentSave (DB)', () => {
  beforeEach(() => { createMigratedTestDb(); });
  afterEach(() => resetDbSingleton());

  it('creates a student with several subjects, overrides and parent travel terms', () => {
    const sci = { ...newSubjectDraft('Physical Sciences'), grade: 11, curriculum: 'IEB' };
    const s = createStudentFromForm(
      form({ subjects: [newSubjectDraft(' Maths '), sci, newSubjectDraft('')], parentTravelMode: 'per_km', parentTravelPerKm: '5' }),
      'flat'
    );
    const subs = listStudentSubjects(s.id);
    expect(subs.map(x => [x.subject, x.grade, x.curriculum])).toEqual([
      ['Maths', null, null],
      ['Physical Sciences', 11, 'IEB'],
    ]);
    expect(getStudent(s.id)).toMatchObject({ subject: 'Maths', parent_travel_mode: 'per_km', parent_travel_per_km: 5 });
  });

  it('edit: adds, renames, archives and restores subjects; balances survive', () => {
    const s = createStudentFromForm(form({ subjects: [newSubjectDraft('Maths'), newSubjectDraft('Science')] }), 'flat');
    const [maths, science] = listStudentSubjects(s.id);
    createAdjustment({ studentId: s.id, hoursDelta: 2, reason: 'seed', subjectId: science.id });

    const initial = loadForm(s.id);
    const next: StudentFormValues = {
      ...initial,
      subjects: [
        { ...initial.subjects[0], name: 'Mathematics' },
        { ...initial.subjects[1], archived: true },
        newSubjectDraft('English'),
      ],
    };
    updateStudentFromForm(s.id, initial, next, 'flat');
    expect(listStudentSubjects(s.id).map(x => x.subject)).toEqual(['Mathematics', 'English']);
    expect(getStudent(s.id)!.subject).toBe('Mathematics');
    expect(getSubjectBalances(s.id).find(b => b.id === science.id)?.balance_hours).toBe(2);

    // Restore the archived subject → its balance comes back.
    const again = loadForm(s.id);
    const restored = again.subjects.map(d => (d.id === science.id ? { ...d, archived: false } : d));
    updateStudentFromForm(s.id, again, { ...again, subjects: restored }, 'flat');
    expect(listStudentSubjects(s.id).map(x => x.id)).toContain(science.id);
    expect(listStudentSubjects(s.id).map(x => x.id)).toContain(maths.id);
  });

  it('archiving the primary subject moves students.subject to the next one', () => {
    const s = createStudentFromForm(form({ subjects: [newSubjectDraft('Maths'), newSubjectDraft('Science')] }), 'flat');
    const initial = loadForm(s.id);
    updateStudentFromForm(s.id, initial, {
      ...initial,
      subjects: [{ ...initial.subjects[0], archived: true }, initial.subjects[1]],
    }, 'flat');
    expect(getStudent(s.id)!.subject).toBe('Science');
  });
});
