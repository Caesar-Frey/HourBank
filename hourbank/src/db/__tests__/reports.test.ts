process.env.TZ = 'Africa/Johannesburg'; // SAST = UTC+2, month bounds are LOCAL midnight

import { createMigratedTestDb as createTestDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import { listTopUpsForMonth, listSessionsForMonth, getMonthSummary, getWeekLessonStats } from '../reports';

function seedStudent(db: TestDb, id: string, name: string) {
  db.runSync(
    `INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, name, 10, 'Mathematics', 'CAPS', 'active', '2026-01-01T00:00:00.000Z']
  );
}

function seedTopUp(db: TestDb, id: string, studentId: string, hoursDelta: number, createdAt: string) {
  db.runSync(
    `INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, created_at)
     VALUES (?, ?, 'top_up', ?, ?, ?)`,
    [id, studentId, hoursDelta, hoursDelta, createdAt]
  );
}

function seedSession(db: TestDb, id: string, studentId: string, startedAt: string, endedAt: string, status: string) {
  db.runSync(
    `INSERT INTO sessions (id, student_id, mode, status, started_at, ended_at, created_at)
     VALUES (?, ?, 'in_person', ?, ?, ?, ?)`,
    [id, studentId, status, startedAt, endedAt, startedAt]
  );
}

describe('listTopUpsForMonth', () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb();
    seedStudent(db, 's1', 'Alice Botha');
    seedStudent(db, 's2', 'Bob Smith');
  });

  afterEach(() => resetDbSingleton());

  it('returns top_ups in the given month', () => {
    seedTopUp(db, 'e1', 's1', 5, '2026-05-10T10:00:00.000Z');
    const rows = listTopUpsForMonth(2026, 4); // May = monthIdx 4
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('e1');
    expect(rows[0].hours_delta).toBe(5);
    expect(rows[0].student_full_name).toBe('Alice Botha');
  });

  it('returns empty array when no top_ups in month', () => {
    seedTopUp(db, 'e1', 's1', 5, '2026-04-30T21:59:59.000Z'); // 23:59:59 SAST 30 April
    const rows = listTopUpsForMonth(2026, 4); // May
    expect(rows).toHaveLength(0);
  });

  it('includes entry at month start boundary', () => {
    seedTopUp(db, 'e1', 's1', 3, '2026-05-01T00:00:00.000Z');
    const rows = listTopUpsForMonth(2026, 4);
    expect(rows).toHaveLength(1);
  });

  it('excludes entry at next month start boundary', () => {
    seedTopUp(db, 'e1', 's1', 3, '2026-06-01T00:00:00.000Z');
    const rows = listTopUpsForMonth(2026, 4);
    expect(rows).toHaveLength(0);
  });

  it('returns multiple top_ups from different students', () => {
    seedTopUp(db, 'e1', 's1', 5, '2026-05-10T10:00:00.000Z');
    seedTopUp(db, 'e2', 's2', 3, '2026-05-15T14:00:00.000Z');
    const rows = listTopUpsForMonth(2026, 4);
    expect(rows).toHaveLength(2);
  });

  it('does not return session_deduction entries', () => {
    db.runSync(
      `INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, created_at)
       VALUES ('e1', 's1', 'session_deduction', -2, 3, '2026-05-10T10:00:00.000Z')`
    );
    const rows = listTopUpsForMonth(2026, 4);
    expect(rows).toHaveLength(0);
  });
});

describe('listSessionsForMonth', () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb();
    seedStudent(db, 's1', 'Alice Botha');
    seedStudent(db, 's2', 'Bob Smith');
  });

  afterEach(() => resetDbSingleton());

  it('returns completed sessions ended in the given month', () => {
    seedSession(db, 'sess1', 's1', '2026-05-10T14:00:00.000Z', '2026-05-10T15:00:00.000Z', 'completed');
    const rows = listSessionsForMonth(2026, 4);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('sess1');
    expect(rows[0].student_full_name).toBe('Alice Botha');
    expect(rows[0].status).toBe('completed');
  });

  it('computes duration in seconds from started_at and ended_at', () => {
    seedSession(db, 'sess1', 's1', '2026-05-10T14:00:00.000Z', '2026-05-10T15:00:00.000Z', 'completed');
    const rows = listSessionsForMonth(2026, 4);
    expect(rows[0].duration).toBe(3600); // 1 hour = 3600 seconds
  });

  it('excludes sessions ended before month start', () => {
    seedSession(db, 'sess1', 's1', '2026-04-30T14:00:00.000Z', '2026-04-30T15:00:00.000Z', 'completed');
    const rows = listSessionsForMonth(2026, 4);
    expect(rows).toHaveLength(0);
  });

  it('excludes sessions ended at next month start boundary', () => {
    seedSession(db, 'sess1', 's1', '2026-06-01T00:00:00.000Z', '2026-06-01T01:00:00.000Z', 'completed');
    const rows = listSessionsForMonth(2026, 4);
    expect(rows).toHaveLength(0);
  });

  it('includes session ended at month start', () => {
    seedSession(db, 'sess1', 's1', '2026-04-30T23:00:00.000Z', '2026-05-01T00:00:00.000Z', 'completed');
    const rows = listSessionsForMonth(2026, 4);
    expect(rows).toHaveLength(1);
  });

  it('excludes cancelled and scheduled sessions', () => {
    seedSession(db, 'sess1', 's1', '2026-05-10T14:00:00.000Z', '2026-05-10T15:00:00.000Z', 'cancelled');
    const rows = listSessionsForMonth(2026, 4);
    expect(rows).toHaveLength(0);
  });

  it('includes completed sessions', () => {
    seedSession(db, 'sess1', 's1', '2026-05-10T14:00:00.000Z', '2026-05-10T15:00:00.000Z', 'completed');
    const rows = listSessionsForMonth(2026, 4);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('completed');
  });
});

describe('local-midnight month bounds (SAST)', () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb();
    seedStudent(db, 's1', 'Alice Botha');
  });
  afterEach(() => resetDbSingleton());

  it('a top-up at 00:30 SAST on 1 May belongs to May, not April', () => {
    seedTopUp(db, 'e1', 's1', 5, '2026-04-30T22:30:00.000Z');
    expect(listTopUpsForMonth(2026, 4)).toHaveLength(1);
    expect(listTopUpsForMonth(2026, 3)).toHaveLength(0);
  });

  it('a lesson ending 01:00 SAST on 1 June belongs to June', () => {
    seedSession(db, 'x', 's1', '2026-05-31T22:00:00.000Z', '2026-05-31T23:00:00.000Z', 'completed');
    expect(listSessionsForMonth(2026, 4)).toHaveLength(0);
    expect(listSessionsForMonth(2026, 5)).toHaveLength(1);
  });

  it('month summary uses local bounds too', () => {
    db.runSync(
      `INSERT INTO credit_packages (id, student_id, hours_added, amount_paid, created_at)
       VALUES ('p1', 's1', 10, 5500, '2026-04-30T22:30:00.000Z')`
    );
    expect(getMonthSummary(2026, 4).totalCashRand).toBe(5500);
    expect(getMonthSummary(2026, 3).totalCashRand).toBe(0);
  });
});

describe('billed durations and money in reports', () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb();
    seedStudent(db, 's1', 'Alice Botha');
    seedStudent(db, 's2', 'Bob Smith');
  });
  afterEach(() => resetDbSingleton());

  it('session duration is the billed length, not wall-clock (pauses excluded)', () => {
    db.runSync(
      `INSERT INTO sessions (id, student_id, mode, status, started_at, ended_at, duration_minutes, billed_minutes, created_at)
       VALUES ('x', 's1', 'online', 'completed', '2026-05-10T12:00:00.000Z', '2026-05-10T13:40:00.000Z', 70, 60, '2026-05-10T12:00:00.000Z')`
    );
    const [row] = listSessionsForMonth(2026, 4);
    expect(row.billed_minutes).toBe(60);
    expect(row.duration).toBe(3600); // seconds, billed
    expect(row.started_at).toBe('2026-05-10T12:00:00.000Z');
  });

  it('top-up rows include the rand amount and payment method', () => {
    db.runSync(
      `INSERT INTO credit_packages (id, student_id, hours_added, amount_paid, payment_method, created_at)
       VALUES ('p1', 's1', 10, 5500, 'cash', '2026-05-10T10:00:00.000Z')`
    );
    db.runSync(
      `INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, related_package_id, created_at)
       VALUES ('e1', 's1', 'top_up', 10, 10, 'p1', '2026-05-10T10:00:00.000Z')`
    );
    const [row] = listTopUpsForMonth(2026, 4);
    expect(row.amount_paid).toBe(5500);
    expect(row.payment_method).toBe('cash');
  });

  it('month summary returns a per-student breakdown with billed hours, lessons and cash', () => {
    db.runSync(
      `INSERT INTO sessions (id, student_id, mode, status, started_at, ended_at, duration_minutes, billed_minutes, created_at)
       VALUES ('a', 's1', 'online', 'completed', '2026-05-10T12:00:00.000Z', '2026-05-10T13:40:00.000Z', 100, 90, '2026-05-10T12:00:00.000Z'),
              ('b', 's2', 'online', 'completed', '2026-05-11T12:00:00.000Z', '2026-05-11T13:00:00.000Z', 60, NULL, '2026-05-11T12:00:00.000Z')`
    );
    db.runSync(
      `INSERT INTO credit_packages (id, student_id, hours_added, amount_paid, created_at)
       VALUES ('p1', 's2', 5, 3000, '2026-05-02T10:00:00.000Z')`
    );
    const sum = getMonthSummary(2026, 4);
    expect(sum.totalHours).toBe(2.5);
    expect(sum.totalCashRand).toBe(3000);
    expect(sum.totalLessons).toBe(2);
    const alice = sum.perStudent.find(r => r.studentId === 's1')!;
    const bob = sum.perStudent.find(r => r.studentId === 's2')!;
    expect(alice).toMatchObject({ hours: 1.5, sessions: 1, cashRand: 0 });
    expect(bob).toMatchObject({ hours: 1, sessions: 1, cashRand: 3000 });
  });
});

describe('getWeekLessonStats', () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb();
    seedStudent(db, 's1', 'Alice Botha');
    db.runSync(
      `INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at)
       VALUES ('sx', 'Archived', 10, 'Maths', 'CAPS', 'archived', '2026-01-01T00:00:00.000Z')`
    );
  });
  afterEach(() => resetDbSingleton());

  it('excludes archived students from completed lessons', () => {
    const now = new Date();
    const start = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const end = now.toISOString();
    db.runSync(
      `INSERT INTO sessions (id, student_id, mode, status, started_at, ended_at, billed_minutes, created_at)
       VALUES ('a', 's1', 'online', 'completed', ?, ?, 60, ?), ('b', 'sx', 'online', 'completed', ?, ?, 60, ?)`,
      [start, end, start, start, end, start]
    );
    const stats = getWeekLessonStats();
    expect(stats.completedCount).toBe(1);
    expect(stats.completedHours).toBe(1);
  });
});

describe('charged no-shows count as delivered in reports', () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb();
    seedStudent(db, 's1', 'Alice Botha');
    db.runSync(
      `INSERT INTO sessions (id, student_id, mode, scheduled_for, billed_minutes, status, cancel_reason, created_at)
       VALUES ('ns', 's1', 'online', '2026-05-10T09:00:00.000Z', 60, 'cancelled', 'no_show', '2026-05-01T00:00:00.000Z'),
              ('cx', 's1', 'online', '2026-05-12T09:00:00.000Z', NULL, 'cancelled', 'no_show', '2026-05-01T00:00:00.000Z')`
    );
  });
  afterEach(() => resetDbSingleton());

  it('lists the charged no-show with its billed length and reason', () => {
    const rows = listSessionsForMonth(2026, 4);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'ns', cancel_reason: 'no_show', billed_minutes: 60, ended_at: '2026-05-10T09:00:00.000Z' });
  });

  it('includes it in month totals', () => {
    const sum = getMonthSummary(2026, 4);
    expect(sum.totalHours).toBe(1);
    expect(sum.totalLessons).toBe(1);
  });
});
