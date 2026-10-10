/**
 * Schedule filter model.
 *
 * Stores EXCLUSIONS, not inclusions: a student added after the filter was set
 * is visible by default, and an archived/deleted student id simply gets pruned.
 * Convert to the DB query shape with `toQueryFilters`.
 */
import type { CalendarFilters, EventKind, SessionTypeFilter } from '../../db/calendar';

export const ALL_EVENT_KINDS: EventKind[] = ['scheduled', 'completed', 'cancelled', 'top_up', 'event', 'time_block'];
export const ALL_SESSION_TYPES: SessionTypeFilter[] = ['general', 'review', 'test_prep', 'exam_prep'];

/** Impossible id used to express "no students" (an empty IN list means "all" to the query). */
export const NO_STUDENTS_SENTINEL = '__no_students__';

export interface ScheduleFilters {
  excludedStudentIds: string[];
  excludedKinds: EventKind[];
  excludedSessionTypes: SessionTypeFilter[];
}

export function defaultScheduleFilters(): ScheduleFilters {
  return { excludedStudentIds: [], excludedKinds: [], excludedSessionTypes: [] };
}

export function isFilterActive(f: ScheduleFilters): boolean {
  return f.excludedStudentIds.length > 0 || f.excludedKinds.length > 0 || f.excludedSessionTypes.length > 0;
}

/** Number of excluded things (for an accessible "3 filters" label). */
export function activeFilterCount(f: ScheduleFilters): number {
  return f.excludedStudentIds.length + f.excludedKinds.length + f.excludedSessionTypes.length;
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

/** Drop student ids that no longer exist (archived / deleted) and unknown kinds/types. */
export function pruneFilters(f: ScheduleFilters, knownStudentIds: string[]): ScheduleFilters {
  const known = new Set(knownStudentIds);
  const pruned: ScheduleFilters = {
    excludedStudentIds: uniq(f.excludedStudentIds.filter(id => known.has(id))),
    excludedKinds: uniq(f.excludedKinds.filter(k => ALL_EVENT_KINDS.includes(k))),
    excludedSessionTypes: uniq(f.excludedSessionTypes.filter(t => ALL_SESSION_TYPES.includes(t))),
  };
  return pruned;
}

export function filtersEqual(a: ScheduleFilters, b: ScheduleFilters): boolean {
  const same = (x: string[], y: string[]) => x.length === y.length && [...x].sort().join('|') === [...y].sort().join('|');
  return (
    same(a.excludedStudentIds, b.excludedStudentIds) &&
    same(a.excludedKinds, b.excludedKinds) &&
    same(a.excludedSessionTypes, b.excludedSessionTypes)
  );
}

/** Build the listEventsInRange query filters for the current student list. */
export function toQueryFilters(f: ScheduleFilters, allStudentIds: string[]): CalendarFilters {
  const excluded = new Set(f.excludedStudentIds);
  let studentIds: string[] | null = null;
  if (excluded.size > 0) {
    const included = allStudentIds.filter(id => !excluded.has(id));
    studentIds = included.length > 0 ? included : [NO_STUDENTS_SENTINEL];
  }
  const exKinds = new Set(f.excludedKinds);
  const exTypes = new Set(f.excludedSessionTypes);
  return {
    studentIds,
    eventKinds: new Set(ALL_EVENT_KINDS.filter(k => !exKinds.has(k))),
    sessionTypes: new Set(ALL_SESSION_TYPES.filter(t => !exTypes.has(t))),
  };
}

// ─── Draft editing (filter sheet) ────────────────────────────────────────────

export function toggleExcluded<T extends string>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value];
}

/** True when every student would be hidden — the sheet shows a hint. */
export function allStudentsExcluded(f: ScheduleFilters, allStudentIds: string[]): boolean {
  if (allStudentIds.length === 0) return false;
  const ex = new Set(f.excludedStudentIds);
  return allStudentIds.every(id => ex.has(id));
}

// ─── Persistence ─────────────────────────────────────────────────────────────

export function serializeFilters(f: ScheduleFilters): string {
  return JSON.stringify({ v: 2, ...f });
}

/**
 * Parse persisted filters. Unknown / legacy (v1 inclusion-list) shapes fall
 * back to defaults rather than guessing — v1 could not tell "all students"
 * apart from "the students that existed then".
 */
export function deserializeFilters(json: string | null | undefined): ScheduleFilters {
  if (!json) return defaultScheduleFilters();
  try {
    const raw = JSON.parse(json);
    if (!raw || raw.v !== 2) return defaultScheduleFilters();
    const arr = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);
    return {
      excludedStudentIds: arr(raw.excludedStudentIds),
      excludedKinds: arr(raw.excludedKinds).filter((k): k is EventKind => ALL_EVENT_KINDS.includes(k as EventKind)),
      excludedSessionTypes: arr(raw.excludedSessionTypes).filter((t): t is SessionTypeFilter =>
        ALL_SESSION_TYPES.includes(t as SessionTypeFilter)),
    };
  } catch {
    return defaultScheduleFilters();
  }
}
