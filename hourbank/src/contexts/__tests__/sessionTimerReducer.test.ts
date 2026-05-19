import { timerReducer, initialState, TimerState } from '../sessionTimerReducer';

const ACTIVE_STATE: TimerState = {
  status: 'active',
  sessionId: 'sess-1',
  studentId: 'stu-1',
  elapsedSeconds: 0,
};

const ACTIVE_STATE_WITH_ELAPSED: TimerState = {
  status: 'active',
  sessionId: 'sess-1',
  studentId: 'stu-1',
  elapsedSeconds: 120,
};

const PAUSED_STATE: TimerState = {
  status: 'paused',
  sessionId: 'sess-1',
  studentId: 'stu-1',
  elapsedSeconds: 300,
};

describe('timerReducer', () => {
  // 1. START from idle
  it('START from idle → status active, fields populated', () => {
    const next = timerReducer(initialState, {
      type: 'START',
      sessionId: 'sess-1',
      studentId: 'stu-1',
      elapsedSeconds: 0,
    });
    expect(next.status).toBe('active');
    expect(next.sessionId).toBe('sess-1');
    expect(next.studentId).toBe('stu-1');
    expect(next.elapsedSeconds).toBe(0);
  });

  // START with non-zero elapsed (orphan recovery)
  it('START with non-zero elapsed → elapsedSeconds set', () => {
    const next = timerReducer(initialState, {
      type: 'START',
      sessionId: 'sess-1',
      studentId: 'stu-1',
      elapsedSeconds: 450,
    });
    expect(next.status).toBe('active');
    expect(next.elapsedSeconds).toBe(450);
  });

  // 2. PAUSE from active
  it('PAUSE from active → status paused', () => {
    const next = timerReducer(ACTIVE_STATE_WITH_ELAPSED, {
      type: 'PAUSE',
    });
    expect(next.status).toBe('paused');
    // elapsedSeconds preserved at pause time
    expect(next.elapsedSeconds).toBe(120);
    // other fields preserved
    expect(next.sessionId).toBe('sess-1');
    expect(next.studentId).toBe('stu-1');
  });

  // 3. RESUME from paused
  it('RESUME from paused → status active, elapsedSeconds preserved', () => {
    const next = timerReducer(PAUSED_STATE, {
      type: 'RESUME',
      elapsedSeconds: 300,
    });
    expect(next.status).toBe('active');
    // elapsedSeconds from action (recomputed by context before dispatch)
    expect(next.elapsedSeconds).toBe(300);
  });

  // 4. TICK when active → increments elapsedSeconds by 1
  it('TICK when active → elapsedSeconds increments by 1', () => {
    const next = timerReducer(ACTIVE_STATE_WITH_ELAPSED, { type: 'TICK' });
    expect(next.status).toBe('active');
    expect(next.elapsedSeconds).toBe(121);
  });

  // 5. TICK when paused → no change to elapsedSeconds
  it('TICK when paused → no change', () => {
    const next = timerReducer(PAUSED_STATE, { type: 'TICK' });
    expect(next).toBe(PAUSED_STATE);
  });

  // 6. TICK when idle → no change
  it('TICK when idle → no change', () => {
    const next = timerReducer(initialState, { type: 'TICK' });
    expect(next).toBe(initialState);
  });

  // 7. END from active
  it('END from active → status idle, all fields cleared', () => {
    const next = timerReducer(ACTIVE_STATE, { type: 'END' });
    expect(next.status).toBe('idle');
    expect(next.sessionId).toBeNull();
    expect(next.studentId).toBeNull();
    expect(next.elapsedSeconds).toBe(0);
  });

  // 8. END from paused
  it('END from paused → status idle, all fields cleared', () => {
    const next = timerReducer(PAUSED_STATE, { type: 'END' });
    expect(next.status).toBe('idle');
    expect(next.sessionId).toBeNull();
    expect(next.studentId).toBeNull();
    expect(next.elapsedSeconds).toBe(0);
  });

  // 9. RESET from any status
  it('RESET from active → idle state', () => {
    const next = timerReducer(ACTIVE_STATE, { type: 'RESET' });
    expect(next).toEqual(initialState);
  });

  it('RESET from paused → idle state', () => {
    const next = timerReducer(PAUSED_STATE, { type: 'RESET' });
    expect(next).toEqual(initialState);
  });

  it('RESET from idle → idle state (no-op)', () => {
    const next = timerReducer(initialState, { type: 'RESET' });
    expect(next).toEqual(initialState);
  });

  // 10. Unknown action → state unchanged
  it('unknown action → state unchanged', () => {
    // @ts-expect-error testing unknown action
    const next = timerReducer(ACTIVE_STATE, { type: 'UNKNOWN' });
    expect(next).toBe(ACTIVE_STATE);
  });

  // 11. PAUSE from idle → no-op
  it('PAUSE from idle → state unchanged', () => {
    const next = timerReducer(initialState, { type: 'PAUSE' });
    expect(next).toBe(initialState);
  });

  // 12. RESUME from active → no-op
  it('RESUME from active → state unchanged', () => {
    const next = timerReducer(ACTIVE_STATE, { type: 'RESUME', elapsedSeconds: 120 });
    expect(next).toBe(ACTIVE_STATE);
  });
});
