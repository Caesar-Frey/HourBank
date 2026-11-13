/**
 * Work package A (2026-11-12 polish handoff) — wrong money or hours.
 * Each describe block starts from the scenario in the handoff.
 */
import { createMigratedTestDb, resetDbSingleton } from './testDb';
import { getDb } from '../client';
import type { TestDb } from './testDb';
import {
  recordLesson, createScheduled, startSession, createAndStartUnscheduled, endSession, editLesson, markNoShow,
  setInFlightMode, getSession, removeLesson, findOverlappingLesson, isSessionError, LessonInClaimError,
  getActiveOrPausedSession,
} from '../sessions';
import { finaliseClaim, listClaimablePool, voidClaim } from '../claims';
import { getTravelOwed } from '../travel';
import { upsertTutorProfile } from '../tutorProfile';
import { listSessionsForMonth } from '../reports';
import { runMigrations, ALL_MIGRATIONS, MIGRATION_011_POLISH_A } from '../migrations';
import { createTestDb } from './testDb';
import { isRunawayTimer, runawayDefaultEnd, taughtMinutesUntil, defaultBilledMinutes, snapToStep } from '../../utils/duration';
import { createStudent, listActiveStudents } from '../students';
import { getPrimarySubjectId, getSubjectBalance, getSubjectBalances } from '../subjects';
import { createPackage } from '../packages';
import { currentBalance, listLedger } from '../ledger';
import { balanceStatus, normaliseHours } from '../../utils/balance';
import { formatHours } from '../../utils/format';

const base = { fullName: 'Amahle Dlamini', grade: 10, subject: 'Maths', curriculum: 'CAPS' as const };
const NOW = new Date('2026-10-12T15:00:00.000Z');
const NOW_NOV = new Date('2026-11-06T10:00:00.000Z');

function getDbRun(sql: string, params: string[]) {
  getDb().runSync(sql, params);
}

function lessonsAt(studentId: string, count: number, minutes: number) {
  for (let i = 0; i < count; i++) {
    const start = new Date(NOW.getTime() - (count - i) * 24 * 3600_000).toISOString();
    recordLesson({ studentId, startedAt: start, billedMinutes: minutes, topics: [], now: NOW });
  }
}

describe('A4 — float drift never shows OWES 0m', () => {
  let db: TestDb;
  beforeEach(() => { db = createMigratedTestDb(); });
  afterEach(() => resetDbSingleton());

  it.each([
    [5, 6, 50],
    [5, 15, 20],
  ])('%ih top-up then %i × %i-minute lessons is exactly 0 and low', (hours, count, minutes) => {
    void db;
    const s = createStudent(base);
    const subj = getPrimarySubjectId(s.id)!;
    createPackage({ studentId: s.id, subjectId: subj, hoursAdded: hours, amountPaid: 1000, paymentMethod: 'eft' });
    lessonsAt(s.id, count, minutes);

    const total = currentBalance(s.id);
    expect(Object.is(total, 0)).toBe(true);
    expect(getSubjectBalance(s.id, subj)).toBe(0);
    expect(getSubjectBalances(s.id)[0].balance_hours).toBe(0);
    const row = listActiveStudents().find(r => r.id === s.id)!;
    expect(Object.is(row.current_balance, 0)).toBe(true);
    expect(row.subject_balances[0].balance_hours).toBe(0);
    expect(listLedger(s.id)[0].balance_after).toBe(0);
    expect(balanceStatus(total)).toBe('low');
    expect(formatHours(total)).toBe('0m');
  });

  it('normaliseHours snaps to whole minutes and never returns −0', () => {
    expect(Object.is(normaliseHours(-2.2e-16), 0)).toBe(true);
    expect(normaliseHours(1.4999999999)).toBe(1.5);
    expect(normaliseHours(-0.25)).toBe(-0.25);
    expect(balanceStatus(-2.2e-16)).toBe('low');
    expect(formatHours(-2.2e-16)).toBe('0m');
  });
});

function travelStudent() {
  const s = createStudent({ ...base, travelDistanceKm: 10, parentTravelMode: 'per_km', parentTravelPerKm: 5 });
  const subj = getPrimarySubjectId(s.id)!;
  createPackage({ studentId: s.id, subjectId: subj, hoursAdded: 10, amountPaid: 5500, paymentMethod: 'eft' });
  return { s, subj };
}

describe('A1 — timer mode toggle persists and prices travel', () => {
  beforeEach(() => { createMigratedTestDb(); upsertTutorProfile({ travel_mode: 'distance', per_km_rate: 4 }); });
  afterEach(() => resetDbSingleton());

  it('toggle to online survives a reload and ending gives no travel', () => {
    const { s } = travelStudent();
    const booked = createScheduled({ studentId: s.id, scheduledFor: '2026-10-12T13:00:00.000Z', estimatedDurationMinutes: 60, mode: 'in_person', session_type: 'general' });
    startSession(booked.id, { now: new Date('2026-10-12T13:00:00.000Z') });
    expect(setInFlightMode(booked.id, 'online')).toBe(true);
    // resume path re-reads the row
    expect(getActiveOrPausedSession()!.mode).toBe('online');
    endSession({ sessionId: booked.id, endedAt: '2026-10-12T14:00:00.000Z', durationMinutes: 60, billedMinutes: 60, topics: [] });
    const done = getSession(booked.id)!;
    expect(done.mode).toBe('online');
    expect(done.parent_travel_fee ?? 0).toBe(0);
    expect(done.travel_km).toBeNull();
    expect(listClaimablePool().find(l => l.session_id === booked.id)!.travel_fee).toBe(0);
  });

  it('endSession accepts a mode override from the review', () => {
    const { s } = travelStudent();
    const live = createAndStartUnscheduled({ studentId: s.id, mode: 'online', now: new Date('2026-10-12T13:00:00.000Z') });
    endSession({ sessionId: live.id, endedAt: '2026-10-12T14:00:00.000Z', durationMinutes: 60, billedMinutes: 60, topics: [], mode: 'in_person' });
    expect(getSession(live.id)).toMatchObject({ mode: 'in_person', travel_km: 10, parent_travel_fee: 50 });
  });

  it('setInFlightMode leaves finished lessons alone', () => {
    const { s } = travelStudent();
    const { session } = recordLesson({ studentId: s.id, startedAt: '2026-10-10T10:00:00.000Z', billedMinutes: 60, topics: [], now: NOW });
    expect(setInFlightMode(session.id, 'online')).toBe(false);
    expect(getSession(session.id)!.mode).toBe('in_person');
  });
});

describe('A2 — runaway timers', () => {
  it.each([
    [60, 119, false], [60, 121, true], [30, 89, false], [30, 91, true],
    [120, 239, false], [120, 241, true], [null, 240, false], [null, 241, true],
  ])('booked %p, elapsed %p → runaway %p', (booked, elapsed, expected) => {
    expect(isRunawayTimer(elapsed, booked)).toBe(expected);
  });

  it('the 22h scenario defaults to the booked end and bills 1h', () => {
    const started = '2026-11-04T13:00:00.000Z';
    const elapsed = (new Date('2026-11-05T11:14:00.000Z').getTime() - new Date(started).getTime()) / 60_000;
    expect(isRunawayTimer(elapsed, 60)).toBe(true);
    const end = runawayDefaultEnd(started, 60);
    expect(end.toISOString()).toBe('2026-11-04T14:00:00.000Z');
    const taught = taughtMinutesUntil(started, end, 0);
    expect(taught).toBe(60);
    expect(defaultBilledMinutes(taught, 60, 30)).toBe(60);
    expect(runawayDefaultEnd(started, null).toISOString()).toBe('2026-11-04T14:00:00.000Z');
  });

  it('taught time never subtracts more pause than the span', () => {
    expect(taughtMinutesUntil('2026-11-04T13:00:00.000Z', new Date('2026-11-04T14:00:00.000Z'), 600)).toBe(50);
    expect(taughtMinutesUntil('2026-11-04T13:00:00.000Z', new Date('2026-11-04T13:10:00.000Z'), 99_999)).toBe(0);
  });

  it('ending at the chosen time lands the lesson on its own day for claims', () => {
    createMigratedTestDb();
    const { s } = travelStudent();
    const live = createAndStartUnscheduled({ studentId: s.id, mode: 'online', estimatedMinutes: 60, now: new Date('2026-11-04T13:00:00.000Z') });
    endSession({ sessionId: live.id, endedAt: '2026-11-04T14:00:00.000Z', durationMinutes: 60, billedMinutes: 60, topics: [] });
    const pool = listClaimablePool({ start: '2026-11-04T00:00:00.000Z', end: '2026-11-05T00:00:00.000Z' });
    expect(pool.map(l => l.session_id)).toContain(live.id);
    expect(currentBalance(s.id)).toBe(9);
    resetDbSingleton();
  });

  it('correcting the billed time of a forgotten timer lesson fixes its end too', () => {
    createMigratedTestDb();
    const { s } = travelStudent();
    const live = createAndStartUnscheduled({ studentId: s.id, mode: 'online', estimatedMinutes: 60, now: new Date('2026-11-04T13:00:00.000Z') });
    endSession({ sessionId: live.id, endedAt: '2026-11-05T11:14:00.000Z', durationMinutes: 1334, billedMinutes: 1320, topics: [] });
    editLesson(live.id, { billedMinutes: 60, now: NOW_NOV });
    expect(getSession(live.id)).toMatchObject({ billed_minutes: 60, duration_minutes: 60, ended_at: '2026-11-04T14:00:00.000Z' });
    // an ordinary billed tweak keeps the taught length and end
    const rec = recordLesson({ studentId: s.id, startedAt: '2026-11-03T13:00:00.000Z', billedMinutes: 60, minutes: 55, topics: [], now: NOW_NOV });
    editLesson(rec.session.id, { billedMinutes: 90, now: NOW_NOV });
    expect(getSession(rec.session.id)).toMatchObject({ billed_minutes: 90, duration_minutes: 55, ended_at: '2026-11-03T13:55:00.000Z' });
    resetDbSingleton();
  });

  it('snapToStep keeps lengths on the grid', () => {
    expect(snapToStep(50, 30)).toBe(60);
    expect(snapToStep(10, 15)).toBe(15);
    expect(snapToStep(0, 30)).toBe(30);
  });
});

describe('A3 — timer lessons snapshot the parent travel terms', () => {
  beforeEach(() => { createMigratedTestDb(); });
  afterEach(() => resetDbSingleton());

  it('a rate rise never reprices a timer lesson', () => {
    const { s } = travelStudent();
    const live = createAndStartUnscheduled({ studentId: s.id, mode: 'in_person', now: new Date('2026-10-12T13:00:00.000Z') });
    endSession({ sessionId: live.id, endedAt: '2026-10-12T14:00:00.000Z', durationMinutes: 60, billedMinutes: 60, topics: [] });
    expect(getSession(live.id)).toMatchObject({ parent_travel_fee: 50, parent_travel_mode_snapshot: 'per_km', parent_travel_per_km_snapshot: 5 });
    getDbRun(`UPDATE students SET parent_travel_per_km = 9 WHERE id = ?`, [s.id]);
    editLesson(live.id, { travelKm: 20, now: NOW });
    expect(getSession(live.id)!.parent_travel_fee).toBe(100);
  });
});

describe('A6 — duplicates and removing a lesson', () => {
  beforeEach(() => { createMigratedTestDb(); });
  afterEach(() => resetDbSingleton());

  it('finds an overlapping recorded lesson', () => {
    const { s } = travelStudent();
    const { session } = recordLesson({ studentId: s.id, startedAt: '2026-11-05T13:00:00.000Z', billedMinutes: 60, topics: [], now: NOW_NOV });
    expect(findOverlappingLesson(s.id, '2026-11-05T13:30:00.000Z', 60)?.id).toBe(session.id);
    expect(findOverlappingLesson(s.id, '2026-11-05T14:00:00.000Z', 60)).toBeNull();
    expect(findOverlappingLesson(s.id, '2026-11-05T12:00:00.000Z', 60)).toBeNull();
    expect(findOverlappingLesson(s.id, '2026-11-05T13:00:00.000Z', 60, session.id)).toBeNull();
  });

  it('remove restores the subject balance exactly and leaves the pool, reports and travel owed', () => {
    const { s, subj } = travelStudent();
    const { session } = recordLesson({ studentId: s.id, startedAt: '2026-11-05T13:00:00.000Z', billedMinutes: 50, topics: [], now: NOW_NOV });
    expect(getTravelOwed(s.id).amount).toBe(50);
    expect(getSubjectBalance(s.id, subj)).toBeCloseTo(10 - 50 / 60, 9);
    const { entry } = removeLesson(session.id, NOW_NOV);
    expect(entry).toMatchObject({ type: 'adjustment', reason: 'Lesson removed', related_session_id: session.id });
    expect(getSubjectBalance(s.id, subj)).toBe(10);
    expect(getSession(session.id)).toMatchObject({ status: 'cancelled', cancel_reason: 'removed', parent_travel_fee: null });
    expect(getSession(session.id)!.removed_at).toBeTruthy();
    expect(listClaimablePool().some(l => l.session_id === session.id)).toBe(false);
    expect(listSessionsForMonth(2026, 10).some(r => r.id === session.id)).toBe(false);
    expect(getTravelOwed(s.id).amount).toBe(0);
    expect(() => editLesson(session.id, { billedMinutes: 30 })).toThrow();
    expect(() => removeLesson(session.id)).toThrow();
  });

  it('remove is blocked while the lesson is claimed, and allowed after a void', () => {
    const { s } = travelStudent();
    const { session } = recordLesson({ studentId: s.id, startedAt: '2026-11-05T13:00:00.000Z', billedMinutes: 60, topics: [], now: NOW_NOV });
    const { claim } = finaliseClaim({ sessionIds: [session.id] });
    let err: unknown = null;
    try { removeLesson(session.id); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(LessonInClaimError);
    expect(isSessionError(err, 'INVALID_STATE')).toBe(true);
    expect(currentBalance(s.id)).toBe(9);
    voidClaim({ claimId: claim.id });
    removeLesson(session.id);
    expect(currentBalance(s.id)).toBe(10);
  });

  it('a charged no-show can be removed too', () => {
    const { s } = travelStudent();
    const b = createScheduled({ studentId: s.id, scheduledFor: '2026-11-05T13:00:00.000Z', estimatedDurationMinutes: 60, mode: 'in_person', session_type: 'general' });
    markNoShow(b.id, { charge: true });
    expect(currentBalance(s.id)).toBe(9);
    removeLesson(b.id);
    expect(currentBalance(s.id)).toBe(10);
    expect(listClaimablePool().some(l => l.session_id === b.id)).toBe(false);
  });
});

describe('A7 / decision 4 — no-show travel is off by default', () => {
  beforeEach(() => { createMigratedTestDb(); upsertTutorProfile({ travel_mode: 'distance', per_km_rate: 4 }); });
  afterEach(() => resetDbSingleton());

  function bookedNoShow(studentId: string) {
    return createScheduled({ studentId, scheduledFor: '2026-11-05T13:00:00.000Z', estimatedDurationMinutes: 60, mode: 'in_person', session_type: 'general' });
  }

  it('off: no parent travel, no tutor travel allowance', () => {
    const { s } = travelStudent();
    const b = bookedNoShow(s.id);
    markNoShow(b.id, { charge: true });
    expect(getSession(b.id)).toMatchObject({ no_show_travel: 0, parent_travel_fee: null });
    expect(getTravelOwed(s.id).amount).toBe(0);
    const line = listClaimablePool().find(l => l.session_id === b.id)!;
    expect(line.lesson_fee).toBeGreaterThan(0);
    expect(line.travel_fee).toBe(0);
  });

  it('on: parent travel charged at snapshot terms and the tutor claims the allowance', () => {
    const { s } = travelStudent();
    const b = bookedNoShow(s.id);
    markNoShow(b.id, { charge: true, includeTravel: true });
    expect(getSession(b.id)).toMatchObject({ no_show_travel: 1, parent_travel_fee: 50, parent_travel_per_km_snapshot: 5 });
    expect(getTravelOwed(s.id).amount).toBe(50);
    expect(listClaimablePool().find(l => l.session_id === b.id)!.travel_fee).toBe(40);
  });

  it('editable later from the edit form', () => {
    const { s } = travelStudent();
    const b = bookedNoShow(s.id);
    markNoShow(b.id, { charge: true });
    editLesson(b.id, { noShowTravel: true });
    expect(getTravelOwed(s.id).amount).toBe(50);
    editLesson(b.id, { noShowTravel: false });
    expect(getTravelOwed(s.id).amount).toBe(0);
    expect(listClaimablePool().find(l => l.session_id === b.id)!.travel_fee).toBe(0);
  });

  it('an uncharged no-show ignores includeTravel', () => {
    const { s } = travelStudent();
    const b = bookedNoShow(s.id);
    markNoShow(b.id, { charge: false, includeTravel: true });
    expect(getSession(b.id)).toMatchObject({ no_show_travel: 0, parent_travel_fee: null });
  });
});

describe('migration 011', () => {
  afterEach(() => resetDbSingleton());
  const PRE_011 = ALL_MIGRATIONS.slice(0, ALL_MIGRATIONS.indexOf(MIGRATION_011_POLISH_A));

  it('runs after 010', () => {
    expect(ALL_MIGRATIONS.indexOf(MIGRATION_011_POLISH_A)).toBeGreaterThan(0);
  });

  it.each([
    [5, 15], [10, 15], [15, 15], [30, 30],
  ])('billing step %i becomes %i', (from, to) => {
    const db = createTestDb();
    runMigrations(PRE_011);
    db.runSync(`INSERT INTO tutor_profile (id, full_name, created_at, updated_at, billing_round_minutes) VALUES ('tp', '', 'x', 'x', ?)`, [from]);
    runMigrations(ALL_MIGRATIONS);
    expect(db.getFirstSync<{ m: number }>('SELECT billing_round_minutes AS m FROM tutor_profile')!.m).toBe(to);
  });

  it('existing tutors are not asked to confirm rates; a blank fresh profile is', () => {
    const db = createTestDb();
    runMigrations(PRE_011);
    db.runSync(`INSERT INTO tutor_profile (id, full_name, created_at, updated_at) VALUES ('tp', 'Jane', 'x', 'x')`);
    runMigrations(ALL_MIGRATIONS);
    expect(db.getFirstSync<{ r: string | null }>('SELECT rates_confirmed_at AS r FROM tutor_profile')!.r).toBeTruthy();
    resetDbSingleton();

    const db2 = createTestDb();
    runMigrations(PRE_011);
    db2.runSync(`INSERT INTO tutor_profile (id, full_name, created_at, updated_at) VALUES ('tp', '', 'x', 'x')`);
    runMigrations(ALL_MIGRATIONS);
    expect(db2.getFirstSync<{ r: string | null }>('SELECT rates_confirmed_at AS r FROM tutor_profile')!.r).toBeNull();
  });

  it('a top-up counts as in use', () => {
    const db = createTestDb();
    runMigrations(PRE_011);
    db.runSync(`INSERT INTO tutor_profile (id, full_name, created_at, updated_at) VALUES ('tp', '', 'x', 'x')`);
    const s = createStudent(base);
    createPackage({ studentId: s.id, hoursAdded: 1, amountPaid: 600, paymentMethod: 'eft' });
    runMigrations(ALL_MIGRATIONS);
    expect(db.getFirstSync<{ r: string | null }>('SELECT rates_confirmed_at AS r FROM tutor_profile')!.r).toBeTruthy();
  });

  it('adds the session columns with safe defaults and is idempotent', () => {
    const db = createTestDb();
    runMigrations(PRE_011);
    const s = createStudent(base);
    const b = createScheduled({ studentId: s.id, scheduledFor: '2026-11-05T13:00:00.000Z', estimatedDurationMinutes: 60, mode: 'in_person', session_type: 'general' });
    runMigrations(ALL_MIGRATIONS);
    expect(getSession(b.id)).toMatchObject({ no_show_travel: 0, removed_at: null });
    // re-running the migration body is harmless
    expect(() => MIGRATION_011_POLISH_A.version && ('run' in MIGRATION_011_POLISH_A) && MIGRATION_011_POLISH_A.run(db as never)).not.toThrow();
  });
});
