import { createMigratedTestDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import { recordLesson, editLesson } from '../sessions';
import { createStudent, updateStudent, archiveStudent } from '../students';
import { createPackage } from '../packages';
import { addStudentSubject } from '../subjects';
import {
  getTravelOwed,
  settleTravel,
  listTravelSettlements,
  listTravelSettlementsForPackage,
  listTravelOwedByStudent,
  isTravelError,
} from '../travel';
import { listClaimablePool } from '../claims';
import { upsertTutorProfile } from '../tutorProfile';
import { getMonthSummary, listSessionsForMonth, listTopUpsForMonth, listTravelSettlementsForMonth } from '../reports';
import { parentTravelCharge } from '../../utils/travel';

const NOW = new Date('2026-10-12T15:00:00.000Z');
const base = { fullName: 'Amahle Dlamini', grade: 10, subject: 'Maths', curriculum: 'CAPS' as const };

function lesson(studentId: string, startedAt: string, extra: Partial<Parameters<typeof recordLesson>[0]> = {}) {
  return recordLesson({ studentId, startedAt, billedMinutes: 60, topics: [], mode: 'in_person', now: NOW, ...extra }).session;
}

describe('parentTravelCharge', () => {
  it('prices flat / per_km / none / online', () => {
    const b = { lessonMode: 'in_person' as const, flatFee: 80, perKm: 4.5, km: 12 };
    expect(parentTravelCharge({ ...b, parentTravelMode: 'flat' })).toBe(80);
    expect(parentTravelCharge({ ...b, parentTravelMode: 'per_km' })).toBe(54);
    expect(parentTravelCharge({ ...b, parentTravelMode: 'none' })).toBe(0);
    expect(parentTravelCharge({ ...b, parentTravelMode: 'per_km', lessonMode: 'online' })).toBe(0);
  });
});

describe('travel owed + settlements', () => {
  let db: TestDb;
  beforeEach(() => { db = createMigratedTestDb(); });
  afterEach(() => resetDbSingleton());

  function student() {
    return createStudent({ ...base, travelDistanceKm: 10, parentTravelMode: 'per_km', parentTravelPerKm: 5 });
  }

  it('owed = snapshotted charges of completed in-person lessons; historic lessons owe nothing', () => {
    const s = student();
    db.runSync(`INSERT INTO sessions (id, student_id, status, mode, started_at, ended_at, billed_minutes, created_at)
                VALUES ('old', ?, 'completed', 'in_person', '2026-09-01T10:00:00.000Z', '2026-09-01T11:00:00.000Z', 60, '2026-09-01T10:00:00.000Z')`, [s.id]);
    lesson(s.id, '2026-10-01T10:00:00.000Z');
    lesson(s.id, '2026-10-02T10:00:00.000Z', { travelKm: 20 });
    lesson(s.id, '2026-10-03T10:00:00.000Z', { mode: 'online' });
    const owed = getTravelOwed(s.id);
    expect(owed).toMatchObject({ amount: 150, charged: 150, settled: 0, lessonCount: 2, since: '2026-10-01T10:00:00.000Z' });
    expect(owed.lessons.map(l => [l.travel_km, l.parent_travel_fee, l.unpaid, l.subject_name])).toEqual([
      [10, 50, 50, 'Maths'],
      [20, 100, 100, 'Maths'],
    ]);
  });

  it('rate changes never reprice recorded lessons', () => {
    const s = student();
    lesson(s.id, '2026-10-01T10:00:00.000Z');
    updateStudent(s.id, { ...base, parentTravelPerKm: 9 });
    lesson(s.id, '2026-10-02T10:00:00.000Z');
    expect(getTravelOwed(s.id).amount).toBe(140);
  });

  it('settles on its own, partially, oldest lessons first', () => {
    const s = student();
    lesson(s.id, '2026-10-01T10:00:00.000Z');
    lesson(s.id, '2026-10-02T10:00:00.000Z');
    const st = settleTravel({ studentId: s.id, amount: 70, method: 'cash', note: 'Partial', now: NOW });
    expect(st).toMatchObject({ student_id: s.id, amount: 70, payment_method: 'cash', package_id: null, note: 'Partial' });
    const owed = getTravelOwed(s.id);
    expect(owed).toMatchObject({ amount: 30, settled: 70, lessonCount: 1, since: '2026-10-02T10:00:00.000Z' });
    expect(owed.lessons[0]).toMatchObject({ unpaid: 30, parent_travel_fee: 50 });
    settleTravel({ studentId: s.id, amount: 30, now: NOW });
    expect(getTravelOwed(s.id)).toMatchObject({ amount: 0, lessonCount: 0, lessons: [], since: null });
    expect(listTravelSettlements(s.id).map(x => x.amount)).toEqual([30, 70]);
  });

  it('settles with a top-up (package link, method defaults to the package method)', () => {
    const s = student();
    lesson(s.id, '2026-10-01T10:00:00.000Z');
    const { pkg } = createPackage({ studentId: s.id, hoursAdded: 5, amountPaid: 2750, paymentMethod: 'card' });
    const st = settleTravel({ studentId: s.id, amount: 50, packageId: pkg.id, now: NOW });
    expect(st).toMatchObject({ package_id: pkg.id, payment_method: 'card' });
    expect(listTravelSettlementsForPackage(pkg.id).map(x => x.id)).toEqual([st.id]);
  });

  it('rejects overpaying, non-positive amounts and foreign packages', () => {
    const s = student();
    const other = createStudent({ ...base, fullName: 'Other' });
    lesson(s.id, '2026-10-01T10:00:00.000Z');
    const err = (() => { try { settleTravel({ studentId: s.id, amount: 50.01 }); } catch (e) { return e; } return null; })();
    expect(isTravelError(err, 'EXCEEDS_OWED')).toBe(true);
    expect(() => settleTravel({ studentId: s.id, amount: 0 })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => settleTravel({ studentId: s.id, amount: NaN })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    const { pkg } = createPackage({ studentId: other.id, hoursAdded: 1, amountPaid: 1, paymentMethod: 'eft' });
    expect(() => settleTravel({ studentId: s.id, amount: 10, packageId: pkg.id })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(listTravelSettlements(s.id)).toEqual([]);
  });

  it('editing a lesson to online drops its charge; owed is never shown below 0', () => {
    const s = student();
    const l = lesson(s.id, '2026-10-01T10:00:00.000Z');
    settleTravel({ studentId: s.id, amount: 50 });
    editLesson(l.id, { mode: 'online', now: NOW });
    expect(getTravelOwed(s.id)).toMatchObject({ amount: 0, charged: 0, settled: 50, credit: 50 });
  });

  it('lists students with travel owed (archived excluded)', () => {
    const a = student();
    const b = createStudent({ ...base, fullName: 'Bongani', parentTravelMode: 'flat', parentTravelFlatFee: 80 });
    const c = student();
    lesson(a.id, '2026-10-01T10:00:00.000Z');
    lesson(b.id, '2026-10-01T12:00:00.000Z');
    lesson(c.id, '2026-10-01T14:00:00.000Z');
    archiveStudent(c.id);
    expect(listTravelOwedByStudent().map(r => [r.full_name, r.amount, r.lessonCount])).toEqual([
      ['Bongani', 80, 1],
      ['Amahle Dlamini', 50, 1],
    ]);
  });

  it('settlements show in Money In (month cash received + list)', () => {
    const s = student();
    lesson(s.id, '2026-10-01T10:00:00.000Z');
    createPackage({ studentId: s.id, hoursAdded: 5, amountPaid: 2750, paymentMethod: 'eft' });
    settleTravel({ studentId: s.id, amount: 50, now: new Date('2026-10-05T10:00:00.000Z') });
    const sum = getMonthSummary(2026, 9);
    expect(sum.travelCashRand).toBe(50);
    expect(sum.totalCashRand).toBe(2800);
    expect(sum.perStudent[0].cashRand).toBe(2800);
    expect(listTravelSettlementsForMonth(2026, 9).map(r => [r.student_full_name, r.amount])).toEqual([['Amahle Dlamini', 50]]);
  });
});

describe('subjects + per-lesson km in reports and payout claims', () => {
  beforeEach(() => createMigratedTestDb());
  afterEach(() => resetDbSingleton());

  it('payout claims use per-lesson km with the TUTOR travel config (not the parent rate)', () => {
    upsertTutorProfile({ hourly_rate: 300, travel_mode: 'distance', per_km_rate: 3 });
    const s = createStudent({ ...base, travelDistanceKm: 10, parentTravelMode: 'per_km', parentTravelPerKm: 5 });
    lesson(s.id, '2026-10-01T10:00:00.000Z');
    lesson(s.id, '2026-10-02T10:00:00.000Z', { travelKm: 20 });
    expect(listClaimablePool().map(l => l.travel_fee)).toEqual([30, 60]);
  });

  it('report rows carry the lesson/top-up subject; month summary has per-subject totals', () => {
    const s = createStudent({ ...base });
    const sci = addStudentSubject({ studentId: s.id, subject: 'Science' });
    createPackage({ studentId: s.id, subjectId: sci.id, hoursAdded: 5, amountPaid: 2750, paymentMethod: 'eft' });
    lesson(s.id, '2026-10-01T10:00:00.000Z', { subjectId: sci.id, billedMinutes: 90 });
    lesson(s.id, '2026-10-02T10:00:00.000Z');
    expect(listSessionsForMonth(2026, 9).map(r => r.subject_name)).toEqual(['Maths', 'Science']);
    expect(listTopUpsForMonth(2026, 9)[0].subject_name).toBe('Science');
    expect(getMonthSummary(2026, 9).perSubject.map(r => [r.subject, r.hours, r.sessions])).toEqual([
      ['Science', 1.5, 1],
      ['Maths', 1, 1],
    ]);
  });
});
