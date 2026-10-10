import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { isSessionError, startSession } from '../db/sessions';
import type { Session } from '../db/schema';
import { useSessionTimer } from '../contexts/SessionTimerContext';
import { startErrorCopy } from '../contexts/SessionTimerContext.helpers';
import { formatHours, formatMinutes } from '../utils/format';

type OweDetails = {
  projectedBalanceHours?: number;
  maxOweHours?: number;
  lessonMinutes?: number;
};

/**
 * Start a scheduled lesson with the shared nudge flow:
 * - OVER_OWE_LIMIT → "Start anyway?" confirm → retry with allowOverOwe
 * - ALREADY_ACTIVE → offer to open the lesson that is already running
 * - anything else → friendly copy (never raw DB messages)
 * On success the timer context is re-synced from the DB and `onStarted` runs.
 */
export function useStartLesson() {
  const router = useRouter();
  const { refreshFromDb } = useSessionTimer();

  return useCallback(
    (sessionId: string, opts: { studentName?: string | null; onStarted: (s: Session) => void }) => {
      const who = opts.studentName?.trim() || 'The student';

      const attempt = (allowOverOwe: boolean) => {
        try {
          const s = startSession(sessionId, { allowOverOwe });
          refreshFromDb();
          opts.onStarted(s);
        } catch (e) {
          if (isSessionError(e, 'OVER_OWE_LIMIT')) {
            const d = (e.details ?? {}) as OweDetails;
            const owes = Math.max(0, -(d.projectedBalanceHours ?? 0));
            const lesson = d.lessonMinutes ? `this ${formatMinutes(d.lessonMinutes)} lesson` : 'this lesson';
            const limit =
              d.maxOweHours && d.maxOweHours > 0
                ? `That's more than your ${formatHours(d.maxOweHours)} owing limit.`
                : "Your settings don't allow owing.";
            Alert.alert(
              'Start anyway?',
              `${who} will owe ${formatHours(owes)} after ${lesson}. ${limit}`,
              [
                { text: 'Not now', style: 'cancel' },
                { text: 'Start anyway', onPress: () => attempt(true) },
              ],
            );
            return;
          }
          if (isSessionError(e, 'ALREADY_ACTIVE')) {
            const activeId = e.details?.activeSessionId as string | undefined;
            const activeStudent = e.details?.activeStudentId as string | undefined;
            const copy = startErrorCopy(e);
            Alert.alert(
              copy.title,
              copy.message,
              activeId && activeStudent
                ? [
                    { text: 'Not now', style: 'cancel' },
                    {
                      text: 'Open live lesson',
                      onPress: () => router.push(`/student/${activeStudent}/session?sessionId=${activeId}`),
                    },
                  ]
                : [{ text: 'OK' }],
            );
            return;
          }
          const copy = startErrorCopy(e);
          Alert.alert(copy.title, copy.message);
        }
      };

      attempt(false);
    },
    [router, refreshFromDb],
  );
}
