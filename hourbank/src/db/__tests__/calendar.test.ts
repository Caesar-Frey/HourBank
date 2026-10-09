process.env.TZ = 'Africa/Johannesburg';

import { createMigratedTestDb as createTestDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import {
  listEventsInRange,
  findOverlappingCalendarItems,
  defaultFilters,
  eventTime,
  eventEndTime,
  eventOverlapsDay,
} from '../calendar';

function seedStudent(db: TestDb, id: string, name: string, status = 'active') {
  db.runSync(
    `INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at)
     VALUES (?, ?, 10, 'Mathematics', 'CAPS', ?, '2026-01-01T00:00:00.000Z')`,
    [id, name, status]
  );
}

function seedScheduled(db: TestDb, id: string, studentId: string, at: string, minutes: number | null) {
  db.runSync(
    `INSERT INTO sessions (id, student_id, mode, status, scheduled_for, estimated_duration_minutes, created_at)
     VALUES (?, ?, 'in_person', 'scheduled', ?, ?, ?)`,
    [id, studentId, at, minutes, at]
  );
}

function seedCompleted(db: TestDb, id: string, studentId: string, startedAt: string, endedAt: string, billed: number) {
  db.runSync(
    `INSERT INTO sessions (id, student_id, mode, status, started_at, ended_at, duration_minutes, billed_minutes, created_at)
     VALUES (?, ?, 'in_person', 'completed', ?, ?, ?, ?, ?)`,
    [id, studentId, startedAt, endedAt, billed + 10, billed, startedAt]
  );
}

function seedCalendarEvent(
  db: TestDb,
  id: string,
  kind: 'event' | 'time_block',
  startsAt: string,
  endsAt: string | null,
  opts: { allDay?: boolean; studentId?: string | null; title?: string } = {}
) {
  db.runSync(
    `INSERT INTO calendar_events (id, kind, student_id, starts_at, ends_at, all_day, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, kind, opts.studentId ?? null, startsAt, endsAt, opts.allDay ? 1 : 0, opts.title ?? id, startsAt, startsAt]
  );
}

// Local (SAST) helpers
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m, d, h, min).toISOString();

describe('findOverlappingCalendarItems', () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb();
    seedStudent(db, 's1', 'Alice');
    seedStudent(db, 'sx', 'Archived Al', 'archived');
  });
  afterEach(() => resetDbSingleton());

  it('detects a same-day overlap with a scheduled lesson (julianday both sides)', () => {
    seedScheduled(db, 'l1', 's1', local(2026, 9, 9, 14), 60); // 14:00–15:00
    const r = findOverlappingCalendarItems(local(2026, 9, 9, 14, 30), local(2026, 9, 9, 15, 30));
    expect(r.sessions.map(s => s.id)).toEqual(['l1']);
  });

  it('back-to-back lessons do not conflict', () => {
    seedScheduled(db, 'l1', 's1', local(2026, 9, 9, 14), 60);
    const r = findOverlappingCalendarItems(local(2026, 9, 9, 15), local(2026, 9, 9, 16));
    expect(r.sessions).toHaveLength(0);
  });

  it('null estimated duration is treated as 60 minutes', () => {
    seedScheduled(db, 'l1', 's1', local(2026, 9, 9, 14), null);
    const r = findOverlappingCalendarItems(local(2026, 9, 9, 14, 45), local(2026, 9, 9, 15, 15));
    expect(r.sessions.map(s => s.id)).toEqual(['l1']);
  });

  it('ignores lessons of archived students', () => {
    seedScheduled(db, 'l1', 'sx', local(2026, 9, 9, 14), 60);
    const r = findOverlappingCalendarItems(local(2026, 9, 9, 14), local(2026, 9, 9, 15));
    expect(r.sessions).toHaveLength(0);
  });

  it('can exclude the lesson being rescheduled', () => {
    seedScheduled(db, 'l1', 's1', local(2026, 9, 9, 14), 60);
    const r = findOverlappingCalendarItems(local(2026, 9, 9, 14), local(2026, 9, 9, 15), { excludeSessionId: 'l1' });
    expect(r.sessions).toHaveLength(0);
  });

  it('only time blocks count as busy (events like exams do not)', () => {
    seedCalendarEvent(db, 'b1', 'time_block', local(2026, 9, 9, 13), local(2026, 9, 9, 16));
    seedCalendarEvent(db, 'e1', 'event', local(2026, 9, 9, 13), local(2026, 9, 9, 16));
    const r = findOverlappingCalendarItems(local(2026, 9, 9, 14), local(2026, 9, 9, 15));
    expect(r.calendarItems.map(c => c.id)).toEqual(['b1']);
  });

  it('a time block without an end does not conflict with everything after it', () => {
    seedCalendarEvent(db, 'b1', 'time_block', local(2026, 9, 1, 9), null);
    const r = findOverlappingCalendarItems(local(2026, 9, 9, 14), local(2026, 9, 9, 15));
    expect(r.calendarItems).toHaveLength(0);
  });

  it('an all-day time block without an end blocks that whole day', () => {
    seedCalendarEvent(db, 'b1', 'time_block', local(2026, 9, 9), null, { allDay: true });
    expect(findOverlappingCalendarItems(local(2026, 9, 9, 14), local(2026, 9, 9, 15)).calendarItems).toHaveLength(1);
    expect(findOverlappingCalendarItems(local(2026, 9, 10, 14), local(2026, 9, 10, 15)).calendarItems).toHaveLength(0);
  });
});

describe('listEventsInRange', () => {
  let db: TestDb;
  const dayStart = local(2026, 9, 9);
  const dayEnd = local(2026, 9, 10);
  beforeEach(() => {
    db = createTestDb();
    seedStudent(db, 's1', 'Alice');
    seedStudent(db, 'sx', 'Archived Al', 'archived');
  });
  afterEach(() => resetDbSingleton());

  it('scheduled lessons carry their estimated duration', () => {
    seedScheduled(db, 'l1', 's1', local(2026, 9, 9, 14), 90);
    const ev = listEventsInRange(dayStart, dayEnd, defaultFilters());
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'session_scheduled', durationMin: 90 });
  });

  it('completed lessons are placed at started_at with a time range', () => {
    seedCompleted(db, 'c1', 's1', local(2026, 9, 9, 9), local(2026, 9, 9, 10, 5), 60);
    const ev = listEventsInRange(dayStart, dayEnd, defaultFilters());
    expect(ev).toHaveLength(1);
    const e = ev[0];
    expect(e.kind).toBe('session_completed');
    if (e.kind !== 'session_completed') throw new Error('unreachable');
    expect(e.startedAt).toBe(local(2026, 9, 9, 9));
    expect(e.endedAt).toBe(local(2026, 9, 9, 10, 5));
    expect(e.durationMin).toBe(60);
    expect(eventTime(e)).toBe(local(2026, 9, 9, 9));
    expect(eventEndTime(e)).toBe(local(2026, 9, 9, 10, 5));
  });

  it('a lesson that started before midnight belongs to its start day', () => {
    seedCompleted(db, 'c1', 's1', local(2026, 9, 8, 23, 30), local(2026, 9, 9, 0, 30), 60);
    expect(listEventsInRange(dayStart, dayEnd, defaultFilters())).toHaveLength(0);
    expect(listEventsInRange(local(2026, 9, 8), dayStart, defaultFilters())).toHaveLength(1);
  });

  it('multi-day events appear on every day they span', () => {
    seedCalendarEvent(db, 'trip', 'time_block', local(2026, 9, 8), local(2026, 9, 10, 23, 59), { allDay: true });
    const ev = listEventsInRange(dayStart, dayEnd, defaultFilters());
    expect(ev.map(e => (e.kind === 'time_block' ? e.id : null))).toEqual(['trip']);
    expect(eventOverlapsDay(ev[0], new Date(2026, 9, 9))).toBe(true);
    expect(eventOverlapsDay(ev[0], new Date(2026, 9, 11))).toBe(false);
  });

  it('events that ended before the range are excluded', () => {
    seedCalendarEvent(db, 'old', 'event', local(2026, 9, 7, 9), local(2026, 9, 7, 10));
    expect(listEventsInRange(dayStart, dayEnd, defaultFilters())).toHaveLength(0);
  });

  it('excludes archived students everywhere (lessons, top-ups, student events)', () => {
    seedScheduled(db, 'l1', 'sx', local(2026, 9, 9, 14), 60);
    seedCompleted(db, 'c1', 'sx', local(2026, 9, 9, 9), local(2026, 9, 9, 10), 60);
    db.runSync(
      `INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, created_at)
       VALUES ('t1', 'sx', 'top_up', 5, 5, ?)`,
      [local(2026, 9, 9, 8)]
    );
    seedCalendarEvent(db, 'exam', 'event', local(2026, 9, 9, 8), null, { studentId: 'sx' });
    seedCalendarEvent(db, 'general', 'event', local(2026, 9, 9, 8), null);
    const ev = listEventsInRange(dayStart, dayEnd, defaultFilters());
    expect(ev.map(e => e.kind)).toEqual(['event']);
  });
});
