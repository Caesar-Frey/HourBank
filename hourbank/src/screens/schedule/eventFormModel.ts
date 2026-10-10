/**
 * Pure helpers for the calendar event / time block form.
 * The form holds two full Date values (start, end); pickers edit either the
 * date part or the time part.
 */

export type EventFormKind = 'event' | 'time_block';

/** Default title stored for a time block left untitled. */
export const DEFAULT_BLOCK_TITLE = 'Busy';

export function withDatePart(base: Date, picked: Date): Date {
  const r = new Date(base);
  r.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
  return r;
}

export function withTimePart(base: Date, picked: Date): Date {
  const r = new Date(base);
  r.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
  return r;
}

/**
 * Changing the start moves the end by the same amount (duration preserved),
 * like every calendar app. A non-positive old duration falls back to 1 hour.
 */
export function shiftEndWithStart(oldStart: Date, oldEnd: Date, newStart: Date): Date {
  const duration = oldEnd.getTime() - oldStart.getTime();
  return new Date(newStart.getTime() + (duration > 0 ? duration : 60 * 60_000));
}

function dayIndex(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Returns an error message, or null when the range is valid. */
export function validateEventRange(start: Date, end: Date, allDay: boolean): string | null {
  if (allDay) {
    return dayIndex(end) < dayIndex(start) ? 'End date can’t be before the start date.' : null;
  }
  return end.getTime() < start.getTime() ? 'End time can’t be before the start time.' : null;
}

/** Stored ISO bounds. All-day spans local midnight of start → 23:59:59 of end day. */
export function eventIsoRange(start: Date, end: Date, allDay: boolean): { startsAt: string; endsAt: string } {
  if (allDay) {
    return {
      startsAt: new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0).toISOString(),
      endsAt: new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59).toISOString(),
    };
  }
  const s = new Date(start);
  s.setSeconds(0, 0);
  const e = new Date(end);
  e.setSeconds(0, 0);
  return { startsAt: s.toISOString(), endsAt: e.toISOString() };
}

/** Title rules: required for events; optional for time blocks (defaults to "Busy"). */
export function resolveTitle(kind: EventFormKind, raw: string): { title: string } | { error: string } {
  const t = raw.trim();
  if (t) return { title: t };
  if (kind === 'time_block') return { title: DEFAULT_BLOCK_TITLE };
  return { error: 'Give the event a title.' };
}

/** Initial start/end for a new item on `dateParam` (YYYY-MM-DD), 09:00–10:00. */
export function initialRange(dateParam: string | undefined, now: Date = new Date()): { start: Date; end: Date } {
  let base = now;
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const [y, m, d] = dateParam.split('-').map(Number);
    base = new Date(y, m - 1, d);
  }
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 9, 0, 0, 0);
  return { start, end: new Date(start.getTime() + 60 * 60_000) };
}
