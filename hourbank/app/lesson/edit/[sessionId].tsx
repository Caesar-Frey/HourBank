/** Edit a recorded lesson in place: /lesson/edit/[sessionId]. */
import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { LessonFormScreen } from '../../../src/components/lesson/LessonFormScreen';

export default function EditLessonScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  return <LessonFormScreen kind="edit" sessionId={sessionId} />;
}
