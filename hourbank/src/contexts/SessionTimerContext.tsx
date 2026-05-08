import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { getActiveSession } from '../db/sessions';
import { timerReducer, initialState, TimerStatus } from './sessionTimerReducer';

// ─── Context value type ────────────────────────────────────────────────────

interface SessionTimerContextValue {
  status: TimerStatus;
  sessionId: string | null;
  studentId: string | null;
  elapsedSeconds: number;
  startTimer: (
    sessionId: string,
    studentId: string,
    startedAt: string,
    accumulatedSeconds?: number,
  ) => void;
  pauseTimer: (accumulatedSeconds: number) => void;
  resumeTimer: (startedAt: string) => void;
  endTimer: () => void;
}

const SessionTimerContext = createContext<SessionTimerContextValue | null>(null);

// ─── Elapsed seconds helper ────────────────────────────────────────────────

function computeElapsed(
  status: TimerStatus,
  startedAt: string | null,
  accumulatedSeconds: number,
): number {
  if (status === 'active' && startedAt) {
    const sinceResume = Math.floor(
      (Date.now() - new Date(startedAt).getTime()) / 1000,
    );
    return Math.max(0, accumulatedSeconds + sinceResume);
  }
  if (status === 'paused') {
    return accumulatedSeconds;
  }
  return 0;
}

// ─── Provider ─────────────────────────────────────────────────────────────

export function SessionTimerProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(timerReducer, initialState);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tick counter purely to drive re-renders while active
  const [tick, setTick] = React.useState(0);

  // ── Sync from DB (mount + AppState active) ─────────────────────────────
  const syncFromDb = useCallback(() => {
    try {
      const active = getActiveSession();
      if (active) {
        // accumulatedSeconds = time from started_at minus already-paused seconds
        const accumulatedSeconds = active.paused_seconds ?? 0;
        dispatch({
          type: 'START',
          sessionId: active.id,
          studentId: active.student_id,
          startedAt: active.started_at!,
          accumulatedSeconds,
        });
      } else {
        // No active session in DB — reset if we thought there was one
        dispatch({ type: 'RESET' });
      }
    } catch (e) {
      console.error('SessionTimerContext syncFromDb error', e);
    }
  }, []);

  // Mount: load any persisted active session
  useEffect(() => {
    syncFromDb();
  }, [syncFromDb]);

  // AppState: re-sync when app foregrounds (handles kill-then-reopen)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        syncFromDb();
      }
    });
    return () => sub.remove();
  }, [syncFromDb]);

  // ── Interval — runs only when active ──────────────────────────────────
  useEffect(() => {
    if (state.status === 'active') {
      intervalRef.current = setInterval(() => {
        setTick(t => t + 1);
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [state.status]);

  // ── Derived elapsed (recalculated on every tick) ───────────────────────
  const elapsedSeconds = useMemo(
    () => computeElapsed(state.status, state.startedAt, state.accumulatedSeconds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.status, state.startedAt, state.accumulatedSeconds, tick],
  );

  // ── Action creators ────────────────────────────────────────────────────
  const startTimer = useCallback(
    (
      sessionId: string,
      studentId: string,
      startedAt: string,
      accumulatedSeconds = 0,
    ) => {
      dispatch({ type: 'START', sessionId, studentId, startedAt, accumulatedSeconds });
    },
    [],
  );

  const pauseTimer = useCallback((accumulatedSeconds: number) => {
    dispatch({ type: 'PAUSE', accumulatedSeconds });
  }, []);

  const resumeTimer = useCallback((startedAt: string) => {
    dispatch({ type: 'RESUME', startedAt });
  }, []);

  const endTimer = useCallback(() => {
    dispatch({ type: 'END' });
  }, []);

  const value = useMemo<SessionTimerContextValue>(
    () => ({
      status: state.status,
      sessionId: state.sessionId,
      studentId: state.studentId,
      elapsedSeconds,
      startTimer,
      pauseTimer,
      resumeTimer,
      endTimer,
    }),
    [state.status, state.sessionId, state.studentId, elapsedSeconds, startTimer, pauseTimer, resumeTimer, endTimer],
  );

  return (
    <SessionTimerContext.Provider value={value}>
      {children}
    </SessionTimerContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useSessionTimer(): SessionTimerContextValue {
  const ctx = useContext(SessionTimerContext);
  if (!ctx) {
    throw new Error('useSessionTimer must be used within a SessionTimerProvider');
  }
  return ctx;
}
