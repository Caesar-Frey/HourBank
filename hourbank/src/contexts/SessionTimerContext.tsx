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
import { getDb } from '../db/client';
import { getActiveOrPausedSession } from '../db/sessions';
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
    pausedSeconds?: number,
  ) => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  resumeFromDb: (sessionId: string, studentId: string) => void;
  endTimer: () => void;
}

const SessionTimerContext = createContext<SessionTimerContextValue | null>(null);

// ─── Elapsed computation helpers ──────────────────────────────────────────

function computeElapsedFromDb(startedAt: string, pausedSeconds: number): number {
  const wallMs = Date.now() - new Date(startedAt).getTime();
  const wallSeconds = Math.floor(wallMs / 1000);
  return Math.max(0, wallSeconds - pausedSeconds);
}

// ─── Provider ─────────────────────────────────────────────────────────────

export function SessionTimerProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(timerReducer, initialState);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Sync from DB (mount + AppState active) ─────────────────────────────
  const syncFromDb = useCallback(() => {
    try {
      const active = getActiveOrPausedSession();
      if (active) {
        // If session ended or was cancelled, reset and bail
        if (active.status === 'cancelled' || active.status === 'completed') {
          dispatch({ type: 'RESET' });
          return;
        }
        const pausedSeconds = active.paused_seconds ?? 0;
        if (active.status === 'paused' && active.paused_at) {
          // Session is paused — compute elapsed at the moment of pause, not now
          const pausedAtMs = new Date(active.paused_at).getTime();
          const startedAtMs = new Date(active.started_at!).getTime();
          const wallSeconds = Math.floor((pausedAtMs - startedAtMs) / 1000);
          const elapsed = Math.max(0, wallSeconds - pausedSeconds);
          dispatch({
            type: 'START',
            sessionId: active.id,
            studentId: active.student_id,
            elapsedSeconds: elapsed,
          });
          // Immediately pause in reducer
          dispatch({ type: 'PAUSE' });
        } else {
          // Session is active
          const elapsed = computeElapsedFromDb(active.started_at!, pausedSeconds);
          dispatch({
            type: 'START',
            sessionId: active.id,
            studentId: active.student_id,
            elapsedSeconds: elapsed,
          });
        }
      } else {
        // No active/paused session in DB — reset if we thought there was one
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

  // ── Interval — TICK only when active ──────────────────────────────────
  useEffect(() => {
    if (state.status === 'active') {
      intervalRef.current = setInterval(() => {
        dispatch({ type: 'TICK' });
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

  // ── Action creators ────────────────────────────────────────────────────

  /**
   * Call after creating a new session row. Computes elapsed from DB values.
   * pausedSeconds defaults to 0 for brand-new sessions.
   */
  const startTimer = useCallback(
    (
      sessionId: string,
      studentId: string,
      startedAt: string,
      pausedSeconds = 0,
    ) => {
      const elapsed = computeElapsedFromDb(startedAt, pausedSeconds);
      dispatch({ type: 'START', sessionId, studentId, elapsedSeconds: elapsed });
    },
    [],
  );

  /**
   * Pause: writes paused_at + status = 'paused' to DB, then updates reducer.
   */
  const pauseTimer = useCallback(() => {
    if (state.status !== 'active' || !state.sessionId) return;
    const now = new Date().toISOString();
    try {
      const db = getDb();
      db.runSync(
        `UPDATE sessions SET paused_at = ?, status = 'paused' WHERE id = ?`,
        [now, state.sessionId],
      );
    } catch (e) {
      console.error('SessionTimerContext pauseTimer DB error', e);
    }
    dispatch({ type: 'PAUSE' });
  }, [state.status, state.sessionId]);

  /**
   * Resume: reads paused_at from DB, accumulates paused time, writes back,
   * recomputes elapsed, then updates reducer.
   */
  const resumeTimer = useCallback(() => {
    if (state.status !== 'paused' || !state.sessionId) return;
    try {
      const db = getDb();
      const row = db.getFirstSync<{
        paused_at: string | null;
        paused_seconds: number;
        started_at: string | null;
      }>(
        'SELECT paused_at, paused_seconds, started_at FROM sessions WHERE id = ?',
        [state.sessionId],
      );
      if (!row || !row.started_at) return;

      const now = new Date().toISOString();
      let newPausedSeconds = row.paused_seconds ?? 0;
      if (row.paused_at) {
        const pausedMs = Date.now() - new Date(row.paused_at).getTime();
        newPausedSeconds += Math.floor(pausedMs / 1000);
      }

      db.runSync(
        `UPDATE sessions SET paused_at = NULL, paused_seconds = ?, status = 'active' WHERE id = ?`,
        [newPausedSeconds, state.sessionId],
      );

      const elapsed = computeElapsedFromDb(row.started_at, newPausedSeconds);
      dispatch({ type: 'RESUME', elapsedSeconds: elapsed });
    } catch (e) {
      console.error('SessionTimerContext resumeTimer DB error', e);
    }
  }, [state.status, state.sessionId]);

  /**
   * Orphan recovery: called when user taps "Continue" in orphan modal.
   * Reads session from DB and sets up timer state accordingly.
   */
  const resumeFromDb = useCallback((sessionId: string, studentId: string) => {
    try {
      const db = getDb();
      const row = db.getFirstSync<{
        status: string;
        started_at: string | null;
        paused_at: string | null;
        paused_seconds: number;
      }>(
        'SELECT status, started_at, paused_at, paused_seconds FROM sessions WHERE id = ?',
        [sessionId],
      );
      if (!row || !row.started_at) return;

      const pausedSeconds = row.paused_seconds ?? 0;

      if (row.status === 'paused') {
        // Compute elapsed at the moment of pause
        const elapsed = computeElapsedFromDb(row.started_at, pausedSeconds);
        dispatch({ type: 'START', sessionId, studentId, elapsedSeconds: elapsed });
        dispatch({ type: 'PAUSE' });
      } else {
        // Active — compute current elapsed
        const elapsed = computeElapsedFromDb(row.started_at, pausedSeconds);
        dispatch({ type: 'START', sessionId, studentId, elapsedSeconds: elapsed });
      }
    } catch (e) {
      console.error('SessionTimerContext resumeFromDb error', e);
    }
  }, []);

  const endTimer = useCallback(() => {
    dispatch({ type: 'END' });
  }, []);

  const value = useMemo<SessionTimerContextValue>(
    () => ({
      status: state.status,
      sessionId: state.sessionId,
      studentId: state.studentId,
      elapsedSeconds: state.elapsedSeconds,
      startTimer,
      pauseTimer,
      resumeTimer,
      resumeFromDb,
      endTimer,
    }),
    [state.status, state.sessionId, state.studentId, state.elapsedSeconds, startTimer, pauseTimer, resumeTimer, resumeFromDb, endTimer],
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
