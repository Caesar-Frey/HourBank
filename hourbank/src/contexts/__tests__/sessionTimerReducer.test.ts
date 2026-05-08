import { timerReducer, initialState, TimerState } from '../sessionTimerReducer';

const ACTIVE_STATE: TimerState = {
  status: 'active',
  sessionId: 'sess-1',
  studentId: 'stu-1',
  startedAt: '2024-01-01T10:00:00.000Z',
  accumulatedSeconds: 0,
};

const PAUSED_STATE: TimerState = {
  status: 'paused',
  sessionId: 'sess-1',
  studentId: 'stu-1',
  startedAt: '2024-01-01T10:00:00.000Z',
  accumulatedSeconds: 300,
};

describe('timerReducer', () => {
  // 1. START from idle
  it('START from idle → status active, fields populated', () => {
    const next = timerReducer(initialState, {
      type: 'START',
      sessionId: 'sess-1',
      studentId: 'stu-1',
      startedAt: '2024-01-01T10:00:00.000Z',
      accumulatedSeconds: 0,
    });
    expect(next.status).toBe('active');
    expect(next.sessionId).toBe('sess-1');
    expect(next.studentId).toBe('stu-1');
    expect(next.startedAt).toBe('2024-01-01T10:00:00.000Z');
    expect(next.accumulatedSeconds).toBe(0);
  });

  // 2. PAUSE from active
  it('PAUSE from active → status paused, accumulatedSeconds updated', () => {
    const next = timerReducer(ACTIVE_STATE, {
      type: 'PAUSE',
      accumulatedSeconds: 120,
    });
    expect(next.status).toBe('paused');
    expect(next.accumulatedSeconds).toBe(120);
    // other fields preserved
    expect(next.sessionId).toBe('sess-1');
    expect(next.studentId).toBe('stu-1');
  });

  // 3. RESUME from paused
  it('RESUME from paused → status active, startedAt updated', () => {
    const newStartedAt = '2024-01-01T10:05:00.000Z';
    const next = timerReducer(PAUSED_STATE, {
      type: 'RESUME',
      startedAt: newStartedAt,
    });
    expect(next.status).toBe('active');
    expect(next.startedAt).toBe(newStartedAt);
    // accumulatedSeconds preserved from paused state
    expect(next.accumulatedSeconds).toBe(300);
  });

  // 4. END from active
  it('END from active → status idle, all fields cleared', () => {
    const next = timerReducer(ACTIVE_STATE, { type: 'END' });
    expect(next.status).toBe('idle');
    expect(next.sessionId).toBeNull();
    expect(next.studentId).toBeNull();
    expect(next.startedAt).toBeNull();
    expect(next.accumulatedSeconds).toBe(0);
  });

  // 5. END from paused
  it('END from paused → status idle, all fields cleared', () => {
    const next = timerReducer(PAUSED_STATE, { type: 'END' });
    expect(next.status).toBe('idle');
    expect(next.sessionId).toBeNull();
    expect(next.studentId).toBeNull();
    expect(next.startedAt).toBeNull();
    expect(next.accumulatedSeconds).toBe(0);
  });

  // 6. RESET from any status
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

  // 7. Unknown action → state unchanged
  it('unknown action → state unchanged', () => {
    // @ts-expect-error testing unknown action
    const next = timerReducer(ACTIVE_STATE, { type: 'UNKNOWN' });
    expect(next).toBe(ACTIVE_STATE);
  });

  // 8. PAUSE from idle → no-op
  it('PAUSE from idle → state unchanged', () => {
    const next = timerReducer(initialState, { type: 'PAUSE', accumulatedSeconds: 0 });
    expect(next).toBe(initialState);
  });

  // 9. RESUME from active → no-op
  it('RESUME from active → state unchanged', () => {
    const next = timerReducer(ACTIVE_STATE, { type: 'RESUME', startedAt: '2024-01-01T10:05:00.000Z' });
    expect(next).toBe(ACTIVE_STATE);
  });
});
