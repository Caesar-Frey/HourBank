/**
 * students.test.ts — TDD tests for student status management.
 *
 * Tests:
 *   1. listActiveStudents returns only status='active' students
 *   2. listPausedStudents returns only status='paused' students
 *   3. pauseStudent changes status to 'paused'
 *   4. reactivateStudent changes status to 'active'
 *   5. archiveStudent changes status to 'archived'
 */

import { createMigratedTestDb as createTestDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import {
  listActiveStudents,
  listPausedStudents,
  pauseStudent,
  reactivateStudent,
  archiveStudent,
} from '../students';

function insertStudent(
  db: TestDb,
  id: string,
  status: 'active' | 'paused' | 'archived',
  fullName = 'Test Student',
) {
  const now = new Date().toISOString();
  db.runSync(
    `INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, fullName, 10, 'Mathematics', 'CAPS', status, now],
  );
}

describe('students', () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    resetDbSingleton();
  });

  // ── listActiveStudents ──────────────────────────────────────────────────

  describe('listActiveStudents', () => {
    it('returns only active students', () => {
      insertStudent(db, 'a1', 'active', 'Alice Active');
      insertStudent(db, 'p1', 'paused', 'Pete Paused');
      insertStudent(db, 'ar1', 'archived', 'Amy Archived');

      const results = listActiveStudents();

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('a1');
      expect(results[0].status).toBe('active');
    });

    it('excludes paused students', () => {
      insertStudent(db, 'p1', 'paused', 'Pete Paused');
      const results = listActiveStudents();
      expect(results).toHaveLength(0);
    });

    it('excludes archived students', () => {
      insertStudent(db, 'ar1', 'archived', 'Amy Archived');
      const results = listActiveStudents();
      expect(results).toHaveLength(0);
    });

    it('includes current_balance field', () => {
      insertStudent(db, 'a1', 'active', 'Alice Active');
      const results = listActiveStudents();
      expect(results[0].current_balance).toBe(0);
    });
  });

  // ── listPausedStudents ──────────────────────────────────────────────────

  describe('listPausedStudents', () => {
    it('returns only paused students', () => {
      insertStudent(db, 'a1', 'active', 'Alice Active');
      insertStudent(db, 'p1', 'paused', 'Pete Paused');
      insertStudent(db, 'ar1', 'archived', 'Amy Archived');

      const results = listPausedStudents();

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('p1');
      expect(results[0].status).toBe('paused');
    });

    it('excludes active students', () => {
      insertStudent(db, 'a1', 'active', 'Alice Active');
      const results = listPausedStudents();
      expect(results).toHaveLength(0);
    });

    it('excludes archived students', () => {
      insertStudent(db, 'ar1', 'archived', 'Amy Archived');
      const results = listPausedStudents();
      expect(results).toHaveLength(0);
    });

    it('includes current_balance field', () => {
      insertStudent(db, 'p1', 'paused', 'Pete Paused');
      const results = listPausedStudents();
      expect(results[0].current_balance).toBe(0);
    });
  });

  // ── pauseStudent ────────────────────────────────────────────────────────

  describe('pauseStudent', () => {
    it('changes status from active to paused', () => {
      insertStudent(db, 'a1', 'active');
      pauseStudent('a1');
      const row = db.getFirstSync<{ status: string }>(
        'SELECT status FROM students WHERE id = ?',
        ['a1'],
      );
      expect(row!.status).toBe('paused');
    });
  });

  // ── reactivateStudent ───────────────────────────────────────────────────

  describe('reactivateStudent', () => {
    it('changes status from paused to active', () => {
      insertStudent(db, 'p1', 'paused');
      reactivateStudent('p1');
      const row = db.getFirstSync<{ status: string }>(
        'SELECT status FROM students WHERE id = ?',
        ['p1'],
      );
      expect(row!.status).toBe('active');
    });
  });

  // ── archiveStudent ──────────────────────────────────────────────────────

  describe('archiveStudent', () => {
    it('changes status to archived', () => {
      insertStudent(db, 'a1', 'active');
      archiveStudent('a1');
      const row = db.getFirstSync<{ status: string }>(
        'SELECT status FROM students WHERE id = ?',
        ['a1'],
      );
      expect(row!.status).toBe('archived');
    });

    it('can archive a paused student', () => {
      insertStudent(db, 'p1', 'paused');
      archiveStudent('p1');
      const row = db.getFirstSync<{ status: string }>(
        'SELECT status FROM students WHERE id = ?',
        ['p1'],
      );
      expect(row!.status).toBe('archived');
    });
  });
});


describe('roster next lesson', () => {
  afterEach(() => resetDbSingleton());

  it.each(['active', 'paused'] as const)('skips elapsed same-day lessons for %s students', (status) => {
    const db = createTestDb();
    insertStudent(db, 'student-boundary', status);
    const query = db.getAllSync.bind(db);
    jest.spyOn(db, 'getAllSync').mockImplementation((sql, params) =>
      query(sql.replace(/'now'/g, "'2026-09-12 12:00:00'"), params));
    for (const [id, date] of [['past', '2026-09-12T06:00:00.000Z'], ['future', '2026-09-12T13:00:00.000Z']]) {
      db.runSync("INSERT INTO sessions (id, student_id, scheduled_for) VALUES (?, 'student-boundary', ?)", [id, date]);
    }
    const rows = status === 'active' ? listActiveStudents() : listPausedStudents();
    expect(rows[0].next_session?.id).toBe('future');
  });
});
