export type TimerStatus = 'idle' | 'active' | 'paused';

export type TimerState = {
  status: TimerStatus;
  sessionId: string | null;
  studentId: string | null;
  elapsedSeconds: number;  // seconds of RUNNING time (excludes paused time)
};

export type TimerAction =
  | { type: 'START'; sessionId: string; studentId: string; elapsedSeconds: number }
  | { type: 'PAUSE' }
  | { type: 'RESUME'; elapsedSeconds: number }
  | { type: 'TICK' }
  | { type: 'END' }
  | { type: 'RESET' };

export const initialState: TimerState = {
  status: 'idle',
  sessionId: null,
  studentId: null,
  elapsedSeconds: 0,
};

export function timerReducer(state: TimerState, action: TimerAction): TimerState {
  switch (action.type) {
    case 'START':
      return {
        status: 'active',
        sessionId: action.sessionId,
        studentId: action.studentId,
        elapsedSeconds: action.elapsedSeconds,
      };

    case 'PAUSE':
      // Guard: only pause if active
      if (state.status !== 'active') return state;
      return {
        ...state,
        status: 'paused',
      };

    case 'RESUME':
      // Guard: only resume if paused
      if (state.status !== 'paused') return state;
      return {
        ...state,
        status: 'active',
        elapsedSeconds: action.elapsedSeconds,
      };

    case 'TICK':
      // Only tick when active
      if (state.status !== 'active') return state;
      return {
        ...state,
        elapsedSeconds: state.elapsedSeconds + 1,
      };

    case 'END':
      return initialState;

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}
