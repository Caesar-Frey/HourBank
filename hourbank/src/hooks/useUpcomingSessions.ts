import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { listAllUpcoming } from '../db/sessions';

export function useUpcomingSessions() {
  const [sessions, setSessions] = useState<ReturnType<typeof listAllUpcoming>>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    try {
      setSessions(listAllUpcoming());
    } catch (e) {
      console.error('useUpcomingSessions error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(load);
  return { sessions, loading, reload: load };
}
