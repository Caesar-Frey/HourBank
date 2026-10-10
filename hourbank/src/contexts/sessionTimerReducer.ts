export type TimerStatus = 'idle' | 'active' | 'paused';

export type TimerState = {
  status: TimerStatus;
  sessionId: string | null;
  studentId: string | null;
  elapsedSeconds: number;  // seconds of RUNNING time (excludes paused time)
  /**
   * Anchor for drift-free ticking: elapsed at `anchorAtMs` (wall clock).
   * While active, elapsed = anchorElapsed + (now − anchorAtMs). Optional so
   * legacy START / RESUME without a timestamp keep the +1-per-tick behaviour.
   */
  anchorElapsed?: number;
  anchorAtMs?: number | null;
};

export type TimerAction =
  | { type: 'START'; sessionId: string; studentId: string; elapsedSeconds: number; atMs?: number }
  /** Authoritative state derived from the DB row (status set exactly — no START→PAUSE dance). */
  | { type: 'SYNC'; sessionId: string; studentId: string; status: 'active' | 'paused'; elapsedSeconds: number; atMs: number }
  | { type: 'PAUSE' }
  | { type: 'RESUME'; elapsedSeconds: number; atMs?: number }
  | { type: 'TICK'; nowMs?: number }
  | { type: 'END' }
  | { type: 'RESET' };

export const initialState: TimerState = {
  status: 'idle',
  sessionId: null,
  studentId: null,
  elapsedSeconds: 0,
};

function anchor(elapsedSeconds: number, atMs: number | undefined) {
  return atMs == null ? {} : { anchorElapsed: elapsedSeconds, anchorAtMs: atMs };
}

export function timerReducer(state: TimerState, action: TimerAction): TimerState {
  switch (action.type) {
    case 'START':
      return {
        status: 'active',
        sessionId: action.sessionId,
        studentId: action.studentId,
        elapsedSeconds: action.elapsedSeconds,
        ...anchor(action.elapsedSeconds, action.atMs),
      };

    case 'SYNC':
      return {
        status: action.status,
        sessionId: action.sessionId,
        studentId: action.studentId,
        elapsedSeconds: action.elapsedSeconds,
        ...anchor(action.elapsedSeconds, action.atMs),
      };

    case 'PAUSE':
      // Guard: only pause if active
      if (state.status !== 'active') return state;
      return {
        ...state,
        status: 'paused',
        anchorAtMs: null,
      };

    case 'RESUME':
      // Guard: only resume if paused
      if (state.status !== 'paused') return state;
      return {
        ...state,
        status: 'active',
        elapsedSeconds: action.elapsedSeconds,
        anchorAtMs: null,
        ...anchor(action.elapsedSeconds, action.atMs),
      };

    case 'TICK': {
      // Only tick when active
      if (state.status !== 'active') return state;
      if (action.nowMs != null && state.anchorAtMs != null && state.anchorElapsed != null) {
        const next = state.anchorElapsed + Math.max(0, Math.floor((action.nowMs - state.anchorAtMs) / 1000));
        return next === state.elapsedSeconds ? state : { ...state, elapsedSeconds: next };
      }
      return {
        ...state,
        elapsedSeconds: state.elapsedSeconds + 1,
      };
    }

    case 'END':
      return initialState;

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}
