import {
  isLiveLessonRoute,
  shouldPromptOrphan,
  orphanPromptCopy,
  syncActionFromSession,
  remainingInfo,
  startErrorCopy,
  lessonStatusKind,
  balanceTileText,
  lessonDraftStore,
  canEndFromStatus,
} from '../SessionTimerContext.helpers';
import { SessionError } from '../../db/sessions';
import { timerReducer, initialState } from '../sessionTimerReducer';

const NOW = new Date('2026-10-09T10:00:00.000Z');
const MIN = 60_000;
const iso = (msOffset: number) => new Date(NOW.getTime() + msOffset).toISOString();

describe('isLiveLessonRoute', () => {
  it.each([
    ['/student/abc/session', true],
    ['/student/abc/end-session', true],
    ['/student/abc', false],
    ['/student/abc/sessions', false],
    ['/student/abc/session/extra', false],
    ['/sessions', false],
    ['/lesson/xyz', false],
    ['/student/abc/schedule', false],
    ['', false],
  ])('%s → %s', (path, expected) => {
    expect(isLiveLessonRoute(path)).toBe(expected);
  });
  it('null/undefined → false', () => {
    expect(isLiveLessonRoute(null)).toBe(false);
    expect(isLiveLessonRoute(undefined)).toBe(false);
  });
});

describe('shouldPromptOrphan', () => {
  const db = { id: 's1', status: 'active' as const };

  it('no in-flight session → never', () => {
    expect(shouldPromptOrphan({ trigger: 'cold_start', pathname: '/', timerStatus: 'idle', dbSession: null })).toBe(false);
    expect(shouldPromptOrphan({ trigger: 'foreground', pathname: '/', timerStatus: 'idle', dbSession: null })).toBe(false);
  });

  it('cold start with in-flight session → prompt', () => {
    expect(shouldPromptOrphan({ trigger: 'cold_start', pathname: '/', timerStatus: 'active', dbSession: db })).toBe(true);
  });

  it('suppressed on the live lesson routes', () => {
    expect(shouldPromptOrphan({ trigger: 'cold_start', pathname: '/student/x/session', timerStatus: 'idle', dbSession: db })).toBe(false);
    expect(shouldPromptOrphan({ trigger: 'foreground', pathname: '/student/x/end-session', timerStatus: 'idle', dbSession: db })).toBe(false);
  });

  it('NOT suppressed on look-alike routes (substring match bug)', () => {
    expect(shouldPromptOrphan({ trigger: 'cold_start', pathname: '/sessions', timerStatus: 'idle', dbSession: db })).toBe(true);
  });

  it('foreground: only when the timer context is idle', () => {
    expect(shouldPromptOrphan({ trigger: 'foreground', pathname: '/', timerStatus: 'active', dbSession: db })).toBe(false);
    expect(shouldPromptOrphan({ trigger: 'foreground', pathname: '/', timerStatus: 'paused', dbSession: db })).toBe(false);
    expect(shouldPromptOrphan({ trigger: 'foreground', pathname: '/', timerStatus: 'idle', dbSession: db })).toBe(true);
  });

  it('never stacks a second prompt while one is open', () => {
    expect(shouldPromptOrphan({ trigger: 'cold_start', pathname: '/', timerStatus: 'idle', dbSession: db, promptOpen: true })).toBe(false);
  });
});

describe('orphanPromptCopy', () => {
  it('active lesson copy includes name and elapsed', () => {
    const c = orphanPromptCopy(
      { id: 's1', student_id: 'st', status: 'active', started_at: iso(-45 * MIN), ended_at: null, paused_at: null, paused_seconds: 0, student_full_name: 'Thandi Mokoena' },
      NOW,
    );
    expect(c.title).toMatch(/still running/i);
    expect(c.message).toContain('Thandi Mokoena');
    expect(c.message).toContain('45m');
  });

  it('paused lesson copy says paused and freezes elapsed at paused_at', () => {
    const c = orphanPromptCopy(
      { id: 's1', student_id: 'st', status: 'paused', started_at: iso(-120 * MIN), ended_at: null, paused_at: iso(-90 * MIN), paused_seconds: 0, student_full_name: 'Sipho' },
      NOW,
    );
    expect(c.title).toMatch(/paused/i);
    expect(c.message).toContain('paused lesson with Sipho');
    expect(c.message).toContain('30m');
  });
});

describe('syncActionFromSession', () => {
  it('null → RESET', () => {
    expect(syncActionFromSession(null, NOW)).toEqual({ type: 'RESET' });
  });

  it('active → SYNC active with wall − paused', () => {
    const a = syncActionFromSession(
      { id: 's1', student_id: 'st', status: 'active', started_at: iso(-30 * MIN), ended_at: null, paused_at: null, paused_seconds: 300 },
      NOW,
    );
    expect(a).toEqual({ type: 'SYNC', sessionId: 's1', studentId: 'st', status: 'active', elapsedSeconds: 25 * 60, atMs: NOW.getTime() });
  });

  it('paused → elapsed frozen at paused_at (no over-count)', () => {
    const a = syncActionFromSession(
      { id: 's1', student_id: 'st', status: 'paused', started_at: iso(-60 * MIN), ended_at: null, paused_at: iso(-40 * MIN), paused_seconds: 120 },
      NOW,
    );
    expect(a).toMatchObject({ type: 'SYNC', status: 'paused', elapsedSeconds: 20 * 60 - 120 });
  });

  it('completed/cancelled → RESET', () => {
    expect(
      syncActionFromSession({ id: 's1', student_id: 'st', status: 'completed', started_at: iso(-60 * MIN), ended_at: iso(0), paused_at: null, paused_seconds: 0 }, NOW),
    ).toEqual({ type: 'RESET' });
  });
});

describe('timerReducer SYNC + anchored TICK', () => {
  it('SYNC sets status exactly (paused stays paused)', () => {
    const s = timerReducer(initialState, { type: 'SYNC', sessionId: 's1', studentId: 'st', status: 'paused', elapsedSeconds: 600, atMs: 0 });
    expect(s.status).toBe('paused');
    expect(s.elapsedSeconds).toBe(600);
    expect(s.sessionId).toBe('s1');
  });

  it('SYNC overrides a stale active state with fresher DB elapsed', () => {
    const active = timerReducer(initialState, { type: 'START', sessionId: 's1', studentId: 'st', elapsedSeconds: 10 });
    const s = timerReducer(active, { type: 'SYNC', sessionId: 's1', studentId: 'st', status: 'active', elapsedSeconds: 900, atMs: 1000 });
    expect(s.elapsedSeconds).toBe(900);
    expect(s.status).toBe('active');
  });

  it('TICK with nowMs derives elapsed from the anchor (no drift)', () => {
    const s = timerReducer(initialState, { type: 'SYNC', sessionId: 's1', studentId: 'st', status: 'active', elapsedSeconds: 100, atMs: 1_000 });
    const t = timerReducer(s, { type: 'TICK', nowMs: 1_000 + 37_400 });
    expect(t.elapsedSeconds).toBe(137);
  });

  it('TICK without nowMs keeps legacy +1 behaviour', () => {
    const s = timerReducer(initialState, { type: 'START', sessionId: 's1', studentId: 'st', elapsedSeconds: 5 });
    expect(timerReducer(s, { type: 'TICK' }).elapsedSeconds).toBe(6);
  });
});

describe('remainingInfo', () => {
  it('booked lesson, plenty left → normal REMAINING against booking', () => {
    const r = remainingInfo({ elapsedSeconds: 20 * 60, bookedMinutes: 60, balanceHours: 10 });
    expect(r).toMatchObject({ mode: 'remaining', minutes: 40, tone: 'normal', basis: 'booked' });
    expect(r.label).toBe('40m REMAINING');
  });

  it('≤10 min left → amber', () => {
    const r = remainingInfo({ elapsedSeconds: 52 * 60, bookedMinutes: 60, balanceHours: 10 });
    expect(r.tone).toBe('amber');
    expect(r.minutes).toBe(8);
  });

  it('past booking → crimson OVER BY', () => {
    const r = remainingInfo({ elapsedSeconds: 72 * 60 + 30, bookedMinutes: 60, balanceHours: 10 });
    expect(r).toMatchObject({ mode: 'over', minutes: 12, tone: 'crimson' });
    expect(r.label).toBe('OVER BY 12m');
  });

  it('balance runs out before booking ends → balance is the limit', () => {
    const r = remainingInfo({ elapsedSeconds: 10 * 60, bookedMinutes: 60, balanceHours: 0.5 });
    expect(r).toMatchObject({ mode: 'remaining', minutes: 20, basis: 'balance' });
  });

  it('unscheduled lesson uses balance', () => {
    const r = remainingInfo({ elapsedSeconds: 0, bookedMinutes: null, balanceHours: 2 });
    expect(r).toMatchObject({ mode: 'remaining', minutes: 120, basis: 'balance', tone: 'normal' });
  });

  it('unscheduled, no balance → over from the start', () => {
    const r = remainingInfo({ elapsedSeconds: 5 * 60, bookedMinutes: null, balanceHours: 0 });
    expect(r).toMatchObject({ mode: 'over', minutes: 5, basis: 'balance', tone: 'crimson' });
  });
});

describe('startErrorCopy', () => {
  it('maps SessionError codes to friendly copy', () => {
    expect(startErrorCopy(new SessionError('ALREADY_ACTIVE')).message).toMatch(/another lesson/i);
    expect(startErrorCopy(new SessionError('NOT_STARTABLE')).message).toMatch(/can.t be started/i);
    expect(startErrorCopy(new SessionError('NOT_FOUND')).message).toMatch(/no longer exists/i);
  });
  it('unknown errors → generic retry copy, no raw message', () => {
    const c = startErrorCopy(new Error('SQLITE_BUSY: database is locked'));
    expect(c.message).not.toContain('SQLITE');
    expect(c.message).toMatch(/try again/i);
  });
});

describe('lessonStatusKind', () => {
  it.each([
    [{ status: 'completed', cancel_reason: null, scheduled_for: null, estimated_duration_minutes: null }, 'completed'],
    [{ status: 'cancelled', cancel_reason: 'no_show', scheduled_for: null, estimated_duration_minutes: null }, 'no_show'],
    [{ status: 'cancelled', cancel_reason: 'discarded', scheduled_for: null, estimated_duration_minutes: null }, 'cancelled'],
    [{ status: 'active', cancel_reason: null, scheduled_for: null, estimated_duration_minutes: null }, 'active'],
    [{ status: 'paused', cancel_reason: null, scheduled_for: null, estimated_duration_minutes: null }, 'paused'],
    [{ status: 'scheduled', cancel_reason: null, scheduled_for: iso(60 * MIN), estimated_duration_minutes: 60 }, 'scheduled'],
    [{ status: 'scheduled', cancel_reason: null, scheduled_for: iso(-30 * MIN), estimated_duration_minutes: 60 }, 'scheduled'],
    [{ status: 'scheduled', cancel_reason: null, scheduled_for: iso(-61 * MIN), estimated_duration_minutes: 60 }, 'overdue'],
    [{ status: 'scheduled', cancel_reason: null, scheduled_for: iso(-61 * MIN), estimated_duration_minutes: null }, 'overdue'],
  ] as const)('%o → %s', (s, expected) => {
    expect(lessonStatusKind(s, NOW)).toBe(expected);
  });
});

describe('balanceTileText', () => {
  it('positive → hours, negative → OWES', () => {
    expect(balanceTileText(2.5)).toBe('2h 30m');
    expect(balanceTileText(-1)).toBe('OWES 1h');
    expect(balanceTileText(0)).toBe('0m');
  });
});

describe('canEndFromStatus', () => {
  it('only in-flight lessons can be ended', () => {
    expect(canEndFromStatus('active')).toBe(true);
    expect(canEndFromStatus('paused')).toBe(true);
    expect(canEndFromStatus('completed')).toBe(false);
    expect(canEndFromStatus('scheduled')).toBe(false);
  });
});

describe('lessonDraftStore', () => {
  afterEach(() => lessonDraftStore.clear('s1'));
  it('round-trips and merges partial drafts per session', () => {
    expect(lessonDraftStore.get('s1')).toBeNull();
    lessonDraftStore.set('s1', { notes: 'hello' });
    lessonDraftStore.set('s1', { billedMinutes: 45, billedChanged: true });
    expect(lessonDraftStore.get('s1')).toEqual({ notes: 'hello', billedMinutes: 45, billedChanged: true });
    expect(lessonDraftStore.get('s2')).toBeNull();
    lessonDraftStore.clear('s1');
    expect(lessonDraftStore.get('s1')).toBeNull();
  });
});
