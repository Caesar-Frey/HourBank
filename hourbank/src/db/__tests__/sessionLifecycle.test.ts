import { createMigratedTestDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import {
  SessionError,
  isSessionError,
  startSession,
  createAndStartUnscheduled,
  createScheduled,
  checkOweLimit,
  pauseSession,
  resumeSession,
  discardSession,
  endSession,
  logPastSession,
  markNoShow,
  rescheduleSession,
  cancelScheduled,
  listAgenda,
  computeElapsedSeconds,
  sessionsThisWeek,
  sessionsThisWeekCount,
  listUpcomingWithProjection,
} from '../sessions';
import type { Session } from '../schema';

const T0 = '2026-03-10T08:00:00.000Z';

let db: TestDb;

function addStudent(id = 'stu-1', status = 'active', name = 'Alice') {
  db.runSync(
    `INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at) VALUES (?, ?, 10, 'Maths', 'CAPS', ?, ?)`,
    [id, name, status, T0]
  );
}

function topUp(hours: number, studentId = 'stu-1') {
  db.runSync(
    `INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, created_at) VALUES (?, ?, 'top_up', ?, 0, ?)`,
    [`tu-${Math.random()}`, studentId, hours, T0]
  );
}

function setMaxOwe(hours: number) {
  db.runSync(
    `INSERT INTO tutor_profile (id, full_name, hourly_rate, max_owe_hours, created_at, updated_at) VALUES ('p1', '', 600, ?, ?, ?)`,
    [hours, T0, T0]
  );
}

function scheduled(at: string, minutes = 60, studentId = 'stu-1'): Session {
  return createScheduled({
    studentId, scheduledFor: at, estimatedDurationMinutes: minutes, mode: 'in_person', session_type: 'general',
  });
}

function row(id: string): Session {
  return db.getFirstSync<Session>('SELECT * FROM sessions WHERE id = ?', [id])!;
}

function ledgerFor(sessionId: string) {
  return db.getAllSync<{ hours_delta: number; type: string }>(
    'SELECT hours_delta, type FROM ledger_entries WHERE related_session_id = ?', [sessionId]
  );
}

beforeEach(() => {
  db = createMigratedTestDb();
  addStudent();
});
afterEach(() => resetDbSingleton());

describe('SessionError', () => {
  it('is an Error carrying a code and passes instanceof', () => {
    const e = new SessionError('OVER_OWE_LIMIT', 'x');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(SessionError);
    expect(isSessionError(e, 'OVER_OWE_LIMIT')).toBe(true);
    expect(isSessionError(e, 'ALREADY_ACTIVE')).toBe(false);
    expect(isSessionError(new Error('x'))).toBe(false);
  });
});

describe('startSession', () => {
  it('starts a scheduled session', () => {
    topUp(10);
    const s = scheduled(T0);
    const started = startSession(s.id);
    expect(started.status).toBe('active');
    expect(started.started_at).not.toBeNull();
  });

  it('throws NOT_FOUND for an unknown id', () => {
    expect(() => startSession('nope')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('throws NOT_STARTABLE for completed or cancelled sessions', () => {
    topUp(10);
    const s = scheduled(T0);
    cancelScheduled(s.id);
    expect(() => startSession(s.id)).toThrow(expect.objectContaining({ code: 'NOT_STARTABLE' }));
  });

  it('is idempotent for the session that is already in flight (does not reset started_at)', () => {
    topUp(10);
    const s = scheduled(T0);
    const first = startSession(s.id, { now: new Date('2026-03-10T08:00:00.000Z') });
    const again = startSession(s.id, { now: new Date('2026-03-10T09:00:00.000Z') });
    expect(again.started_at).toBe(first.started_at);
  });

  it('throws ALREADY_ACTIVE when another session is active', () => {
    topUp(10);
    const a = scheduled(T0);
    const b = scheduled('2026-03-11T08:00:00.000Z');
    startSession(a.id);
    let err: unknown;
    try { startSession(b.id); } catch (e) { err = e; }
    expect(isSessionError(err, 'ALREADY_ACTIVE')).toBe(true);
    expect((err as SessionError).details).toEqual(expect.objectContaining({ activeSessionId: a.id }));
    expect(row(b.id).status).toBe('scheduled');
  });

  it('throws ALREADY_ACTIVE when another session is paused', () => {
    topUp(10);
    const a = scheduled(T0);
    const b = scheduled('2026-03-11T08:00:00.000Z');
    startSession(a.id);
    pauseSession(a.id);
    expect(() => startSession(b.id)).toThrow(expect.objectContaining({ code: 'ALREADY_ACTIVE' }));
  });

  describe('owe limit (nudge, overridable)', () => {
    it('max_owe 0: throws OVER_OWE_LIMIT when the lesson would make balance negative', () => {
      setMaxOwe(0);
      topUp(0.5);
      const s = scheduled(T0, 60);
      let err: unknown;
      try { startSession(s.id); } catch (e) { err = e; }
      expect(isSessionError(err, 'OVER_OWE_LIMIT')).toBe(true);
      expect((err as SessionError).details).toEqual(expect.objectContaining({
        balanceHours: 0.5, projectedBalanceHours: -0.5, maxOweHours: 0, lessonMinutes: 60,
      }));
      expect(row(s.id).status).toBe('scheduled');
    });

    it('max_owe 0: allows start when balance covers the lesson exactly', () => {
      setMaxOwe(0);
      topUp(1);
      const s = scheduled(T0, 60);
      expect(startSession(s.id).status).toBe('active');
    });

    it('no tutor_profile row behaves like max_owe 0', () => {
      const s = scheduled(T0, 60);
      expect(() => startSession(s.id)).toThrow(expect.objectContaining({ code: 'OVER_OWE_LIMIT' }));
    });

    it('max_owe N: allows owing up to N', () => {
      setMaxOwe(2);
      topUp(0);
      const s = scheduled(T0, 120);
      expect(startSession(s.id).status).toBe('active');
    });

    it('max_owe N: throws when the lesson would push owing past N', () => {
      setMaxOwe(2);
      db.runSync(
        `INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, created_at) VALUES ('d', 'stu-1', 'session_deduction', -1.5, -1.5, ?)`,
        [T0]
      );
      const s = scheduled(T0, 60);
      expect(() => startSession(s.id)).toThrow(expect.objectContaining({ code: 'OVER_OWE_LIMIT' }));
    });

    it('allowOverOwe: true overrides the limit', () => {
      setMaxOwe(0);
      const s = scheduled(T0, 60);
      expect(startSession(s.id, { allowOverOwe: true }).status).toBe('active');
    });

    it('checkOweLimit reports projection without side effects', () => {
      setMaxOwe(1);
      topUp(0.5);
      expect(checkOweLimit('stu-1', 90)).toMatchObject({
        balanceHours: 0.5, projectedBalanceHours: -1, maxOweHours: 1, lessonMinutes: 90, overLimit: false,
      });
      expect(checkOweLimit('stu-1', 120).overLimit).toBe(true);
    });
  });
});

describe('createAndStartUnscheduled', () => {
  it('creates and starts in one step', () => {
    topUp(5);
    const s = createAndStartUnscheduled({ studentId: 'stu-1', mode: 'online' });
    expect(s.status).toBe('active');
    expect(s.scheduled_for).toBeNull();
    expect(s.mode).toBe('online');
  });

  it('leaves no orphan row when the owe check fails', () => {
    setMaxOwe(0);
    expect(() => createAndStartUnscheduled({ studentId: 'stu-1', mode: 'in_person' }))
      .toThrow(expect.objectContaining({ code: 'OVER_OWE_LIMIT' }));
    expect(db.getAllSync('SELECT id FROM sessions')).toHaveLength(0);
  });

  it('leaves no orphan row when another session is active', () => {
    topUp(5);
    createAndStartUnscheduled({ studentId: 'stu-1', mode: 'in_person' });
    expect(() => createAndStartUnscheduled({ studentId: 'stu-1', mode: 'in_person' }))
      .toThrow(expect.objectContaining({ code: 'ALREADY_ACTIVE' }));
    expect(db.getAllSync('SELECT id FROM sessions')).toHaveLength(1);
  });

  it('uses estimatedMinutes for the owe projection and stores it', () => {
    setMaxOwe(0);
    topUp(0.5);
    const s = createAndStartUnscheduled({ studentId: 'stu-1', mode: 'in_person', estimatedMinutes: 30 });
    expect(s.estimated_duration_minutes).toBe(30);
  });
});

describe('pause / resume / discard', () => {
  function startAt(iso: string): Session {
    topUp(10);
    const s = scheduled(T0);
    return startSession(s.id, { now: new Date(iso) });
  }

  it('pauseSession only pauses an active session', () => {
    const s = startAt('2026-03-10T08:00:00.000Z');
    const p = pauseSession(s.id, new Date('2026-03-10T08:10:00.000Z'));
    expect(p.status).toBe('paused');
    expect(p.paused_at).toBe('2026-03-10T08:10:00.000Z');
    expect(() => pauseSession(s.id)).toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
  });

  it('resumeSession accumulates the pause interval', () => {
    const s = startAt('2026-03-10T08:00:00.000Z');
    pauseSession(s.id, new Date('2026-03-10T08:10:00.000Z'));
    const r = resumeSession(s.id, new Date('2026-03-10T08:15:00.000Z'));
    expect(r.status).toBe('active');
    expect(r.paused_at).toBeNull();
    expect(r.paused_seconds).toBe(300);
    expect(() => resumeSession(s.id)).toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
  });

  it('discardSession cancels an in-flight session with reason discarded', () => {
    const s = startAt('2026-03-10T08:00:00.000Z');
    expect(discardSession(s.id, new Date('2026-03-10T08:20:00.000Z'))).toBe(true);
    const r = row(s.id);
    expect(r.status).toBe('cancelled');
    expect(r.cancel_reason).toBe('discarded');
    expect(r.ended_at).toBe('2026-03-10T08:20:00.000Z');
    expect(ledgerFor(s.id)).toHaveLength(0);
  });

  it('discardSession is a guarded no-op for non in-flight sessions', () => {
    topUp(10);
    const s = scheduled(T0);
    expect(discardSession(s.id)).toBe(false);
    expect(row(s.id).status).toBe('scheduled');
  });
});

describe('endSession', () => {
  it('closes an open pause interval when ending a paused session', () => {
    topUp(10);
    const s = scheduled(T0);
    startSession(s.id, { now: new Date('2026-03-10T08:00:00.000Z') });
    pauseSession(s.id, new Date('2026-03-10T08:50:00.000Z'));
    const { session } = endSession({
      sessionId: s.id,
      endedAt: '2026-03-10T09:00:00.000Z',
      durationMinutes: 50,
      billedMinutes: 60,
      pausedSeconds: 0,
      topics: [],
    });
    expect(session.paused_seconds).toBe(600);
    expect(session.paused_at).toBeNull();
    expect(session.status).toBe('completed');
  });
});

describe('computeElapsedSeconds', () => {
  const base = { started_at: '2026-03-10T08:00:00.000Z', ended_at: null, paused_at: null, paused_seconds: 0 };

  it('returns 0 when not started', () => {
    expect(computeElapsedSeconds({ ...base, started_at: null, status: 'scheduled' }, new Date('2026-03-10T09:00:00.000Z'))).toBe(0);
  });

  it('active: wall time minus accumulated pauses', () => {
    expect(computeElapsedSeconds({ ...base, paused_seconds: 120, status: 'active' }, new Date('2026-03-10T08:30:00.000Z'))).toBe(1680);
  });

  it('paused: frozen at paused_at, not now', () => {
    const s = { ...base, paused_seconds: 60, paused_at: '2026-03-10T08:20:00.000Z', status: 'paused' as const };
    expect(computeElapsedSeconds(s, new Date('2026-03-10T10:00:00.000Z'))).toBe(1140);
  });

  it('completed: uses ended_at', () => {
    const s = { ...base, ended_at: '2026-03-10T09:00:00.000Z', paused_seconds: 0, status: 'completed' as const };
    expect(computeElapsedSeconds(s, new Date('2026-03-12T10:00:00.000Z'))).toBe(3600);
  });

  it('never negative', () => {
    expect(computeElapsedSeconds({ ...base, paused_seconds: 99999, status: 'active' }, new Date('2026-03-10T08:01:00.000Z'))).toBe(0);
  });
});

describe('logPastSession', () => {
  const now = new Date('2026-03-12T12:00:00.000Z');

  it('creates a completed session plus deduction in one go', () => {
    topUp(5);
    const { session, entry } = logPastSession({
      studentId: 'stu-1', startedAt: '2026-03-11T14:00:00.000Z', minutes: 90, topics: ['Algebra'], notes: 'good', now,
    });
    expect(session.status).toBe('completed');
    expect(session.started_at).toBe('2026-03-11T14:00:00.000Z');
    expect(session.ended_at).toBe('2026-03-11T15:30:00.000Z');
    expect(session.duration_minutes).toBe(90);
    expect(session.billed_minutes).toBe(90);
    expect(session.session_notes).toBe('good');
    expect(JSON.parse(session.topics)).toEqual(['Algebra']);
    expect(entry.hours_delta).toBeCloseTo(-1.5);
    expect(entry.related_session_id).toBe(session.id);
  });

  it('completes an existing scheduled session ("Log as taught")', () => {
    topUp(5);
    const s = scheduled('2026-03-11T14:00:00.000Z', 60);
    const { session } = logPastSession({
      studentId: 'stu-1', sessionId: s.id, startedAt: '2026-03-11T14:00:00.000Z', minutes: 60, topics: [], now,
    });
    expect(session.id).toBe(s.id);
    expect(session.status).toBe('completed');
    expect(db.getAllSync('SELECT id FROM sessions')).toHaveLength(1);
    expect(ledgerFor(s.id)).toEqual([{ hours_delta: -1, type: 'session_deduction' }]);
  });

  it('supports billedMinutes different from minutes', () => {
    topUp(5);
    const { session, entry } = logPastSession({
      studentId: 'stu-1', startedAt: '2026-03-11T14:00:00.000Z', minutes: 50, billedMinutes: 60, topics: [], now,
    });
    expect(session.duration_minutes).toBe(50);
    expect(entry.hours_delta).toBeCloseTo(-1);
  });

  it('is not blocked by the owe limit (lesson already happened)', () => {
    setMaxOwe(0);
    expect(() => logPastSession({ studentId: 'stu-1', startedAt: '2026-03-11T14:00:00.000Z', minutes: 60, topics: [], now }))
      .not.toThrow();
  });

  it('rejects a non-scheduled session id and rolls back', () => {
    topUp(5);
    const s = scheduled('2026-03-11T14:00:00.000Z', 60);
    cancelScheduled(s.id);
    expect(() => logPastSession({ studentId: 'stu-1', sessionId: s.id, startedAt: '2026-03-11T14:00:00.000Z', minutes: 60, topics: [], now }))
      .toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
    expect(ledgerFor(s.id)).toHaveLength(0);
  });

  it('rejects zero minutes and future start times', () => {
    expect(() => logPastSession({ studentId: 'stu-1', startedAt: '2026-03-11T14:00:00.000Z', minutes: 0, topics: [], now }))
      .toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => logPastSession({ studentId: 'stu-1', startedAt: '2026-03-13T14:00:00.000Z', minutes: 60, topics: [], now }))
      .toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });
});

describe('markNoShow', () => {
  it('without charge: cancels with reason no_show and no ledger entry', () => {
    const s = scheduled(T0, 60);
    const { session, entry } = markNoShow(s.id, { charge: false });
    expect(session.status).toBe('cancelled');
    expect(session.cancel_reason).toBe('no_show');
    expect(entry).toBeNull();
    expect(ledgerFor(s.id)).toHaveLength(0);
  });

  it('with charge: deducts the given minutes', () => {
    topUp(5);
    const s = scheduled(T0, 60);
    const { session, entry } = markNoShow(s.id, { charge: true, minutes: 30 });
    expect(session.cancel_reason).toBe('no_show');
    expect(session.billed_minutes).toBe(30);
    expect(entry?.hours_delta).toBeCloseTo(-0.5);
    expect(entry?.reason).toBe('No-show');
  });

  it('with charge and no minutes: defaults to booked length', () => {
    topUp(5);
    const s = scheduled(T0, 90);
    const { entry } = markNoShow(s.id, { charge: true });
    expect(entry?.hours_delta).toBeCloseTo(-1.5);
  });

  it('rejects non-scheduled sessions', () => {
    const s = scheduled(T0, 60);
    cancelScheduled(s.id);
    expect(() => markNoShow(s.id, { charge: false })).toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
  });
});

describe('rescheduleSession / cancelScheduled', () => {
  it('moves a scheduled lesson', () => {
    const s = scheduled(T0, 60);
    const r = rescheduleSession(s.id, '2026-03-20T10:00:00.000Z');
    expect(r.scheduled_for).toBe('2026-03-20T10:00:00.000Z');
    expect(r.status).toBe('scheduled');
  });

  it('rejects invalid dates and non-scheduled sessions', () => {
    const s = scheduled(T0, 60);
    expect(() => rescheduleSession(s.id, 'garbage')).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    cancelScheduled(s.id);
    expect(() => rescheduleSession(s.id, '2026-03-20T10:00:00.000Z')).toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
  });

  it('cancelScheduled sets reason cancelled and refuses in-flight sessions', () => {
    topUp(10);
    const s = scheduled(T0, 60);
    cancelScheduled(s.id);
    expect(row(s.id).cancel_reason).toBe('cancelled');
    const t = scheduled('2026-03-11T08:00:00.000Z', 60);
    startSession(t.id);
    expect(() => cancelScheduled(t.id)).toThrow(expect.objectContaining({ code: 'INVALID_STATE' }));
  });
});

describe('listAgenda', () => {
  // Local-time construction so the test is timezone independent.
  const now = new Date(2026, 2, 10, 12, 0, 0); // 10 Mar 2026 12:00 local
  const local = (d: number, h: number, m = 0) => new Date(2026, 2, d, h, m, 0).toISOString();

  it('buckets lessons into overdue / today / upcoming using local day boundaries', () => {
    topUp(20);
    const yesterday = scheduled(local(9, 15));
    const earlyToday = scheduled(local(10, 8)); // 08:00–09:00 today: ended, not started → overdue
    const laterToday = scheduled(local(10, 16));
    const lateTonight = scheduled(local(10, 23, 30));
    const tomorrow = scheduled(local(11, 0, 30));
    const agenda = listAgenda(now);
    expect(agenda.overdue.map(s => s.id)).toEqual([yesterday.id, earlyToday.id]);
    expect(agenda.today.map(s => s.id)).toEqual([laterToday.id, lateTonight.id]);
    expect(agenda.upcoming.map(s => s.id)).toEqual([tomorrow.id]);
    expect(agenda.inProgress).toEqual([]);
  });

  it('a lesson that has started its slot but not finished stays in today', () => {
    const current = scheduled(local(10, 11, 30), 60); // 11:30–12:30
    expect(listAgenda(now).today.map(s => s.id)).toEqual([current.id]);
  });

  it('includes in-flight (active or paused) sessions in inProgress with student name', () => {
    topUp(20);
    const s = scheduled(local(10, 11));
    startSession(s.id);
    pauseSession(s.id);
    const agenda = listAgenda(now);
    expect(agenda.inProgress.map(x => x.id)).toEqual([s.id]);
    expect(agenda.inProgress[0].student_full_name).toBe('Alice');
    expect(agenda.today).toEqual([]);
    expect(agenda.overdue).toEqual([]);
  });

  it('excludes archived students and cancelled/completed lessons', () => {
    addStudent('stu-2', 'archived', 'Bob');
    scheduled(local(10, 16), 60, 'stu-2');
    const c = scheduled(local(10, 17));
    cancelScheduled(c.id);
    const agenda = listAgenda(now);
    expect([...agenda.today, ...agenda.overdue, ...agenda.upcoming]).toEqual([]);
  });
});

describe('listUpcomingWithProjection', () => {
  it('projects the balance after each booked lesson', () => {
    topUp(1.5);
    const now = new Date('2026-03-10T00:00:00.000Z');
    scheduled('2026-03-11T08:00:00.000Z', 60);
    scheduled('2026-03-12T08:00:00.000Z', 60);
    const rows = listUpcomingWithProjection('stu-1', now);
    expect(rows.map(r => r.projected_balance_after)).toEqual([0.5, -0.5]);
  });
});

describe('week stats exclude archived students', () => {
  it('sessionsThisWeek and sessionsThisWeekCount ignore archived students', () => {
    addStudent('stu-2', 'archived', 'Bob');
    const ended = new Date().toISOString();
    db.runSync(
      `INSERT INTO sessions (id, student_id, status, started_at, ended_at, duration_minutes, billed_minutes) VALUES ('a', 'stu-1', 'completed', ?, ?, 60, 60)`,
      [ended, ended]
    );
    db.runSync(
      `INSERT INTO sessions (id, student_id, status, started_at, ended_at, duration_minutes, billed_minutes) VALUES ('b', 'stu-2', 'completed', ?, ?, 60, 60)`,
      [ended, ended]
    );
    expect(sessionsThisWeekCount()).toBe(1);
    expect(sessionsThisWeek()).toBe(1);
  });
});
