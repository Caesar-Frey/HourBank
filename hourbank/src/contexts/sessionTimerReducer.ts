export type TimerStatus = 'idle' | 'active' | 'paused';

export type TimerState = {
  status: TimerStatus;
  sessionId: string | null;
  studentId: string | null;
  startedAt: string | null;       // ISO timestamp when last started/resumed
  accumulatedSeconds: number;     // seconds accumulated before last pause
};

export type TimerAction =
  | { type: 'START'; sessionId: string; studentId: string; startedAt: string; accumulatedSeconds: number }
  | { type: 'PAUSE'; accumulatedSeconds: number }
  | { type: 'RESUME'; startedAt: string }
  | { type: 'END' }
  | { type: 'RESET' };

export const initialState: TimerState = {
  status: 'idle',
  sessionId: null,
  studentId: null,
  startedAt: null,
  accumulatedSeconds: 0,
};

export function timerReducer(state: TimerState, action: TimerAction): TimerState {
  switch (action.type) {
    case 'START':
      return {
        status: 'active',
        sessionId: action.sessionId,
        studentId: action.studentId,
        startedAt: action.startedAt,
        accumulatedSeconds: action.accumulatedSeconds,
      };

    case 'PAUSE':
      // Guard: only pause if active
      if (state.status !== 'active') return state;
      return {
        ...state,
        status: 'paused',
        accumulatedSeconds: action.accumulatedSeconds,
      };

    case 'RESUME':
      // Guard: only resume if paused
      if (state.status !== 'paused') return state;
      return {
        ...state,
        status: 'active',
        startedAt: action.startedAt,
      };

    case 'END':
      return initialState;

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}
