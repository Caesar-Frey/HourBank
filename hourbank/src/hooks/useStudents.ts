import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { listActiveStudents } from '../db/students';

export function useStudents() {
  const [students, setStudents] = useState<ReturnType<typeof listActiveStudents>>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setStudents(listActiveStudents());
    setLoading(false);
  }, []);

  useFocusEffect(load);

  return { students, loading, reload: load };
}
