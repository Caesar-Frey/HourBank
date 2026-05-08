/**
 * smoke.test.ts — verifies the in-memory test harness works end-to-end.
 *
 * This is NOT a feature test — it only confirms that:
 *   1. createTestDb() opens an in-memory DB with the full schema
 *   2. We can insert and read back a student row
 */

import { createTestDb, mockGetDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import type { Student } from '../schema';

describe('test harness smoke test', () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb();
    mockGetDb(db);
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
});
