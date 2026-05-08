import { createTestDb, mockGetDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import { getBalanceAt } from '../ledger';

describe('getBalanceAt', () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb();
    mockGetDb(db);
  });

  afterEach(() => {
    resetDbSingleton();
  });

  const seedStudent = (id = 's1') => {
    db.runSync(
      `INSERT INTO students (id, full_name, grade, subject) VALUES (?, ?, ?, ?)`,
      [id, 'Test Student', 10, 'Maths']
    );
  };

  const seedEntry = (opts: { studentId: string; delta: number; createdAt: string }) => {
    const id = `entry-${opts.createdAt}-${opts.delta}`;
    db.runSync(
      `INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, created_at)
       VALUES (?, ?, 'top_up', ?, ?, ?)`,
      [id, opts.studentId, opts.delta, opts.delta, opts.createdAt]
    );
  };

  it('returns 0 when no entries exist', () => {
    seedStudent();
    expect(getBalanceAt('s1', '2025-01-01T00:00:00.000Z')).toBe(0);
  });

  it('sums entries up to and including the exact timestamp', () => {
    seedStudent();
    seedEntry({ studentId: 's1', delta: 5, createdAt: '2025-01-01T10:00:00.000Z' });
    seedEntry({ studentId: 's1', delta: 3, createdAt: '2025-01-02T10:00:00.000Z' });
    expect(getBalanceAt('s1', '2025-01-02T10:00:00.000Z')).toBe(8);
  });

  it('excludes entries strictly after the timestamp', () => {
    seedStudent();
    seedEntry({ studentId: 's1', delta: 5, createdAt: '2025-01-01T10:00:00.000Z' });
    seedEntry({ studentId: 's1', delta: 3, createdAt: '2025-01-03T10:00:00.000Z' });
    expect(getBalanceAt('s1', '2025-01-02T00:00:00.000Z')).toBe(5);
  });

  it('returns 0 for a student with no entries even when others exist', () => {
    seedStudent('s1');
    seedStudent('s2');
    seedEntry({ studentId: 's2', delta: 10, createdAt: '2025-01-01T10:00:00.000Z' });
    expect(getBalanceAt('s1', '2025-12-31T23:59:59.999Z')).toBe(0);
  });

  it('handles deductions (negative deltas) in the sum', () => {
    seedStudent();
    seedEntry({ studentId: 's1', delta: 10, createdAt: '2025-01-01T08:00:00.000Z' });
    seedEntry({ studentId: 's1', delta: -2, createdAt: '2025-01-01T09:00:00.000Z' });
    expect(getBalanceAt('s1', '2025-01-01T09:00:00.000Z')).toBe(8);
  });
});
