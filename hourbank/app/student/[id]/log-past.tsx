/**
 * Record lesson (route kept as /student/[id]/log-past for existing links).
 * Params: sessionId? (booked/overdue lesson), startedAt? (explicit start), from=lesson.
 */
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { LessonFormScreen } from '../../../src/components/lesson/LessonFormScreen';

export default function RecordLessonScreen() {
  const { id, sessionId, startedAt, from } = useLocalSearchParams<{ id: string; sessionId?: string; startedAt?: string; from?: string }>();
  return <LessonFormScreen kind="record" studentId={id} sessionId={sessionId} startedAt={startedAt} from={from} />;
}
