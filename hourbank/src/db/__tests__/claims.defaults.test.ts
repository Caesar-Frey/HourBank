process.env.TZ = 'Africa/Johannesburg';

import { createMigratedTestDb as createTestDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import {
  listClaimablePool,
  finaliseClaim,
  getDefaultPayoutRate,
  DEFAULT_PAYOUT_RATE,
  formatClaimPeriod,
} from '../claims';

describe('claims without a tutor_profile row', () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb();
  });
  afterEach(() => resetDbSingleton());

  function seedLesson(): string {
    db.runSync(
      `INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at)
       VALUES ('s1', 'A', 10, 'Mathematics', 'CAPS', 'active', '2026-01-01T00:00:00.000Z')`
    );
    db.runSync(
      `INSERT INTO sessions (id, student_id, mode, started_at, ended_at, billed_minutes, duration_minutes, status, created_at)
       VALUES ('l1', 's1', 'online', '2026-03-15T09:00:00.000Z', '2026-03-15T10:00:00.000Z', 60, 60, 'completed', '2026-03-15T09:00:00.000Z')`
    );
    return 'l1';
  }

  it('prices at the same default rate Settings shows (never R0)', () => {
    expect(db.getFirstSync('SELECT * FROM tutor_profile')).toBeNull();
    seedLesson();
    expect(getDefaultPayoutRate()).toBe(DEFAULT_PAYOUT_RATE);
    expect(DEFAULT_PAYOUT_RATE).toBe(600);
    const [line] = listClaimablePool();
    expect(line.lesson_fee).toBe(600);
  });

  it('freezes the default rate onto the claim', () => {
    const id = seedLesson();
    const { claim } = finaliseClaim({ sessionIds: [id] });
    expect(claim.payout_rate).toBe(600);
    expect(claim.grand_total).toBe(600);
  });

  it('re-exports formatClaimPeriod with an inclusive end', () => {
    expect(formatClaimPeriod(new Date(2026, 8, 1).toISOString(), new Date(2026, 9, 1).toISOString()))
      .toBe('1 Sep – 30 Sep 2026');
  });
});

describe('charged no-shows are billable', () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb();
    db.runSync(
      `INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at)
       VALUES ('s1', 'A', 10, 'Mathematics', 'CAPS', 'active', '2026-01-01T00:00:00.000Z')`
    );
    // charged no-show (no started/ended times), uncharged no-show, plain cancel
    db.runSync(
      `INSERT INTO sessions (id, student_id, mode, scheduled_for, billed_minutes, status, cancel_reason, created_at)
       VALUES ('ns', 's1', 'online', '2026-03-10T09:00:00.000Z', 60, 'cancelled', 'no_show', '2026-03-01T00:00:00.000Z'),
              ('ns0', 's1', 'online', '2026-03-11T09:00:00.000Z', NULL, 'cancelled', 'no_show', '2026-03-01T00:00:00.000Z'),
              ('cx', 's1', 'online', '2026-03-12T09:00:00.000Z', 60, 'cancelled', NULL, '2026-03-01T00:00:00.000Z')`
    );
  });
  afterEach(() => resetDbSingleton());

  it('only the charged no-show is claimable, dated by its scheduled time and range-filtered', () => {
    const pool = listClaimablePool();
    expect(pool.map(l => l.session_id)).toEqual(['ns']);
    expect(pool[0].ended_at).toBe('2026-03-10T09:00:00.000Z');
    expect(pool[0].lesson_fee).toBe(600);
    expect(listClaimablePool({ start: '2026-03-11T00:00:00.000Z', end: '2026-03-20T00:00:00.000Z' })).toHaveLength(0);
    const { claim } = finaliseClaim({ sessionIds: ['ns'] });
    expect(claim.grand_total).toBe(600);
  });
});
