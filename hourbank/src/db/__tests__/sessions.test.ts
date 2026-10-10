import { createMigratedTestDb as createTestDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import { createUnscheduled, startSession, sessionsThisWeekCount, getActiveOrPausedSession, cancelSession, endSession, listUpcoming, listAllUpcoming, getSession, parseSessionTopics, saveLiveTopics } from '../sessions';

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

  // Helper: create the tutor_profile table in the test DB (normally created by MIGRATION_002)
  function ensureTutorProfileTable() {
    db.runSync(`
      CREATE TABLE IF NOT EXISTS tutor_profile (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL DEFAULT '',
        hourly_rate REAL NOT NULL DEFAULT 600.0,
        currency TEXT NOT NULL DEFAULT 'ZAR',
        max_owe_hours REAL NOT NULL DEFAULT 0,
        tier_system_enabled INTEGER NOT NULL DEFAULT 1,
        package_tiers TEXT NOT NULL DEFAULT '[]',
        selected_subject_ids TEXT NOT NULL DEFAULT '[]',
        last_backup_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

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
      const active = startSession(session.id, { allowOverOwe: true });
      expect(active.status).toBe('active');
      expect(active.started_at).not.toBeNull();
    });
  });

  describe('sessionsThisWeekCount', () => {
    it('returns 0 when no sessions exist', () => {
      expect(sessionsThisWeekCount()).toBe(0);
    });

    it('returns count of completed sessions ended this week', () => {
      const now = new Date().toISOString();
      db.runSync(
        `INSERT INTO sessions (id, student_id, mode, status, started_at, ended_at, created_at) VALUES (?, ?, 'in_person', ?, ?, ?, ?)`,
        ['sess-1', 'student-1', 'completed', now, now, now]
      );
      db.runSync(
        `INSERT INTO sessions (id, student_id, mode, status, started_at, ended_at, created_at) VALUES (?, ?, 'in_person', ?, ?, ?, ?)`,
        ['sess-2', 'student-1', 'completed', now, now, now]
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
        ['sess-old', 'student-1', 'completed', lastWeekIso, lastWeekIso, lastWeekIso]
      );
      db.runSync(
        `INSERT INTO sessions (id, student_id, mode, status, started_at, ended_at, created_at) VALUES (?, ?, 'in_person', ?, ?, ?, ?)`,
        ['sess-new', 'student-1', 'completed', now, now, now]
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
        ['sess-ok', 'student-1', 'completed', now, now, now]
      );
      expect(sessionsThisWeekCount()).toBe(1);
    });
  });

  describe('getActiveOrPausedSession', () => {
    it('returns null when no active or paused session exists', () => {
      expect(getActiveOrPausedSession()).toBeNull();
    });

    it('returns the active session with student name when one exists', () => {
      const now = new Date().toISOString();
      db.runSync(
        `INSERT INTO sessions (id, student_id, mode, status, started_at, created_at) VALUES (?, ?, 'in_person', 'active', ?, ?)`,
        ['sess-active', 'student-1', now, now]
      );
      const result = getActiveOrPausedSession();
      expect(result).not.toBeNull();
      expect(result!.id).toBe('sess-active');
      expect(result!.status).toBe('active');
      expect(result!.student_full_name).toBe('Alice Botha');
    });

    it('returns the paused session with student name when one exists', () => {
      const now = new Date().toISOString();
      db.runSync(
        `INSERT INTO sessions (id, student_id, mode, status, started_at, created_at) VALUES (?, ?, 'in_person', 'paused', ?, ?)`,
        ['sess-paused', 'student-1', now, now]
      );
      const result = getActiveOrPausedSession();
      expect(result).not.toBeNull();
      expect(result!.id).toBe('sess-paused');
      expect(result!.status).toBe('paused');
      expect(result!.student_full_name).toBe('Alice Botha');
    });
  });

  describe('endSession', () => {
    function makeActiveSession(db: TestDb): string {
      const session = createUnscheduled('student-1', 'in_person');
      db.runSync(
        `UPDATE sessions SET status = 'active', started_at = ? WHERE id = ?`,
        [new Date().toISOString(), session.id]
      );
      // Give student a balance first
      db.runSync(
        `INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, created_at)
         VALUES (?, ?, 'top_up', ?, ?, ?)`,
        ['topup-1', 'student-1', 10, 10, new Date().toISOString()]
      );
      return session.id;
    }

    it('uses billedMinutes for ledger hours_delta, not durationMinutes', () => {
      const sessionId = makeActiveSession(db);
      const { entry } = endSession({
        sessionId,
        endedAt: new Date().toISOString(),
        durationMinutes: 75,
        billedMinutes: 60,
        pausedSeconds: 0,
        topics: ['Algebra'],
      });
      expect(entry.hours_delta).toBeCloseTo(-(60 / 60));
    });

    it('stores both duration_minutes and billed_minutes separately', () => {
      const sessionId = makeActiveSession(db);
      const { session } = endSession({
        sessionId,
        endedAt: new Date().toISOString(),
        durationMinutes: 75,
        billedMinutes: 60,
        pausedSeconds: 0,
        topics: ['Algebra'],
      });
      expect(session.duration_minutes).toBe(75);
      expect(session.billed_minutes).toBe(60);
    });

    it('when billedMinutes equals durationMinutes, ledger uses that value', () => {
      const sessionId = makeActiveSession(db);
      const { entry, session } = endSession({
        sessionId,
        endedAt: new Date().toISOString(),
        durationMinutes: 90,
        billedMinutes: 90,
        pausedSeconds: 0,
        topics: ['Calculus'],
      });
      expect(entry.hours_delta).toBeCloseTo(-(90 / 60));
      expect(session.billed_minutes).toBe(90);
      expect(session.duration_minutes).toBe(90);
    });
  });

  // Semantics changed 2026-10-09: 0 = owing not allowed; check uses the projected
  // balance after the lesson (unscheduled → 60 min); OVER_OWE_LIMIT is overridable.
  describe('startSession OVER_OWE_LIMIT', () => {
    beforeEach(() => {
      ensureTutorProfileTable();
    });

    it('throws OVER_OWE_LIMIT when the lesson would push owing past max_owe_hours', () => {
      // Set max_owe_hours = 2
      db.runSync(
        `INSERT INTO tutor_profile (id, full_name, hourly_rate, currency, max_owe_hours, tier_system_enabled, package_tiers, selected_subject_ids, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['prof-1', '', 600, 'ZAR', 2, 1, '[]', '[]', NOW, NOW]
      );
      // Give student a negative balance of -2 (exactly at limit)
      db.runSync(
        `INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, created_at) VALUES (?, ?, 'session_deduction', ?, ?, ?)`,
        ['le-1', 'student-1', -2, -2, NOW]
      );
      const session = createUnscheduled('student-1', 'in_person');
      expect(() => startSession(session.id)).toThrow('OVER_OWE_LIMIT');
    });

    it('allows start when balance > -max_owe_hours', () => {
      db.runSync(
        `INSERT INTO tutor_profile (id, full_name, hourly_rate, currency, max_owe_hours, tier_system_enabled, package_tiers, selected_subject_ids, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['prof-2', '', 600, 'ZAR', 2, 1, '[]', '[]', NOW, NOW]
      );
      // Balance is -1 (above -2 limit)
      db.runSync(
        `INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, created_at) VALUES (?, ?, 'session_deduction', ?, ?, ?)`,
        ['le-2', 'student-1', -1, -1, NOW]
      );
      const session = createUnscheduled('student-1', 'in_person');
      expect(() => startSession(session.id)).not.toThrow();
    });

    it('max_owe_hours = 0 means owing not allowed; allowOverOwe overrides', () => {
      db.runSync(
        `INSERT INTO tutor_profile (id, full_name, hourly_rate, currency, max_owe_hours, tier_system_enabled, package_tiers, selected_subject_ids, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['prof-3', '', 600, 'ZAR', 0, 1, '[]', '[]', NOW, NOW]
      );
      db.runSync(
        `INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, created_at) VALUES (?, ?, 'session_deduction', ?, ?, ?)`,
        ['le-3', 'student-1', -100, -100, NOW]
      );
      const session = createUnscheduled('student-1', 'in_person');
      expect(() => startSession(session.id)).toThrow('OVER_OWE_LIMIT');
      expect(() => startSession(session.id, { allowOverOwe: true })).not.toThrow();
    });

    it('no tutor_profile row behaves like max_owe_hours = 0', () => {
      db.runSync(
        `INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, created_at) VALUES (?, ?, 'session_deduction', ?, ?, ?)`,
        ['le-4', 'student-1', -50, -50, NOW]
      );
      const session = createUnscheduled('student-1', 'in_person');
      expect(() => startSession(session.id)).toThrow('OVER_OWE_LIMIT');
    });
  });

  describe('cancelSession', () => {
    it('cancels a scheduled session', () => {
      const session = createUnscheduled('student-1', 'in_person');
      cancelSession(session.id);
      const row = db.getFirstSync<{ status: string }>('SELECT status FROM sessions WHERE id = ?', [session.id]);
      expect(row!.status).toBe('cancelled');
    });

    it('is a no-op when session is already completed', () => {
      const now = new Date().toISOString();
      db.runSync(
        `INSERT INTO sessions (id, student_id, mode, status, started_at, ended_at, created_at) VALUES (?, ?, 'in_person', 'completed', ?, ?, ?)`,
        ['sess-done', 'student-1', now, now, now]
      );
      cancelSession('sess-done');
      const row = db.getFirstSync<{ status: string }>('SELECT status FROM sessions WHERE id = ?', ['sess-done']);
      expect(row!.status).toBe('completed');
    });

    it('is a no-op when session is already cancelled', () => {
      const now = new Date().toISOString();
      db.runSync(
        `INSERT INTO sessions (id, student_id, mode, status, started_at, ended_at, created_at) VALUES (?, ?, 'in_person', 'cancelled', ?, ?, ?)`,
        ['sess-already', 'student-1', now, now, now]
      );
      cancelSession('sess-already');
      const row = db.getFirstSync<{ status: string }>('SELECT status FROM sessions WHERE id = ?', ['sess-already']);
      expect(row!.status).toBe('cancelled');
    });
  });
});


describe('upcoming session time boundaries', () => {
  afterEach(() => resetDbSingleton());

  it.each(['student', 'all'])('excludes elapsed same-day lessons from %s upcoming sessions', (scope) => {
    const db = createTestDb();
    db.runSync("INSERT INTO students (id, full_name, subject) VALUES ('boundary-student', 'Boundary Student', 'Mathematics')");
    // Fix SQLite's clock while keeping actual SQL execution and timestamp conversion.
    const query = db.getAllSync.bind(db);
    jest.spyOn(db, 'getAllSync').mockImplementation((sql, params) =>
      query(sql.replace(/'now'/g, "'2026-09-12 12:00:00'"), params));
    const past = '2026-09-12T06:00:00.000Z';
    const future = '2026-09-12T13:00:00.000Z';
    for (const [id, date] of [['past', past], ['future', future]]) {
      db.runSync("INSERT INTO sessions (id, student_id, scheduled_for) VALUES (?, 'boundary-student', ?)", [id, date]);
    }
    const rows = scope === 'student' ? listUpcoming('boundary-student') : listAllUpcoming();
    expect(rows.map(row => row.id)).toEqual(['future']);
  });
});

describe('live-timer topic persistence (survives app kill)', () => {
  let db: TestDb;
  const NOW = new Date().toISOString();
  beforeEach(() => {
    db = createTestDb();
    db.runSync(
      `INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['student-1', 'Alice Botha', 10, 'Mathematics', 'CAPS', 'active', NOW]
    );
    db.runSync(
      `INSERT INTO sessions (id, student_id, mode, status, started_at, topics, created_at)
       VALUES ('live', 'student-1', 'online', 'active', ?, '[]', ?),
              ('done', 'student-1', 'online', 'completed', ?, '["Algebra"]', ?)`,
      [NOW, NOW, NOW, NOW]
    );
  });
  afterEach(() => resetDbSingleton());

  const topicsOf = (id: string) => parseSessionTopics(getSession(id)!.topics);

  it('writes picks to the active/paused session row', () => {
    expect(saveLiveTopics('live', ['Fractions', 'Ratios'])).toBe(true);
    expect(topicsOf('live')).toEqual(['Fractions', 'Ratios']);
    db.runSync(`UPDATE sessions SET status = 'paused', paused_at = ? WHERE id = 'live'`, [NOW]);
    expect(saveLiveTopics('live', ['Graphs'])).toBe(true);
    expect(topicsOf('live')).toEqual(['Graphs']);
    expect(saveLiveTopics('live', [])).toBe(true);
    expect(topicsOf('live')).toEqual([]);
  });

  it('never touches a finished lesson or the ledger', () => {
    expect(saveLiveTopics('done', ['Overwrite'])).toBe(false);
    expect(topicsOf('done')).toEqual(['Algebra']);
    expect(saveLiveTopics('missing', ['X'])).toBe(false);
    expect(db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM ledger_entries')!.n).toBe(0);
  });

  it('parseSessionTopics tolerates junk', () => {
    expect(parseSessionTopics('["A", 2, "B"]')).toEqual(['A', 'B']);
    expect(parseSessionTopics('nope')).toEqual([]);
    expect(parseSessionTopics(null)).toEqual([]);
    expect(parseSessionTopics('{"a":1}')).toEqual([]);
  });
});
