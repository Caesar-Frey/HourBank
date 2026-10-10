import {
  ALL_EVENT_KINDS,
  NO_STUDENTS_SENTINEL,
  activeFilterCount,
  allStudentsExcluded,
  defaultScheduleFilters,
  deserializeFilters,
  filtersEqual,
  isFilterActive,
  pruneFilters,
  serializeFilters,
  toQueryFilters,
  toggleExcluded,
} from '../filterModel';

describe('filter model (exclusions)', () => {
  test('default is inactive and queries everything', () => {
    const f = defaultScheduleFilters();
    expect(isFilterActive(f)).toBe(false);
    const q = toQueryFilters(f, ['a', 'b']);
    expect(q.studentIds).toBeNull();
    expect(Array.from(q.eventKinds).sort()).toEqual([...ALL_EVENT_KINDS].sort());
    expect(q.sessionTypes.size).toBe(4);
  });

  test('excluding a student includes everyone else — including students added later', () => {
    const f = { ...defaultScheduleFilters(), excludedStudentIds: ['b'] };
    expect(toQueryFilters(f, ['a', 'b']).studentIds).toEqual(['a']);
    expect(toQueryFilters(f, ['a', 'b', 'newbie']).studentIds).toEqual(['a', 'newbie']);
    expect(isFilterActive(f)).toBe(true);
    expect(activeFilterCount(f)).toBe(1);
  });

  test('excluding every student queries none (sentinel, never an empty IN list)', () => {
    const f = { ...defaultScheduleFilters(), excludedStudentIds: ['a', 'b'] };
    expect(toQueryFilters(f, ['a', 'b']).studentIds).toEqual([NO_STUDENTS_SENTINEL]);
    expect(allStudentsExcluded(f, ['a', 'b'])).toBe(true);
    expect(allStudentsExcluded(f, ['a', 'b', 'c'])).toBe(false);
    expect(allStudentsExcluded(f, [])).toBe(false);
  });

  test('kinds and session types are excluded from the query sets', () => {
    const f = { ...defaultScheduleFilters(), excludedKinds: ['top_up' as const], excludedSessionTypes: ['review' as const] };
    const q = toQueryFilters(f, []);
    expect(q.eventKinds.has('top_up')).toBe(false);
    expect(q.eventKinds.has('scheduled')).toBe(true);
    expect(q.sessionTypes.has('review')).toBe(false);
  });

  test('prune drops unknown students (archived) and junk kinds', () => {
    const f = {
      excludedStudentIds: ['a', 'gone', 'a'],
      excludedKinds: ['event', 'bogus'] as never[],
      excludedSessionTypes: ['review'] as never[],
    };
    const p = pruneFilters(f, ['a', 'b']);
    expect(p.excludedStudentIds).toEqual(['a']);
    expect(p.excludedKinds).toEqual(['event']);
    expect(p.excludedSessionTypes).toEqual(['review']);
  });

  test('toggleExcluded + filtersEqual', () => {
    expect(toggleExcluded(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleExcluded(['a', 'b'], 'a')).toEqual(['b']);
    expect(filtersEqual(
      { excludedStudentIds: ['a', 'b'], excludedKinds: [], excludedSessionTypes: [] },
      { excludedStudentIds: ['b', 'a'], excludedKinds: [], excludedSessionTypes: [] },
    )).toBe(true);
  });

  test('serialize round-trips; legacy/garbage falls back to defaults', () => {
    const f = { excludedStudentIds: ['a'], excludedKinds: ['cancelled' as const], excludedSessionTypes: [] };
    expect(deserializeFilters(serializeFilters(f))).toEqual(f);
    const legacy = JSON.stringify({ studentIds: ['a'], eventKinds: ['scheduled'], sessionTypes: ['general'] });
    expect(deserializeFilters(legacy)).toEqual(defaultScheduleFilters());
    expect(deserializeFilters('{not json')).toEqual(defaultScheduleFilters());
    expect(deserializeFilters(null)).toEqual(defaultScheduleFilters());
  });
});
