import { useState, useCallback, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import { getStudent } from '../db/students';
import { Student } from '../db/schema';
import { currentBalance, lastNEntries } from '../db/ledger';
import { LedgerEntry } from '../db/schema';
import { listUpcoming, listForStudent, listUpcomingWithProjection } from '../db/sessions';
import { Session } from '../db/schema';

export type UpcomingWithProjection = Session & { projected_balance_after: number };

export function useStudent(id: string) {
  const [student, setStudent] = useState<Student | null>(null);
  const [balance, setBalance] = useState(0);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [upcoming, setUpcoming] = useState<Session[]>([]);
  /** Future scheduled lessons with the balance projected after each (WS-5). */
  const [upcomingProjected, setUpcomingProjected] = useState<UpcomingWithProjection[]>([]);
  const [pastSessions, setPastSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    try {
      const s = getStudent(id);
      if (!s) {
        setStudent(null);
        return;
      }
      setStudent(s);
      setBalance(currentBalance(id));
      setLedger(lastNEntries(id, 5));
      setUpcoming(listUpcoming(id));
      setUpcomingProjected(listUpcomingWithProjection(id));
      setPastSessions(listForStudent(id, 10));
      setError(null);
    } catch (e) {
      console.error('useStudent load error', e);
      setError("Couldn't load this student");
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Reset stale state immediately when id changes, then reload
  useEffect(() => {
    setStudent(null);
    setBalance(0);
    setLedger([]);
    setUpcoming([]);
    setUpcomingProjected([]);
    setPastSessions([]);
    setLoading(true);
    load();
  }, [id]);

  // Refresh on focus (returning from top-up, edit, etc.)
  useFocusEffect(load);

  const canStartSession = balance > 0;

  return {
    student, balance, ledger, upcoming, upcomingProjected, pastSessions,
    loading, error, reload: load, canStartSession,
  };
}
