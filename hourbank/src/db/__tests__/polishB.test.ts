/**
 * Work package B (2026-11-12 polish handoff) — accuracy and trust, second tier.
 */
import { createMigratedTestDb, createTestDb, resetDbSingleton } from './testDb';
import { getDb } from '../client';
import { recordLesson, editLesson, getSession } from '../sessions';
import { finaliseClaim, getClaimedLineForSession, getClaimLines, listEditedClaimLines, listClaimablePool } from '../claims';
import { getTravelOwed, listTravelOwedByStudent, listTravelSettlementsForPackage } from '../travel';
import { upsertTutorProfile } from '../tutorProfile';
import { runMigrations, ALL_MIGRATIONS, MIGRATION_002, MIGRATION_012_POLISH_B } from '../migrations';
import { archiveStudent, createStudent, getStudent, listArchivedStudents } from '../students';
import { getPrimarySubjectId } from '../subjects';
import { createPackage } from '../packages';
import { listLedger } from '../ledger';
import { paidAtIso } from '../../components/student/flowLogic';
import { claimEditEffect } from '../../components/lesson/lessonFormLogic';
import { formatRand } from '../../utils/format';

const base = { fullName: 'Amahle Dlamini', grade: 10, subject: 'Maths', curriculum: 'CAPS' as const };

function travelStudent() {
  const s = createStudent({ ...base, travelDistanceKm: 10, parentTravelMode: 'per_km', parentTravelPerKm: 5 });
  return { s, subj: getPrimarySubjectId(s.id)! };
}

describe('B1 — top-up payment date', () => {
  beforeEach(() => { createMigratedTestDb(); });
  afterEach(() => resetDbSingleton());

  it('stores the paid-on date on the package and its ledger entry', () => {
    const s = createStudent(base);
    const paidAt = '2026-10-31T10:00:00.000Z';
    const { pkg, entry } = createPackage({ studentId: s.id, hoursAdded: 10, amountPaid: 5500, paymentMethod: 'eft', paidAt });
    expect(pkg.created_at).toBe(paidAt);
    expect(entry.created_at).toBe(paidAt);
    expect(getDb().getFirstSync<{ c: string }>('SELECT created_at AS c FROM credit_packages WHERE id = ?', [pkg.id])!.c).toBe(paidAt);
  });

  it('a future date is clamped to now', () => {
    const s = createStudent(base);
    const before = Date.now();
    const { pkg } = createPackage({ studentId: s.id, hoursAdded: 1, amountPaid: 600, paymentMethod: 'eft', paidAt: '2999-01-01T00:00:00.000Z' });
    expect(new Date(pkg.created_at).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(pkg.created_at).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('a backdated top-up sits in history where it was paid, with a matching running balance', () => {
    const s = createStudent(base);
    recordLesson({ studentId: s.id, startedAt: '2026-11-05T10:00:00.000Z', billedMinutes: 60, topics: [], now: new Date('2026-11-06T10:00:00.000Z') });
    createPackage({ studentId: s.id, hoursAdded: 10, amountPaid: 5500, paymentMethod: 'eft', paidAt: '2026-10-01T10:00:00.000Z' });
    const rows = listLedger(s.id); // newest first
    expect(rows.map(r => r.type)).toEqual(['session_deduction', 'top_up']);
    expect(rows[1].balance_after).toBe(10);
    expect(rows[0].balance_after).toBe(9);
  });

  it('paidAtIso keeps now for today and noon for an earlier day', () => {
    const now = new Date(2026, 10, 12, 17, 43);
    expect(paidAtIso(new Date(2026, 10, 12, 9, 0), now)).toBe(now.toISOString());
    expect(paidAtIso(new Date(2026, 9, 31, 8, 0), now)).toBe(new Date(2026, 9, 31, 12, 0).toISOString());
    expect(paidAtIso(new Date(2026, 11, 1), now)).toBe(now.toISOString());
  });
});

describe('B2 — top-up and travel in one transaction', () => {
  beforeEach(() => { createMigratedTestDb(); });
  afterEach(() => resetDbSingleton());

  it('settles travel with the package', () => {
    const { s } = travelStudent();
    createPackage({ studentId: s.id, hoursAdded: 2, amountPaid: 1100, paymentMethod: 'eft' });
    recordLesson({ studentId: s.id, startedAt: '2026-11-05T10:00:00.000Z', billedMinutes: 60, topics: [], mode: 'in_person', now: new Date('2026-11-06T10:00:00.000Z') });
    expect(getTravelOwed(s.id).amount).toBe(50);
    const { pkg, travel } = createPackage({ studentId: s.id, hoursAdded: 10, amountPaid: 5500, paymentMethod: 'cash', travelAmount: 50 });
    expect(travel).toMatchObject({ amount: 50, package_id: pkg.id, payment_method: 'cash' });
    expect(getTravelOwed(s.id).amount).toBe(0);
  });

  it('a travel failure adds no credit', () => {
    const s = createStudent(base);
    expect(() => createPackage({ id: 'pkg-x', studentId: s.id, hoursAdded: 10, amountPaid: 5500, paymentMethod: 'eft', travelAmount: 99 })).toThrow();
    expect(getDb().getFirstSync('SELECT id FROM credit_packages WHERE id = ?', ['pkg-x'])).toBeNull();
    expect(listLedger(s.id)).toHaveLength(0);
    expect(listTravelSettlementsForPackage('pkg-x')).toHaveLength(0);
  });

  it('retrying with the same id returns the same package and settlement', () => {
    const { s } = travelStudent();
    recordLesson({ studentId: s.id, startedAt: '2026-11-05T10:00:00.000Z', billedMinutes: 60, topics: [], mode: 'in_person', now: new Date('2026-11-06T10:00:00.000Z') });
    const a = createPackage({ id: 'p1', studentId: s.id, hoursAdded: 10, amountPaid: 5500, paymentMethod: 'eft', travelAmount: 50 });
    const b = createPackage({ id: 'p1', studentId: s.id, hoursAdded: 10, amountPaid: 5500, paymentMethod: 'eft', travelAmount: 50 });
    expect(b.travel?.id).toBe(a.travel?.id);
    expect(listTravelSettlementsForPackage('p1')).toHaveLength(1);
  });
});

describe('B4 — lessons edited after a claim', () => {
  beforeEach(() => { createMigratedTestDb(); upsertTutorProfile({ hourly_rate: 300 }); });
  afterEach(() => resetDbSingleton());

  it('the claim stays frozen and the edit is listed with its rand difference', () => {
    const s = createStudent(base);
    createPackage({ studentId: s.id, hoursAdded: 10, amountPaid: 5500, paymentMethod: 'eft' });
    const { session } = recordLesson({ studentId: s.id, startedAt: '2026-10-05T10:00:00.000Z', billedMinutes: 60, topics: [], mode: 'online', now: new Date('2026-10-06T10:00:00.000Z') });
    const { claim } = finaliseClaim({ sessionIds: [session.id] });
    expect(listEditedClaimLines(claim.id)).toEqual([]);

    editLesson(session.id, { billedMinutes: 120 });
    expect(getClaimLines(claim.id)[0].lesson_fee).toBe(300);
    const edited = listEditedClaimLines(claim.id);
    expect(edited).toHaveLength(1);
    expect(edited[0]).toMatchObject({ session_id: session.id, claimed_hours: 1, current_hours: 2, difference: 300 });
  });

  it('the edit confirm states the rand effect', () => {
    const s = createStudent(base);
    createPackage({ studentId: s.id, hoursAdded: 10, amountPaid: 5500, paymentMethod: 'eft' });
    const { session } = recordLesson({ studentId: s.id, startedAt: '2026-10-05T10:00:00.000Z', billedMinutes: 60, topics: [], mode: 'online', now: new Date('2026-10-06T10:00:00.000Z') });
    finaliseClaim({ sessionIds: [session.id], periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z' });
    const line = getClaimedLineForSession(session.id)!;
    expect(line).toMatchObject({ billedHours: 1, rate: 300, claimTotal: 300 });
    const effect = claimEditEffect({
      claimLabel: line.periodLabel, claimTotal: line.claimTotal, claimedHours: line.billedHours, claimedMode: line.mode,
      claimedTravel: line.travelFee, rate: line.rate, newBilledMinutes: 120, newMode: 'online', formatRand,
    })!;
    expect(effect.message).toContain(`The claim stays at ${formatRand(300)}`);
    expect(effect.message).toContain(`the extra ${formatRand(300)} is only paid if you void and re-claim`);
    expect(claimEditEffect({
      claimLabel: null, claimTotal: 300, claimedHours: 1, claimedMode: 'online', claimedTravel: 0, rate: 300,
      newBilledMinutes: 60, newMode: 'online', formatRand,
    })).toBeNull();
  });
});

describe('B5 / migration 012 — claim line rate', () => {
  afterEach(() => resetDbSingleton());

  it('new claims store the rate per line', () => {
    createMigratedTestDb();
    upsertTutorProfile({ hourly_rate: 320 });
    const s = createStudent(base);
    const { session } = recordLesson({ studentId: s.id, startedAt: '2026-10-05T10:00:00.000Z', billedMinutes: 90, topics: [], mode: 'online', now: new Date('2026-10-06T10:00:00.000Z') });
    expect(listClaimablePool()[0].rate).toBe(320);
    const { claim } = finaliseClaim({ sessionIds: [session.id] });
    expect(getClaimLines(claim.id)[0].rate).toBe(320);
  });

  it('backfills existing lines from lesson fee ÷ hours, and is idempotent', () => {
    const db = createTestDb();
    const pre = ALL_MIGRATIONS.slice(0, ALL_MIGRATIONS.indexOf(MIGRATION_012_POLISH_B));
    runMigrations(pre);
    upsertTutorProfile({ hourly_rate: 300 });
    const s = createStudent(base);
    const { session } = recordLesson({ studentId: s.id, startedAt: '2026-10-05T10:00:00.000Z', billedMinutes: 90, topics: [], mode: 'online', now: new Date('2026-10-06T10:00:00.000Z') });
    // An old build wrote lines without a rate column.
    db.runSync(`INSERT INTO claims (id, payout_rate, travel_mode, lesson_fee_total, travel_total, grand_total, created_at) VALUES ('c1', 300, 'flat', 450, 0, 450, 'x')`);
    db.runSync(`INSERT INTO claim_lines (id, claim_id, session_id, billed_hours, mode, lesson_fee, travel_fee, created_at) VALUES ('l1', 'c1', ?, 1.5, 'online', 450, 0, 'x')`, [session.id]);
    db.runSync(`INSERT INTO claim_lines (id, claim_id, session_id, billed_hours, mode, lesson_fee, travel_fee, created_at) VALUES ('l2', 'c1', ?, 0, 'online', 0, 0, 'x')`, [session.id]);
    runMigrations(ALL_MIGRATIONS);
    const rates = db.getAllSync<{ id: string; rate: number | null }>('SELECT id, rate FROM claim_lines ORDER BY id');
    expect(rates).toEqual([{ id: 'l1', rate: 300 }, { id: 'l2', rate: null }]);
    expect(() => 'run' in MIGRATION_012_POLISH_B && MIGRATION_012_POLISH_B.run(db as never)).not.toThrow();
  });
});

describe('B6 — archived students stay in what is owed', () => {
  beforeEach(() => { createMigratedTestDb(); });
  afterEach(() => resetDbSingleton());

  it('travel owed keeps archived students, flagged', () => {
    const { s } = travelStudent();
    recordLesson({ studentId: s.id, startedAt: '2026-11-05T10:00:00.000Z', billedMinutes: 60, topics: [], mode: 'in_person', now: new Date('2026-11-06T10:00:00.000Z') });
    archiveStudent(s.id);
    expect(listTravelOwedByStudent()).toEqual([expect.objectContaining({ student_id: s.id, amount: 50, archived: true })]);
  });

  it('archived students load read-only on request', () => {
    const s = createStudent(base);
    recordLesson({ studentId: s.id, startedAt: '2026-11-05T10:00:00.000Z', billedMinutes: 60, topics: [], now: new Date('2026-11-06T10:00:00.000Z') });
    archiveStudent(s.id);
    expect(getStudent(s.id)).toBeNull();
    expect(getStudent(s.id, { includeArchived: true })?.status).toBe('archived');
    expect(listArchivedStudents()[0].current_balance).toBe(-1);
  });
});

describe('B8 — migration 002 keeps every session column', () => {
  afterEach(() => resetDbSingleton());

  it('copies billed length, pause and cancel reason from a pre-002 table', () => {
    const db = createTestDb();
    db.runSync(`INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at) VALUES ('st', 'A', 10, 'Maths', 'CAPS', 'active', 'x')`);
    db.runSync(
      `INSERT INTO sessions (id, student_id, status, billed_minutes, paused_at, cancel_reason, duration_minutes)
       VALUES ('s1', 'st', 'completed', 45, '2026-01-01T10:00:00.000Z', NULL, 50),
              ('s2', 'st', 'cancelled', NULL, NULL, 'no_show', NULL)`
    );
    runMigrations([MIGRATION_002]);
    const rows = db.getAllSync<{ id: string; billed_minutes: number | null; paused_at: string | null; cancel_reason: string | null }>(
      'SELECT id, billed_minutes, paused_at, cancel_reason FROM sessions ORDER BY id'
    );
    expect(rows).toEqual([
      { id: 's1', billed_minutes: 45, paused_at: '2026-01-01T10:00:00.000Z', cancel_reason: null },
      { id: 's2', billed_minutes: null, paused_at: null, cancel_reason: 'no_show' },
    ]);
  });
});

describe('B9 — legacy lessons with no travel fee', () => {
  beforeEach(() => { createMigratedTestDb(); });
  afterEach(() => resetDbSingleton());

  it('stay unpriced when only hours or notes change', () => {
    const { s } = travelStudent();
    createPackage({ studentId: s.id, hoursAdded: 10, amountPaid: 5500, paymentMethod: 'eft' });
    const { session } = recordLesson({ studentId: s.id, startedAt: '2026-11-05T10:00:00.000Z', billedMinutes: 60, topics: [], mode: 'in_person', now: new Date('2026-11-06T10:00:00.000Z') });
    getDb().runSync(
      `UPDATE sessions SET parent_travel_fee = NULL, travel_km = NULL, parent_travel_mode_snapshot = NULL,
         parent_travel_flat_snapshot = NULL, parent_travel_per_km_snapshot = NULL WHERE id = ?`,
      [session.id]
    );
    editLesson(session.id, { billedMinutes: 90, notes: 'fixed' });
    expect(getSession(session.id)!.parent_travel_fee).toBeNull();
    // An explicit km change prices it.
    editLesson(session.id, { travelKm: 12 });
    expect(getSession(session.id)!.parent_travel_fee).toBe(60);
  });
});
