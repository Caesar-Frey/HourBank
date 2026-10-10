import type { CalendarEvent } from '../../../db/calendar';
import {
  addMonths,
  emptyCopy,
  eventChipLabel,
  eventMeta,
  eventRoute,
  eventStyleKey,
  eventTimeLabel,
  eventTitle,
  groupEventsByDay,
  isoDate,
  monthGridDays,
  shiftCursor,
  sortForDay,
  viewContainsToday,
  viewRange,
  viewTitle,
  weekDays,
  weekStart,
} from '../calendarModel';

const d = (day: number, h = 0, m = 0, month = 9) => new Date(2026, month, day, h, m);
const iso = (day: number, h = 0, m = 0, month = 9) => d(day, h, m, month).toISOString();

const scheduled = (over: Partial<Extract<CalendarEvent, { kind: 'session_scheduled' }>> = {}): CalendarEvent => ({
  kind: 'session_scheduled', id: 's1', studentId: 'st', studentName: 'Ann Lee', scheduledFor: iso(9, 15),
  durationMin: 60, sessionType: 'test_prep', mode: 'in_person', ...over,
});

describe('date helpers', () => {
  test('weekStart is Monday; week has 7 days', () => {
    expect(isoDate(weekStart(d(9)))).toBe('2026-10-05'); // Thu 9 Oct → Mon 5 Oct
    expect(isoDate(weekStart(d(11)))).toBe('2026-10-05'); // Sunday belongs to previous Monday
    expect(weekDays(d(9)).map(isoDate)).toHaveLength(7);
  });

  test('month grid covers whole weeks (Oct 2026 = 5 rows)', () => {
    const days = monthGridDays(d(9));
    expect(days.length % 7).toBe(0);
    expect(isoDate(days[0])).toBe('2026-09-28');
    expect(isoDate(days[days.length - 1])).toBe('2026-11-01');
  });

  test('addMonths clamps end of month', () => {
    expect(isoDate(addMonths(new Date(2026, 0, 31), 1))).toBe('2026-02-28');
  });

  test('viewRange is half-open on local midnights', () => {
    const r = viewRange('day', d(9, 14));
    expect(r.startISO).toBe(d(9).toISOString());
    expect(r.endISO).toBe(d(10).toISOString());
    const w = viewRange('week', d(9));
    expect(w.startISO).toBe(d(5).toISOString());
    expect(w.endISO).toBe(d(12).toISOString());
  });

  test('titles + navigation', () => {
    expect(viewTitle('month', d(9))).toBe('October 2026');
    expect(viewTitle('week', d(9))).toBe('5–11 Oct');
    expect(viewTitle('day', d(9))).toBe('Friday 9 Oct');
    expect(isoDate(shiftCursor('week', d(9), 1))).toBe('2026-10-16');
    expect(viewContainsToday('week', d(5), d(9))).toBe(true);
    expect(viewContainsToday('day', d(8), d(9))).toBe(false);
  });
});

describe('event grouping + styling', () => {
  test('multi-day event appears on every day it spans', () => {
    const trip: CalendarEvent = { kind: 'time_block', id: 'b', startsAt: iso(9, 14), endsAt: iso(11, 10), allDay: false, title: '' };
    const map = groupEventsByDay([trip], weekDays(d(9)));
    expect(map.get('2026-10-09')).toHaveLength(1);
    expect(map.get('2026-10-10')).toHaveLength(1);
    expect(map.get('2026-10-11')).toHaveLength(1);
    expect(map.get('2026-10-08')).toHaveLength(0);
    expect(eventTimeLabel(trip, d(9))).toBe('From 14:00');
    expect(eventTimeLabel(trip, d(10))).toBe('All day');
    expect(eventTimeLabel(trip, d(11))).toBe('Until 10:00');
    expect(eventTitle(trip)).toBe('Busy');
  });

  test('scheduled lesson: booked range, overdue once its slot has ended', () => {
    const e = scheduled();
    expect(eventTimeLabel(e, d(9))).toBe('15:00–16:00');
    expect(eventStyleKey(e, d(9, 15, 30))).toBe('scheduled');
    expect(eventStyleKey(e, d(9, 16, 0))).toBe('overdue');
    expect(eventMeta(e, d(9, 10))).toBe('Booked · Test prep · 1h');
    expect(eventMeta(e, d(10))).toBe('Overdue — needs action · Test prep · 1h');
    expect(eventRoute(e)).toBe('/lesson/s1');
    expect(eventChipLabel(e)).toBe('Ann');
  });

  test('cancelled / no-show / completed / top-up labels and routes', () => {
    const noShow: CalendarEvent = {
      kind: 'session_cancelled', id: 'n', studentId: 'st', studentName: 'Ann', scheduledFor: iso(9, 9),
      sessionType: 'general', cancelReason: 'no_show', billedMinutes: 45,
    };
    expect(eventStyleKey(noShow)).toBe('no_show');
    expect(eventMeta(noShow)).toBe('No-show · charged 45m');
    expect(eventRoute(noShow)).toBe('/lesson/n');

    const done: CalendarEvent = {
      kind: 'session_completed', id: 'c', studentId: 'st', studentName: 'Ann', startedAt: iso(9, 9),
      endedAt: iso(9, 10, 30), durationMin: 90, sessionType: 'review', mode: 'online',
    };
    expect(eventTimeLabel(done, d(9))).toBe('09:00–10:30');
    expect(eventMeta(done)).toBe('Taught · Review · 1h 30m billed');

    const top: CalendarEvent = { kind: 'top_up', ledgerEntryId: 'L', studentId: 'st', studentName: 'Ann', createdAt: iso(9, 8), hours: 10, paymentMethod: 'eft' };
    expect(eventMeta(top)).toBe('Top-up +10h · EFT');
    expect(eventRoute(top)).toBe('/transaction/L');
    expect(eventTimeLabel(top, d(9))).toBe('08:00');
  });

  test('sortForDay puts all-day first', () => {
    const allDay: CalendarEvent = { kind: 'event', id: 'e', startsAt: iso(9), endsAt: iso(9, 23, 59), allDay: true, title: 'Exam' };
    const sorted = sortForDay([scheduled(), allDay]);
    expect(sorted[0].kind).toBe('event');
    expect(eventTimeLabel(allDay, d(9))).toBe('All day');
  });
});

describe('emptyCopy', () => {
  test('filter-aware', () => {
    expect(emptyCopy('day', d(8), false)).toBe('No lessons on Thu 8 Oct');
    expect(emptyCopy('day', d(8), true)).toBe('Nothing on Thu 8 Oct matches your filters');
    expect(emptyCopy('month', d(8), false)).toBe('No lessons this month');
  });
});
