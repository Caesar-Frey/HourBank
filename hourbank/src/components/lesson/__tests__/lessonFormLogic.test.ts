import {
  balancePreview,
  buildEditPatch,
  claimWarning,
  defaultRecordMinutes,
  defaultRecordStart,
  defaultSubjectId,
  defaultTravelKm,
  parseKmInput,
  parseMinutesInput,
  stepBilled,
  timerReviewOverrides,
  timerReviewSaveRoute,
  topicsAfterSubjectChange,
  topicsUpdatedNote,
  travelPreview,
  validateLessonForm,
  type LessonFormValues,
} from '../lessonFormLogic';

const subjects = [
  { id: 'ss-1', subject: 'Maths' },
  { id: 'ss-2', subject: 'Science' },
];

describe('defaultSubjectId', () => {
  test('booked subject when it is still active', () => {
    expect(defaultSubjectId(subjects, 'ss-2', 'ss-1')).toBe('ss-2');
  });
  test('primary when booked subject is missing/archived', () => {
    expect(defaultSubjectId(subjects, 'gone', 'ss-1')).toBe('ss-1');
    expect(defaultSubjectId(subjects, null, 'ss-1')).toBe('ss-1');
  });
  test('first active when no primary; null when no subjects', () => {
    expect(defaultSubjectId(subjects, null, null)).toBe('ss-1');
    expect(defaultSubjectId([], null, null)).toBeNull();
  });
});

describe('defaults', () => {
  test('minutes = booked length, else 60', () => {
    expect(defaultRecordMinutes(90)).toBe(90);
    expect(defaultRecordMinutes(null)).toBe(60);
    expect(defaultRecordMinutes(0)).toBe(60);
  });

  test('start = booked time when already past', () => {
    const now = new Date('2026-10-12T12:00:00Z');
    const booked = '2026-10-12T09:00:00.000Z';
    const r = defaultRecordStart({ bookedStart: booked, minutes: 60, now });
    expect(r.start.toISOString()).toBe(booked);
    expect(r.movedFromBooking).toBe(false);
  });

  test('future booking → recorded as just taught (flagged)', () => {
    const now = new Date('2026-10-12T12:07:00Z');
    const r = defaultRecordStart({ bookedStart: '2026-10-12T15:00:00.000Z', minutes: 60, now });
    expect(r.start.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(r.movedFromBooking).toBe(true);
  });

  test('explicit start wins', () => {
    const now = new Date('2026-10-12T12:00:00Z');
    const r = defaultRecordStart({ bookedStart: '2026-10-12T09:00:00.000Z', explicitStart: '2026-10-11T08:00:00.000Z', minutes: 60, now });
    expect(r.start.toISOString()).toBe('2026-10-11T08:00:00.000Z');
  });

  test('travel km: online → null; lesson override → student default', () => {
    expect(defaultTravelKm({ mode: 'online', lessonKm: 12, studentKm: 8 })).toBeNull();
    expect(defaultTravelKm({ mode: 'in_person', lessonKm: 12, studentKm: 8 })).toBe(12);
    expect(defaultTravelKm({ mode: 'in_person', lessonKm: null, studentKm: 8 })).toBe(8);
    expect(defaultTravelKm({ mode: 'in_person', lessonKm: undefined, studentKm: null })).toBe(0);
  });
});

describe('inputs', () => {
  test('parseKmInput: comma decimals, blank, invalid', () => {
    expect(parseKmInput('12,5')).toEqual({ value: 12.5, error: null });
    expect(parseKmInput('')).toEqual({ value: null, error: null });
    expect(parseKmInput('abc').error).toBeTruthy();
    expect(parseKmInput('-3').error).toBeTruthy();
  });

  test('parseMinutesInput: digits only, clamps to 15..480', () => {
    expect(parseMinutesInput('75')).toBe(75);
    expect(parseMinutesInput('5')).toBe(15);
    expect(parseMinutesInput('999')).toBe(480);
    expect(parseMinutesInput('')).toBeNull();
  });

  test('stepBilled: 15-min steps within bounds', () => {
    expect(stepBilled(60, 1)).toBe(75);
    expect(stepBilled(15, -1)).toBe(15);
    expect(stepBilled(70, -1)).toBe(55);
  });
});

describe('balancePreview', () => {
  test('record: subject balance before → after', () => {
    const p = balancePreview({ subjectName: 'Maths', balanceNow: 3, billedMinutes: 60 });
    expect(p.text).toBe('Maths balance 3h → 2h');
    expect(p.after).toBe(2);
    expect(p.owes).toBe(false);
  });

  test('record: going negative says owes', () => {
    const p = balancePreview({ subjectName: 'Maths', balanceNow: 0.5, billedMinutes: 60 });
    expect(p.text).toBe('Maths balance 30m → owes 30m');
    expect(p.owes).toBe(true);
  });

  test('edit, same subject: original deduction is added back first', () => {
    // balance now 2h already includes the original 1h deduction; re-billed at 90m
    const p = balancePreview({
      subjectName: 'Maths', balanceNow: 2, billedMinutes: 90,
      original: { subjectId: 'ss-1', billedMinutes: 60 }, subjectId: 'ss-1',
    });
    expect(p.before).toBe(2);
    expect(p.after).toBe(1.5);
    expect(p.text).toBe('Maths balance 2h → 1h 30m');
  });

  test('edit, subject changed: target subject only loses the new billed time', () => {
    const p = balancePreview({
      subjectName: 'Science', balanceNow: 4, billedMinutes: 60,
      original: { subjectId: 'ss-1', billedMinutes: 60 }, subjectId: 'ss-2',
    });
    expect(p.after).toBe(3);
  });
});

describe('travelPreview', () => {
  const rates = { parentTravelMode: 'per_km' as const, flatFee: 0, perKm: 6 };
  test('in-person per km', () => {
    const t = travelPreview({ lessonMode: 'in_person', km: 20, ...rates });
    expect(t?.amount).toBe(120);
    expect(t?.text).toBe('Travel R 120.00 added to travel owed');
  });
  test('online or none → null', () => {
    expect(travelPreview({ lessonMode: 'online', km: 20, ...rates })).toBeNull();
    expect(travelPreview({ lessonMode: 'in_person', km: 20, parentTravelMode: 'none', flatFee: 0, perKm: 0 })).toBeNull();
  });
  test('edit with unchanged km/mode keeps the snapshot fee', () => {
    const t = travelPreview({ lessonMode: 'in_person', km: 20, ...rates, snapshot: { fee: 90, km: 20, mode: 'in_person' } });
    expect(t?.amount).toBe(90);
    expect(t?.text).toBe('Travel R 90.00 on travel owed');
  });
  test('edit with km changed reprices at the current rate', () => {
    const t = travelPreview({ lessonMode: 'in_person', km: 10, ...rates, snapshot: { fee: 90, km: 20, mode: 'in_person' } });
    expect(t?.amount).toBe(60);
    expect(t?.text).toContain('was R 90.00');
  });
});

describe('validateLessonForm', () => {
  const now = new Date('2026-10-12T12:00:00Z');
  test('future start and bad km are errors', () => {
    const e = validateLessonForm({ start: new Date('2026-10-12T13:00:00Z'), billedMinutes: 60, kmError: 'bad', subjectId: 'ss-1' }, now);
    expect(e.start).toBeTruthy();
    expect(e.km).toBe('bad');
  });
  test('missing subject is an error', () => {
    const e = validateLessonForm({ start: new Date('2026-10-12T10:00:00Z'), billedMinutes: 60, kmError: null, subjectId: null }, now);
    expect(e.subject).toBeTruthy();
  });
  test('valid → empty', () => {
    expect(validateLessonForm({ start: new Date('2026-10-12T10:00:00Z'), billedMinutes: 60, kmError: null, subjectId: 'ss-1' }, now)).toEqual({});
  });
});

describe('buildEditPatch', () => {
  const original: LessonFormValues = {
    subjectId: 'ss-1', start: new Date('2026-10-10T09:00:00.000Z'), billedMinutes: 60,
    mode: 'in_person', travelKm: 12, topics: ['Algebra'], notes: 'ok',
  };
  test('unchanged → empty patch', () => {
    expect(buildEditPatch(original, { ...original, topics: ['Algebra'] })).toEqual({});
  });
  test('only changed fields; blank notes → null', () => {
    const p = buildEditPatch(original, { ...original, billedMinutes: 90, travelKm: 15, notes: '  ', topics: ['Algebra', 'Graphs'] });
    expect(p).toEqual({ billedMinutes: 90, travelKm: 15, notes: null, topics: ['Algebra', 'Graphs'] });
  });
  test('switching to online drops km from the patch', () => {
    const p = buildEditPatch(original, { ...original, mode: 'online', travelKm: null });
    expect(p).toEqual({ mode: 'online' });
  });
  test('start + subject changes', () => {
    const p = buildEditPatch(original, { ...original, subjectId: 'ss-2', start: new Date('2026-10-10T10:00:00.000Z') });
    expect(p).toEqual({ subjectId: 'ss-2', startedAt: '2026-10-10T10:00:00.000Z' });
  });
});

test('claimWarning', () => {
  expect(claimWarning(false)).toBeNull();
  expect(claimWarning(true)).toMatch(/claim/);
  expect(claimWarning(true, 'Sep 2026')).toContain('claim for Sep 2026');
});

describe('timer review save decision', () => {
  const base = { subjectId: 'ss-1', bookedSubjectId: 'ss-1', mode: 'in_person' as const, km: 10, initialKm: 10 };

  it('no changes → no overrides', () => {
    expect(timerReviewOverrides(base)).toEqual({});
  });

  it('only the changed subject / km are overridden; online ignores km', () => {
    expect(timerReviewOverrides({ ...base, subjectId: 'ss-2' })).toEqual({ subjectId: 'ss-2' });
    expect(timerReviewOverrides({ ...base, km: 14 })).toEqual({ travelKm: 14 });
    expect(timerReviewOverrides({ ...base, mode: 'online', km: null })).toEqual({});
    expect(timerReviewOverrides({ ...base, subjectId: null })).toEqual({});
  });

  it('recordLesson only for a billed, started lesson with changes; else endSession', () => {
    expect(timerReviewSaveRoute({ overrides: { subjectId: 'ss-2' }, billedMinutes: 60, hasStarted: true })).toBe('record');
    expect(timerReviewSaveRoute({ overrides: {}, billedMinutes: 60, hasStarted: true })).toBe('end');
    // Zero-billed: endSession, which applies the same overrides (nothing dropped).
    expect(timerReviewSaveRoute({ overrides: { travelKm: 14 }, billedMinutes: 0, hasStarted: true })).toBe('end');
    expect(timerReviewSaveRoute({ overrides: { subjectId: 'ss-2' }, billedMinutes: 60, hasStarted: false })).toBe('end');
  });
});

describe('topicsAfterSubjectChange', () => {
  const maths = ['Algebra', 'Calculus'];
  const science = ['Electricity', 'Chemical change'];

  test('drops old-catalog topics not in the new catalog, keeps typed custom topics', () => {
    const r = topicsAfterSubjectChange({
      selected: ['Calculus', 'Exam prep', 'Electricity'],
      oldCatalog: maths,
      newCatalog: science,
    });
    expect(r.selected).toEqual(['Exam prep', 'Electricity']);
    expect(r.removed).toEqual(['Calculus']);
    expect(r.topics).toEqual(['Electricity', 'Chemical change', 'Exam prep']);
  });

  test('keeps catalog topics shared by both subjects; nothing removed', () => {
    const r = topicsAfterSubjectChange({ selected: ['Algebra'], oldCatalog: maths, newCatalog: ['Algebra', 'Graphs'] });
    expect(r.selected).toEqual(['Algebra']);
    expect(r.removed).toEqual([]);
    expect(r.topics).toEqual(['Algebra', 'Graphs']);
  });

  test('no selection → just the new catalog', () => {
    const r = topicsAfterSubjectChange({ selected: [], oldCatalog: maths, newCatalog: science });
    expect(r).toEqual({ topics: science, selected: [], removed: [] });
  });
});

describe('topicsUpdatedNote', () => {
  test('note only when topics were removed', () => {
    expect(topicsUpdatedNote(['Calculus'], 'Science')).toBe('Topics updated for Science');
    expect(topicsUpdatedNote([], 'Science')).toBeNull();
  });
});
