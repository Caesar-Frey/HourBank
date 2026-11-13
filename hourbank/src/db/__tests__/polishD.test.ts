/**
 * Work package D (2026-11-12 polish handoff) — robustness, data parts.
 */
import { createMigratedTestDb, resetDbSingleton } from './testDb';
import { createScheduled, getSession, isSessionError, startSession, updateScheduled } from '../sessions';
import { createStudent } from '../students';
import { createPackage } from '../packages';
import { splitOverdue, OVERDUE_WINDOW_DAYS } from '../../screens/schedule/agendaModel';
import type { AgendaItem } from '../sessions';

const base = { fullName: 'Amahle Dlamini', grade: 10, subject: 'Maths', curriculum: 'CAPS' as const };

describe('D4 — reschedule is one write', () => {
  beforeEach(() => { createMigratedTestDb(); });
  afterEach(() => resetDbSingleton());

  it('moves date, length and mode together', () => {
    const s = createStudent(base);
    const b = createScheduled({ studentId: s.id, scheduledFor: '2026-11-20T13:00:00.000Z', estimatedDurationMinutes: 60, mode: 'in_person', session_type: 'general' });
    updateScheduled(b.id, { scheduledFor: '2026-11-21T09:00:00.000Z', estimatedDurationMinutes: 90, mode: 'online', session_type: 'general', topics: [] });
    expect(getSession(b.id)).toMatchObject({ scheduled_for: '2026-11-21T09:00:00.000Z', estimated_duration_minutes: 90, mode: 'online' });
  });

  it('refuses a lesson that has started meanwhile', () => {
    const s = createStudent(base);
    createPackage({ studentId: s.id, hoursAdded: 5, amountPaid: 2750, paymentMethod: 'eft' });
    const b = createScheduled({ studentId: s.id, scheduledFor: '2026-11-12T13:00:00.000Z', estimatedDurationMinutes: 60, mode: 'in_person', session_type: 'general' });
    startSession(b.id, { now: new Date('2026-11-12T13:00:00.000Z') });
    let err: unknown;
    try {
      updateScheduled(b.id, { scheduledFor: '2026-11-21T09:00:00.000Z', estimatedDurationMinutes: 90, mode: 'online', session_type: 'general', topics: [] });
    } catch (e) { err = e; }
    expect(isSessionError(err, 'INVALID_STATE')).toBe(true);
    expect(getSession(b.id)!.scheduled_for).toBe('2026-11-12T13:00:00.000Z');
  });
});

describe('D2 — overdue list is capped', () => {
  it(`folds lessons older than ${OVERDUE_WINDOW_DAYS} days behind "Show older"`, () => {
    const now = new Date('2026-11-12T10:00:00.000Z');
    const item = (id: string, daysAgo: number) => ({ id, scheduled_for: new Date(now.getTime() - daysAgo * 86_400_000).toISOString() }) as AgendaItem;
    const { recent, older } = splitOverdue([item('a', 2), item('b', 59), item('c', 61), item('d', 400)], now);
    expect(recent.map(i => i.id)).toEqual(['a', 'b']);
    expect(older.map(i => i.id)).toEqual(['c', 'd']);
  });
});
