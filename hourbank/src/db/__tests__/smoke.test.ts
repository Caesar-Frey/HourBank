/**
 * smoke.test.ts — verifies the in-memory test harness works end-to-end.
 *
 * Confirms:
 *   1. the migrated test DB (initDb + ALL_MIGRATIONS, as at app boot) opens in memory
 *   2. Basic CRUD works through the wrapped bridge
 *   3. withTransactionSync works via appendEntry() and createPackage()
 *   4. runSync returns { changes: number }
 */

import { createMigratedTestDb as createTestDb, mockGetDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import type { Student } from '../schema';
import { appendEntry } from '../ledger';
import { createPackage } from '../packages';

describe('test harness smoke test', () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it('inserts and reads back a student', () => {
    const studentId = 'student-001';
    const now = new Date().toISOString();

    // Insert a student directly via the wrapped better-sqlite3 instance.
    db.runSync(
      `INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [studentId, 'Alice Botha', 10, 'Mathematics', 'CAPS', 'active', now]
    );

    // Read it back.
    const row = db.getFirstSync<Student>(
      `SELECT * FROM students WHERE id = ?`,
      [studentId]
    );

    expect(row).not.toBeNull();
    expect(row!.id).toBe(studentId);
    expect(row!.full_name).toBe('Alice Botha');
    expect(row!.grade).toBe(10);
    expect(row!.subject).toBe('Mathematics');
    expect(row!.curriculum).toBe('CAPS');
    expect(row!.status).toBe('active');
  });

  it('tables exist for all schema tables', () => {
    const tables = db.getAllSync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    );
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('students');
    expect(tableNames).toContain('credit_packages');
    expect(tableNames).toContain('sessions');
    expect(tableNames).toContain('ledger_entries');
  });

  it('getAllSync returns multiple rows', () => {
    db.runSync(
      `INSERT INTO students (id, full_name, grade, subject) VALUES (?, ?, ?, ?)`,
      ['s1', 'Bob Smith', 8, 'Science']
    );
    db.runSync(
      `INSERT INTO students (id, full_name, grade, subject) VALUES (?, ?, ?, ?)`,
      ['s2', 'Carol Jones', 9, 'English']
    );

    const rows = db.getAllSync<Student>(`SELECT * FROM students WHERE status = 'active'`);
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.id).sort()).toEqual(['s1', 's2']);
  });

  it('runSync returns { changes: number }', () => {
    const now = new Date().toISOString();
    db.runSync(
      `INSERT INTO students (id, full_name, grade, subject, created_at) VALUES (?, ?, ?, ?, ?)`,
      ['s-chg', 'Delta Test', 7, 'Physics', now]
    );
    const result = db.runSync(
      `UPDATE students SET subject = 'Chemistry' WHERE id = ?`,
      ['s-chg']
    );
    expect(result).toHaveProperty('changes');
    expect(result.changes).toBe(1);
  });

  it('appendEntry uses withTransactionSync and writes a ledger row', () => {
    const now = new Date().toISOString();
    // Seed a student
    db.runSync(
      `INSERT INTO students (id, full_name, grade, subject, created_at) VALUES (?, ?, ?, ?, ?)`,
      ['s-ledger', 'Ledger Student', 9, 'Maths', now]
    );

    const entry = appendEntry({
      studentId: 's-ledger',
      type: 'top_up',
      hoursDelta: 5,
    });

    expect(entry.student_id).toBe('s-ledger');
    expect(entry.hours_delta).toBe(5);
    expect(entry.balance_after).toBe(5);

    const rows = db.getAllSync<{ id: string }>(
      `SELECT id FROM ledger_entries WHERE student_id = ?`,
      ['s-ledger']
    );
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(entry.id);
  });

  it('createPackage uses withTransactionSync and writes package + ledger row atomically', () => {
    const now = new Date().toISOString();
    db.runSync(
      `INSERT INTO students (id, full_name, grade, subject, created_at) VALUES (?, ?, ?, ?, ?)`,
      ['s-pkg', 'Package Student', 11, 'English', now]
    );

    const { pkg, entry } = createPackage({
      studentId: 's-pkg',
      hoursAdded: 10,
      amountPaid: 1500,
      paymentMethod: 'eft',
      paymentRef: 'REF-001',
    });

    expect(pkg.student_id).toBe('s-pkg');
    expect(pkg.hours_added).toBe(10);
    expect(pkg.amount_paid).toBe(1500);

    expect(entry.type).toBe('top_up');
    expect(entry.hours_delta).toBe(10);
    expect(entry.balance_after).toBe(10);
    expect(entry.related_package_id).toBe(pkg.id);

    // Verify both rows persisted
    const pkgRow = db.getFirstSync<{ id: string }>(
      `SELECT id FROM credit_packages WHERE id = ?`,
      [pkg.id]
    );
    expect(pkgRow).not.toBeNull();

    const ledgerRow = db.getFirstSync<{ id: string }>(
      `SELECT id FROM ledger_entries WHERE related_package_id = ?`,
      [pkg.id]
    );
    expect(ledgerRow).not.toBeNull();
  });
});
