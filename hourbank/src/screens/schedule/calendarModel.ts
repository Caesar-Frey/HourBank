/**
 * Pure helpers for the Schedule calendar views (Day / Week / Month).
 * Imports calendar.ts helpers that do not touch the DB at call time.
 */
import {
  type CalendarEvent,
  eventTime,
  eventEndTime,
  eventOverlapsDay,
} from '../../db/calendar';
import type { EventKindKey } from '../../theme/eventColors';
import { formatDayShort, formatMinutes, formatTime, formatTimeRange, formatHours } from '../../utils/format';
import { sessionTypeLabel, paymentMethodLabel } from './labels';

export type CalendarView = 'day' | 'week' | 'month';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ─── Dates (local) ───────────────────────────────────────────────────────────

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
}

export function addMonths(d: Date, n: number): Date {
  // Clamp the day so 31 Jan + 1 month → 28/29 Feb, not 3 Mar.
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), lastDay));
}

/** Monday of the week containing d (local midnight). */
export function weekStart(d: Date): Date {
  const dow = d.getDay();
  return addDays(startOfDay(d), dow === 0 ? -6 : 1 - dow);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** YYYY-MM-DD in LOCAL time (route params for prefill). */
export function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Full Mon–Sun grid covering the month of `cursor` (4–6 rows). */
export function monthGridDays(cursor: Date): Date[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const start = weekStart(first);
  const end = addDays(weekStart(last), 6);
  const days: Date[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

export function weekDays(cursor: Date): Date[] {
  const ws = weekStart(cursor);
  return Array.from({ length: 7 }, (_, i) => addDays(ws, i));
}

/** Half-open [start, end) ISO range the view needs from the DB. */
export function viewRange(view: CalendarView, cursor: Date): { startISO: string; endISO: string } {
  let start: Date;
  let end: Date;
  if (view === 'month') {
    const days = monthGridDays(cursor);
    start = days[0];
    end = addDays(days[days.length - 1], 1);
  } else if (view === 'week') {
    start = weekStart(cursor);
    end = addDays(start, 7);
  } else {
    start = startOfDay(cursor);
    end = addDays(start, 1);
  }
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

export function shiftCursor(view: CalendarView, cursor: Date, delta: number): Date {
  if (view === 'month') return addMonths(cursor, delta);
  if (view === 'week') return addDays(cursor, delta * 7);
  return addDays(cursor, delta);
}

/** Navigator title: "October 2026" / "6–12 Oct" / "Thursday 9 Oct". */
export function viewTitle(view: CalendarView, cursor: Date): string {
  if (view === 'month') return `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`;
  if (view === 'week') {
    const ws = weekStart(cursor);
    const we = addDays(ws, 6);
    if (ws.getMonth() === we.getMonth()) return `${ws.getDate()}–${we.getDate()} ${SHORT_MONTH[ws.getMonth()]}`;
    return `${ws.getDate()} ${SHORT_MONTH[ws.getMonth()]}–${we.getDate()} ${SHORT_MONTH[we.getMonth()]}`;
  }
  return `${LONG_DOW[cursor.getDay()]} ${cursor.getDate()} ${SHORT_MONTH[cursor.getMonth()]}`;
}

/** True when the view already shows today (hides the "Today" jump). */
export function viewContainsToday(view: CalendarView, cursor: Date, now: Date = new Date()): boolean {
  if (view === 'day') return sameDay(cursor, now);
  if (view === 'week') return sameDay(weekStart(cursor), weekStart(now));
  return cursor.getFullYear() === now.getFullYear() && cursor.getMonth() === now.getMonth();
}

// ─── Events ──────────────────────────────────────────────────────────────────

export function eventKey(e: CalendarEvent): string {
  return e.kind === 'top_up' ? `top_up:${e.ledgerEntryId}` : `${e.kind}:${e.id}`;
}

/** Events touching `day` (multi-day events appear on every day they span). */
export function eventsForDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  return events.filter(e => eventOverlapsDay(e, day));
}

/** Group by local day key (YYYY-MM-DD) for each day in `days`. */
export function groupEventsByDay(events: CalendarEvent[], days: Date[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const day of days) map.set(isoDate(day), eventsForDay(events, day));
  return map;
}

export function isAllDay(e: CalendarEvent): boolean {
  return (e.kind === 'event' || e.kind === 'time_block') && e.allDay;
}

/** A scheduled lesson whose booked slot has ended without being started. */
export function isOverdue(e: CalendarEvent, now: Date = new Date()): boolean {
  return e.kind === 'session_scheduled' && Date.parse(eventEndTime(e)) <= now.getTime();
}

/** Key into EVENT_KIND_COLORS for an item. */
export function eventStyleKey(e: CalendarEvent, now: Date = new Date()): EventKindKey {
  switch (e.kind) {
    case 'session_scheduled': return isOverdue(e, now) ? 'overdue' : 'scheduled';
    case 'session_completed': return 'completed';
    case 'session_cancelled': return e.cancelReason === 'no_show' ? 'no_show' : 'cancelled';
    case 'top_up':            return 'top_up';
    case 'event':             return 'event';
    case 'time_block':        return 'time_block';
  }
}

/**
 * Time label for an item as shown on `day`:
 *   "09:30–10:30", "09:30" (point), "All day", "From 14:00" / "Until 11:00" (multi-day).
 */
export function eventTimeLabel(e: CalendarEvent, day?: Date): string {
  if (isAllDay(e)) return 'All day';
  const startIso = eventTime(e);
  const endIso = eventEndTime(e);
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (day) {
    const startsToday = sameDay(start, day);
    const endsToday = sameDay(end, day) || (end.getTime() === addDays(startOfDay(day), 1).getTime());
    if (!startsToday && !endsToday) return 'All day';
    if (startsToday && !endsToday && end > start) return `From ${formatTime(start)}`;
    if (!startsToday && endsToday) return `Until ${formatTime(end)}`;
  }
  if (end.getTime() <= start.getTime()) return formatTime(start);
  if (!sameDay(start, end)) return `${formatDayShort(start)} ${formatTime(start)} – ${formatDayShort(end)} ${formatTime(end)}`;
  return formatTimeRange(start, end);
}

/** Primary text: student name, or event/block title. */
export function eventTitle(e: CalendarEvent): string {
  switch (e.kind) {
    case 'session_scheduled':
    case 'session_completed':
    case 'session_cancelled':
    case 'top_up':
      return e.studentName;
    case 'event':
      return e.studentName ? `${e.title} · ${e.studentName}` : e.title;
    case 'time_block':
      return e.title.trim() || 'Busy';
  }
}

/** Short chip label for the dense month grid. */
export function eventChipLabel(e: CalendarEvent): string {
  switch (e.kind) {
    case 'session_scheduled':
    case 'session_completed':
    case 'session_cancelled':
      return e.studentName.trim().split(/\s+/)[0];
    case 'top_up':
      return `+${formatHours(e.hours)}`;
    case 'event':
      return e.title;
    case 'time_block':
      return e.title.trim() || 'Busy';
  }
}

/** Secondary line: status · type · booked/billed length, or payment method. */
export function eventMeta(e: CalendarEvent, now: Date = new Date()): string {
  const parts: string[] = [];
  switch (e.kind) {
    case 'session_scheduled':
      parts.push(isOverdue(e, now) ? 'Overdue — needs action' : 'Booked');
      if (e.sessionType !== 'general') parts.push(sessionTypeLabel(e.sessionType));
      if (e.durationMin > 0) parts.push(formatMinutes(e.durationMin));
      break;
    case 'session_completed':
      parts.push('Taught');
      if (e.sessionType !== 'general') parts.push(sessionTypeLabel(e.sessionType));
      if (e.durationMin > 0) parts.push(`${formatMinutes(e.durationMin)} billed`);
      break;
    case 'session_cancelled':
      if (e.cancelReason === 'no_show') {
        parts.push(e.billedMinutes > 0 ? `No-show · charged ${formatMinutes(e.billedMinutes)}` : 'No-show');
      } else {
        parts.push('Cancelled');
      }
      if (e.sessionType !== 'general') parts.push(sessionTypeLabel(e.sessionType));
      break;
    case 'top_up': {
      parts.push(`Top-up +${formatHours(e.hours)}`);
      const m = paymentMethodLabel(e.paymentMethod);
      if (m) parts.push(m);
      break;
    }
    case 'event':
      parts.push('Event');
      if (e.category) parts.push(e.category.charAt(0).toUpperCase() + e.category.slice(1));
      break;
    case 'time_block':
      parts.push('Blocked');
      break;
  }
  return parts.join(' · ');
}

/** Route to open when an item is tapped. Every lesson row goes to the lesson hub. */
export function eventRoute(e: CalendarEvent): string {
  switch (e.kind) {
    case 'session_scheduled':
    case 'session_completed':
    case 'session_cancelled':
      return `/lesson/${e.id}`;
    case 'top_up':
      return `/transaction/${e.ledgerEntryId}`;
    case 'event':
    case 'time_block':
      return `/calendar-event/${e.id}`;
  }
}

/** All-day items first, then by start time. */
export function sortForDay(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => {
    const ad = isAllDay(a) ? 0 : 1;
    const bd = isAllDay(b) ? 0 : 1;
    if (ad !== bd) return ad - bd;
    return Date.parse(eventTime(a)) - Date.parse(eventTime(b));
  });
}

// ─── Empty states ────────────────────────────────────────────────────────────

/**
 * Empty-state copy. Filter-aware so a hidden lesson is never mistaken for a
 * free day: "No lessons on Thu 9 Oct" vs "Nothing matches your filters".
 */
export function emptyCopy(view: CalendarView, cursor: Date, filterActive: boolean): string {
  if (filterActive) {
    if (view === 'day') return `Nothing on ${formatDayShort(cursor)} matches your filters`;
    if (view === 'week') return 'Nothing this week matches your filters';
    return 'Nothing this month matches your filters';
  }
  if (view === 'day') return `No lessons on ${formatDayShort(cursor)}`;
  if (view === 'week') return 'No lessons this week';
  return 'No lessons this month';
}
