import { createTestDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import { listTopUpsForMonth, listSessionsForMonth } from '../reports';

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
    seedTopUp(db, 'e1', 's1', 5, '2026-04-30T23:59:59.000Z'); // April
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

  it('returns sessions ended in the given month', () => {
    seedSession(db, 'sess1', 's1', '2026-05-10T14:00:00.000Z', '2026-05-10T15:00:00.000Z', 'pending_verification');
    const rows = listSessionsForMonth(2026, 4);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('sess1');
    expect(rows[0].student_full_name).toBe('Alice Botha');
    expect(rows[0].status).toBe('pending_verification');
  });

  it('computes duration in seconds from started_at and ended_at', () => {
    seedSession(db, 'sess1', 's1', '2026-05-10T14:00:00.000Z', '2026-05-10T15:00:00.000Z', 'verified');
    const rows = listSessionsForMonth(2026, 4);
    expect(rows[0].duration).toBe(3600); // 1 hour = 3600 seconds
  });

  it('excludes sessions ended before month start', () => {
    seedSession(db, 'sess1', 's1', '2026-04-30T14:00:00.000Z', '2026-04-30T15:00:00.000Z', 'verified');
    const rows = listSessionsForMonth(2026, 4);
    expect(rows).toHaveLength(0);
  });

  it('excludes sessions ended at next month start boundary', () => {
    seedSession(db, 'sess1', 's1', '2026-06-01T00:00:00.000Z', '2026-06-01T01:00:00.000Z', 'verified');
    const rows = listSessionsForMonth(2026, 4);
    expect(rows).toHaveLength(0);
  });

  it('includes session ended at month start', () => {
    seedSession(db, 'sess1', 's1', '2026-04-30T23:00:00.000Z', '2026-05-01T00:00:00.000Z', 'verified');
    const rows = listSessionsForMonth(2026, 4);
    expect(rows).toHaveLength(1);
  });

  it('excludes cancelled and scheduled sessions', () => {
    seedSession(db, 'sess1', 's1', '2026-05-10T14:00:00.000Z', '2026-05-10T15:00:00.000Z', 'cancelled');
    const rows = listSessionsForMonth(2026, 4);
    expect(rows).toHaveLength(0);
  });

  it('includes verified sessions', () => {
    seedSession(db, 'sess1', 's1', '2026-05-10T14:00:00.000Z', '2026-05-10T15:00:00.000Z', 'verified');
    const rows = listSessionsForMonth(2026, 4);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('verified');
  });
});
