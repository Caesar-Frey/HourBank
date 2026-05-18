import { useState, useCallback, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import { getStudent } from '../db/students';
import { Student } from '../db/schema';
import { currentBalance, lastNEntries } from '../db/ledger';
import { LedgerEntry } from '../db/schema';
import { listUpcoming, listForStudent } from '../db/sessions';
import { Session } from '../db/schema';

export function useStudent(id: string) {
  const [student, setStudent] = useState<Student | null>(null);
  const [balance, setBalance] = useState(0);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [upcoming, setUpcoming] = useState<Session[]>([]);
  const [pastSessions, setPastSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

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
      setPastSessions(listForStudent(id, 10));
    } catch (e) {
      console.error('useStudent load error', e);
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
    setPastSessions([]);
    setLoading(true);
    load();
  }, [id]);

  // Refresh on focus (returning from top-up, edit, etc.)
  useFocusEffect(load);

  const canStartSession = balance > 0;

  return { student, balance, ledger, upcoming, pastSessions, loading, reload: load, canStartSession };
}
