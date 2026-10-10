import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
  getActiveOrPausedSession,
  getSession,
  pauseSession,
  resumeSession,
  computeElapsedSeconds,
} from '../db/sessions';
import { timerReducer, initialState, TimerStatus } from './sessionTimerReducer';
import { syncActionFromSession } from './SessionTimerContext.helpers';

// ─── Context value type ────────────────────────────────────────────────────

interface SessionTimerContextValue {
  status: TimerStatus;
  sessionId: string | null;
  studentId: string | null;
  elapsedSeconds: number;
  /** Call right after a session row was started. */
  startTimer: (
    sessionId: string,
    studentId: string,
    startedAt: string,
    pausedSeconds?: number,
  ) => void;
  /** Pause in DB (guarded) then mirror it. Returns false if the DB refused. */
  pauseTimer: () => boolean;
  /** Resume in DB (guarded) then mirror it. Returns false if the DB refused. */
  resumeTimer: () => boolean;
  /** Load timer state for a specific in-flight session (orphan "Continue"). */
  resumeFromDb: (sessionId: string, studentId: string) => void;
  /** Re-derive timer state from the DB's in-flight session (focus / foreground). */
  refreshFromDb: () => void;
  /** Reset to idle. Call only AFTER the lesson was ended/discarded in the DB. */
  endTimer: () => void;
}

const SessionTimerContext = createContext<SessionTimerContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────

export function SessionTimerProvider({
  children,
  /** Skip DB reads until the database is initialised (root DB gate). */
  enabled = true,
}: {
  children: React.ReactNode;
  enabled?: boolean;
}) {
  const [state, dispatch] = useReducer(timerReducer, initialState);

  // ── Sync from DB (DB is authoritative; elapsed via computeElapsedSeconds) ─
  const refreshFromDb = useCallback(() => {
    try {
      dispatch(syncActionFromSession(getActiveOrPausedSession(), new Date()));
    } catch (e) {
      console.error('SessionTimerContext refreshFromDb error', e);
    }
  }, []);

  // Mount (once DB is ready): load any persisted in-flight session
  useEffect(() => {
    if (enabled) refreshFromDb();
  }, [enabled, refreshFromDb]);

  // AppState: re-sync when app foregrounds (handles background drift / kill)
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') refreshFromDb();
    });
    return () => sub.remove();
  }, [enabled, refreshFromDb]);

  // ── Interval — TICK only when active, anchored to wall clock ──────────
  useEffect(() => {
    if (state.status !== 'active') return;
    const handle = setInterval(() => {
      dispatch({ type: 'TICK', nowMs: Date.now() });
    }, 1000);
    return () => clearInterval(handle);
  }, [state.status]);

  // ── Action creators ────────────────────────────────────────────────────

  const startTimer = useCallback(
    (sessionId: string, studentId: string, startedAt: string, pausedSeconds = 0) => {
      const now = new Date();
      const elapsed = computeElapsedSeconds(
        { status: 'active', started_at: startedAt, ended_at: null, paused_at: null, paused_seconds: pausedSeconds },
        now,
      );
      dispatch({ type: 'START', sessionId, studentId, elapsedSeconds: elapsed, atMs: now.getTime() });
    },
    [],
  );

  const pauseTimer = useCallback((): boolean => {
    if (state.status !== 'active' || !state.sessionId) return false;
    try {
      const now = new Date();
      const s = pauseSession(state.sessionId, now);
      dispatch(syncActionFromSession(s, now));
      return true;
    } catch (e) {
      console.error('SessionTimerContext pauseTimer error', e);
      refreshFromDb();
      return false;
    }
  }, [state.status, state.sessionId, refreshFromDb]);

  const resumeTimer = useCallback((): boolean => {
    if (state.status !== 'paused' || !state.sessionId) return false;
    try {
      const now = new Date();
      const s = resumeSession(state.sessionId, now);
      dispatch(syncActionFromSession(s, now));
      return true;
    } catch (e) {
      console.error('SessionTimerContext resumeTimer error', e);
      refreshFromDb();
      return false;
    }
  }, [state.status, state.sessionId, refreshFromDb]);

  const resumeFromDb = useCallback((sessionId: string, _studentId: string) => {
    try {
      dispatch(syncActionFromSession(getSession(sessionId), new Date()));
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
      refreshFromDb,
      endTimer,
    }),
    [state.status, state.sessionId, state.studentId, state.elapsedSeconds, startTimer, pauseTimer, resumeTimer, resumeFromDb, refreshFromDb, endTimer],
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
