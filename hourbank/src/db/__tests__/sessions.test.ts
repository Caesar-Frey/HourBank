import { createTestDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import { createUnscheduled, startSession, verifySession, sessionsThisWeekCount } from '../sessions';

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

  describe('sessionsThisWeekCount', () => {
    it('returns 0 when no sessions exist', () => {
      expect(sessionsThisWeekCount()).toBe(0);
    });

    it('returns count of sessions ended this week with pending_verification or verified status', () => {
      const now = new Date().toISOString();
      db.runSync(
        `INSERT INTO sessions (id, student_id, mode, status, started_at, ended_at, created_at) VALUES (?, ?, 'in_person', ?, ?, ?, ?)`,
        ['sess-1', 'student-1', 'pending_verification', now, now, now]
      );
      db.runSync(
        `INSERT INTO sessions (id, student_id, mode, status, started_at, ended_at, created_at) VALUES (?, ?, 'in_person', ?, ?, ?, ?)`,
        ['sess-2', 'student-1', 'verified', now, now, now]
      );
      expect(sessionsThisWeekCount()).toBe(2);
    });

    it('excludes sessions ended before this week', () => {
      const now = new Date().toISOString();
      const lastWeek = new Date();
      lastWeek.setDate(lastWeek.getDate() - 8);
      const lastWeekIso = lastWeek.toISOString();
      db.runSync(
        `INSERT INTO sessions (id, student_id, mode, status, started_at, ended_at, created_at) VALUES (?, ?, 'in_person', ?, ?, ?, ?)`,
        ['sess-old', 'student-1', 'pending_verification', lastWeekIso, lastWeekIso, lastWeekIso]
      );
      db.runSync(
        `INSERT INTO sessions (id, student_id, mode, status, started_at, ended_at, created_at) VALUES (?, ?, 'in_person', ?, ?, ?, ?)`,
        ['sess-new', 'student-1', 'verified', now, now, now]
      );
      expect(sessionsThisWeekCount()).toBe(1);
    });

    it('excludes cancelled sessions', () => {
      const now = new Date().toISOString();
      db.runSync(
        `INSERT INTO sessions (id, student_id, mode, status, started_at, ended_at, created_at) VALUES (?, ?, 'in_person', ?, ?, ?, ?)`,
        ['sess-cancelled', 'student-1', 'cancelled', now, now, now]
      );
      db.runSync(
        `INSERT INTO sessions (id, student_id, mode, status, started_at, ended_at, created_at) VALUES (?, ?, 'in_person', ?, ?, ?, ?)`,
        ['sess-ok', 'student-1', 'pending_verification', now, now, now]
      );
      expect(sessionsThisWeekCount()).toBe(1);
    });
  });

  describe('verifySession', () => {
    function seedPendingSession(db: TestDb, id: string): void {
      const now = new Date().toISOString();
      db.runSync(
        `INSERT INTO sessions (id, student_id, mode, status, started_at, ended_at, created_at)
         VALUES (?, 'student-1', 'in_person', 'pending_verification', ?, ?, ?)`,
        [id, now, now, now]
      );
    }

    it('flips pending_verification to verified and sets verified_at', () => {
      seedPendingSession(db, 'sess-1');
      const result = verifySession('sess-1');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('verified');
      expect(result!.verified_at).not.toBeNull();
    });

    it('is idempotent — calling on an already verified session returns null', () => {
      seedPendingSession(db, 'sess-2');
      verifySession('sess-2');
      const second = verifySession('sess-2');
      expect(second).toBeNull();
    });

    it('returns null for a non-existent session', () => {
      expect(verifySession('nonexistent')).toBeNull();
    });
  });
});
