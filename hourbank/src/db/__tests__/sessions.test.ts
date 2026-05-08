import { createTestDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import { createUnscheduled, startSession } from '../sessions';

describe('sessions', () => {
  let db: TestDb;
  const NOW = new Date().toISOString();

  beforeEach(() => {
    db = createTestDb();
    db.runSync(
      `INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['student-1', 'Alice Botha', 10, 'Mathematics', 'CAPS', 'active', NOW]
    );
  });

  afterEach(() => {
    resetDbSingleton();
  });

  describe('createUnscheduled', () => {
    it('creates row with null scheduled_for and status scheduled', () => {
      const session = createUnscheduled('student-1', 'in_person');
      expect(session.student_id).toBe('student-1');
      expect(session.mode).toBe('in_person');
      expect(session.scheduled_for).toBeNull();
      expect(session.status).toBe('scheduled');
    });

    it('persists online mode correctly', () => {
      const session = createUnscheduled('student-1', 'online');
      expect(session.mode).toBe('online');
      expect(session.scheduled_for).toBeNull();
    });

    it('startSession after createUnscheduled flips status to active', () => {
      const session = createUnscheduled('student-1', 'in_person');
      const active = startSession(session.id);
      expect(active.status).toBe('active');
      expect(active.started_at).not.toBeNull();
    });
  });
});
