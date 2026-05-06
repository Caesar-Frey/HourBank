import { useState, useEffect, useRef, useCallback } from 'react';
import { getDb } from '../db/client';
import { Session } from '../db/schema';

export function useActiveSession(sessionId: string, initialBalance: number) {
  const [session, setSession] = useState<Session | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const pauseStartRef = useRef<number | null>(null);
  const totalPausedMsRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load session on mount
  useEffect(() => {
    try {
      const db = getDb();
      const s = db.getFirstSync<Session>('SELECT * FROM sessions WHERE id = ?', [sessionId]);
      if (!s || !s.started_at) return;
      setSession(s);
      // Restore paused_seconds from DB (if app was killed and resumed)
      totalPausedMsRef.current = (s.paused_seconds || 0) * 1000;
    } catch (e) {
      console.error('useActiveSession load error', e);
    }
  }, [sessionId]);

  // Timer tick
  useEffect(() => {
    if (!session?.started_at || isPaused) return;
    intervalRef.current = setInterval(() => {
      const startedAt = new Date(session.started_at!).getTime();
      const elapsed = Math.floor((Date.now() - startedAt - totalPausedMsRef.current) / 1000);
      setElapsedSeconds(Math.max(0, elapsed));
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [session, isPaused]);

  const pause = useCallback(() => {
    if (isPaused) return;
    setIsPaused(true);
    pauseStartRef.current = Date.now();
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, [isPaused]);

  const resume = useCallback(() => {
    if (!isPaused || pauseStartRef.current === null) return;
    totalPausedMsRef.current += Date.now() - pauseStartRef.current;
    pauseStartRef.current = null;
    setIsPaused(false);
  }, [isPaused]);

  const elapsedHours = elapsedSeconds / 3600;
  const remainingHours = Math.max(0, initialBalance - elapsedHours);
  const totalPausedSeconds = Math.floor(totalPausedMsRef.current / 1000);

  return {
    session,
    elapsedSeconds,
    isPaused,
    pause,
    resume,
    elapsedHours,
    remainingHours,
    totalPausedSeconds,
  };
}
