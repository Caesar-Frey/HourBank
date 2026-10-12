import {
  activeSubjectDrafts,
  lessonSubjectName,
  lowestSubject,
  newSubjectDraft,
  subjectStatusTip,
  planSubjectChanges,
  subjectArchiveWarning,
  subjectDraftsFromRows,
  subjectsChanged,
  validateSubjectDrafts,
  SubjectDraft,
} from '../subjectLogic';

function draft(over: Partial<SubjectDraft> = {}): SubjectDraft {
  return {
    key: over.id ?? 'new',
    id: null,
    name: 'Maths',
    grade: null,
    curriculum: null,
    archived: false,
    initiallyArchived: false,
    balanceHours: 0,
    bookedLessons: 0,
    ...over,
  };
}

describe('subjectDraftsFromRows', () => {
  it('maps subject rows with balances and booked counts; archived rows start archived', () => {
    const drafts = subjectDraftsFromRows(
      [
        { id: 'a', subject: 'Maths', grade: null, curriculum: null, status: 'active' },
        { id: 'b', subject: 'Science', grade: 11, curriculum: 'IEB', status: 'archived' },
      ],
      { a: 2.5 },
      { a: 3 },
    );
    expect(drafts).toEqual([
      draft({ key: 'a', id: 'a', name: 'Maths', balanceHours: 2.5, bookedLessons: 3 }),
      draft({ key: 'b', id: 'b', name: 'Science', grade: 11, curriculum: 'IEB', archived: true, initiallyArchived: true }),
    ]);
  });
});

describe('newSubjectDraft', () => {
  it('creates an unsaved draft with a unique key', () => {
    const a = newSubjectDraft('Physics');
    const b = newSubjectDraft();
    expect(a).toMatchObject({ id: null, name: 'Physics', archived: false, balanceHours: 0 });
    expect(b.name).toBe('');
    expect(a.key).not.toBe(b.key);
  });
});

describe('validateSubjectDrafts', () => {
  it('needs at least one active subject', () => {
    expect(validateSubjectDrafts([])).toBe('Add at least one subject.');
    expect(validateSubjectDrafts([draft({ id: 'a', archived: true })])).toBe('Add at least one subject.');
  });
  it('rejects blank names on active rows only', () => {
    expect(validateSubjectDrafts([draft(), draft({ key: 'x', name: '  ' })]))
      .toBe('Every subject needs a name — or remove the empty row.');
    expect(validateSubjectDrafts([draft(), draft({ key: 'x', id: 'x', name: ' ', archived: true })])).toBeNull();
  });
  it('rejects duplicate active names (case/space-insensitive)', () => {
    expect(validateSubjectDrafts([draft(), draft({ key: 'y', name: ' maths ' })])).toBe('Maths is listed twice.');
    expect(validateSubjectDrafts([draft(), draft({ key: 'y', id: 'y', name: 'maths', archived: true })])).toBeNull();
  });
  it('accepts a valid list', () => {
    expect(validateSubjectDrafts([draft(), draft({ key: 'y', name: 'Science' })])).toBeNull();
  });
});

describe('activeSubjectDrafts', () => {
  it('keeps non-archived rows in order', () => {
    const list = [draft({ key: 'a' }), draft({ key: 'b', archived: true }), draft({ key: 'c' })];
    expect(activeSubjectDrafts(list).map(d => d.key)).toEqual(['a', 'c']);
  });
});

describe('planSubjectChanges', () => {
  const initial = [
    draft({ key: 'a', id: 'a', name: 'Maths' }),
    draft({ key: 'b', id: 'b', name: 'Science' }),
    draft({ key: 'c', id: 'c', name: 'Art', archived: true, initiallyArchived: true }),
  ];

  it('is empty when nothing changed', () => {
    expect(planSubjectChanges(initial, initial)).toEqual({ add: [], update: [], archive: [], restore: [] });
    expect(subjectsChanged(initial, initial.map(d => ({ ...d, name: `${d.name} ` })))).toBe(false);
  });

  it('plans adds, renames/overrides, archives and restores', () => {
    const current = [
      { ...initial[0], name: 'Mathematics ', grade: 11 },
      { ...initial[1], archived: true },
      { ...initial[2], archived: false },
      draft({ key: 'n', name: ' Physics ', curriculum: 'IEB' }),
      draft({ key: 'blank', name: '' }),
    ];
    expect(planSubjectChanges(initial, current)).toEqual({
      add: [{ name: 'Physics', grade: null, curriculum: 'IEB' }],
      update: [{ id: 'a', patch: { subject: 'Mathematics', grade: 11 } }],
      archive: ['b'],
      restore: [{ id: 'c', name: 'Art' }],
    });
    expect(subjectsChanged(initial, current)).toBe(true);
  });

  it('ignores edits on rows that are (still) archived', () => {
    const current = [initial[0], initial[1], { ...initial[2], name: 'Drawing' }];
    expect(planSubjectChanges(initial, current).update).toEqual([]);
  });
});

describe('student page helpers', () => {
  it('subjectStatusTip follows the balance thresholds', () => {
    expect(subjectStatusTip(-0.5)).toBe('Owes hours — top-up required.');
    expect(subjectStatusTip(0.5)).toBe('Top-up due.');
    expect(subjectStatusTip(2)).toBe('Running low.');
    expect(subjectStatusTip(3)).toBeNull();
  });
  it('lowestSubject picks the active subject with the least balance', () => {
    const list = [
      { id: 'a', subject: 'Maths', status: 'active' as const, balance_hours: 3 },
      { id: 'b', subject: 'Science', status: 'active' as const, balance_hours: 0.5 },
      { id: 'c', subject: 'Art', status: 'archived' as const, balance_hours: -2 },
    ];
    expect(lowestSubject(list)?.id).toBe('b');
    expect(lowestSubject([])).toBeNull();
  });
  it('lessonSubjectName resolves null subject ids to the primary', () => {
    const names = { a: 'Maths', b: 'Science' };
    expect(lessonSubjectName('b', names, 'a')).toBe('Science');
    expect(lessonSubjectName(null, names, 'a')).toBe('Maths');
    expect(lessonSubjectName(undefined, names, null)).toBeNull();
  });
});

describe('subjectArchiveWarning', () => {
  it('is null when nothing is at stake', () => {
    expect(subjectArchiveWarning(draft({ balanceHours: 0, bookedLessons: 0 }))).toBeNull();
  });
  it('mentions credit, owing and booked lessons', () => {
    expect(subjectArchiveWarning(draft({ balanceHours: 2.5 }))).toBe(
      'Maths still has 2h 30m of prepaid credit. The balance is kept and comes back if you add Maths again.'
    );
    expect(subjectArchiveWarning(draft({ balanceHours: -1, bookedLessons: 2 }))).toBe(
      'Maths owes 1h. The balance is kept and comes back if you add Maths again. 2 booked lessons are still for Maths — move or cancel them.'
    );
    expect(subjectArchiveWarning(draft({ bookedLessons: 1 }))).toBe(
      '1 booked lesson is still for Maths — move or cancel it.'
    );
  });
});
