import { createMigratedTestDb as createTestDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import { resetDb } from '../seed';

function count(db: TestDb, table: string): number {
  return db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n;
}

describe('resetDb (dev only)', () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb();
    db.runSync(`PRAGMA foreign_keys = ON`);
    const t = '2026-03-15T09:00:00.000Z';
    db.runSync(
      `INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at)
       VALUES ('s1', 'A', 10, 'Mathematics', 'CAPS', 'active', ?)`, [t]
    );
    db.runSync(
      `INSERT INTO credit_packages (id, student_id, hours_added, amount_paid, created_at) VALUES ('p1', 's1', 5, 3000, ?)`, [t]
    );
    db.runSync(
      `INSERT INTO sessions (id, student_id, mode, started_at, ended_at, billed_minutes, status, created_at)
       VALUES ('l1', 's1', 'online', ?, ?, 60, 'completed', ?)`, [t, t, t]
    );
    db.runSync(
      `INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, related_package_id, created_at)
       VALUES ('e1', 's1', 'top_up', 5, 5, 'p1', ?)`, [t]
    );
    db.runSync(
      `INSERT INTO claims (id, payout_rate, travel_mode, lesson_fee_total, travel_total, grand_total, created_at)
       VALUES ('c1', 600, 'flat', 600, 0, 600, ?)`, [t]
    );
    db.runSync(
      `INSERT INTO claim_lines (id, claim_id, session_id, billed_hours, mode, lesson_fee, travel_fee, created_at)
       VALUES ('cl1', 'c1', 'l1', 1, 'online', 600, 0, ?)`, [t]
    );
    db.runSync(
      `INSERT INTO calendar_events (id, kind, student_id, starts_at, all_day, title, created_at, updated_at)
       VALUES ('ce1', 'event', 's1', ?, 0, 'Exam', ?, ?)`, [t, t, t]
    );
    db.runSync(
      `INSERT INTO receipts (id, session_id, kind, created_at) VALUES ('r1', 'l1', 'session', ?)`, [t]
    );
  });
  afterEach(() => resetDbSingleton());

  it('clears every user table without FK errors once claims exist', () => {
    expect(() => resetDb()).not.toThrow();
    for (const table of ['claim_lines', 'claims', 'calendar_events', 'receipts', 'ledger_entries', 'sessions', 'credit_packages', 'students']) {
      expect(count(db, table)).toBe(0);
    }
  });

  it('works when ledger_entries is protected by an append-only DELETE trigger, and restores it', () => {
    db.runSync(`CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger_entries
                BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only'); END`);
    expect(() => resetDb()).not.toThrow();
    expect(count(db, 'ledger_entries')).toBe(0);
    const trig = db.getFirstSync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'ledger_no_delete'`
    );
    expect(trig?.name).toBe('ledger_no_delete');
  });
});
