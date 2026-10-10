/**
 * Confirm-then-act flows for pausing / archiving a student, shared by the
 * student detail and edit screens. Errors are reported via `onError` (toast),
 * never thrown into the render tree.
 */
import { Alert } from 'react-native';
import { archiveStudent, countScheduledLessons, pauseStudent } from '../../db/students';
import { archiveConfirmMessage, pauseConfirmMessage } from './flowLogic';

function errorMessage(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : '';
  if (/active or paused session/i.test(msg)) return 'End the live lesson before archiving';
  return fallback;
}

function safeCount(studentId: string): number {
  try {
    return countScheduledLessons(studentId);
  } catch {
    return 0;
  }
}

export function confirmArchiveStudent(opts: {
  studentId: string;
  name: string;
  balance: number;
  onArchived: (cancelledLessons: number) => void;
  onError: (message: string) => void;
}): void {
  const lessons = safeCount(opts.studentId);
  Alert.alert(
    `Archive ${opts.name}?`,
    archiveConfirmMessage(opts.name, opts.balance, lessons),
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: lessons > 0 ? 'Archive & cancel lessons' : 'Archive',
        style: 'destructive',
        onPress: () => {
          try {
            const { cancelledLessons } = archiveStudent(opts.studentId);
            opts.onArchived(cancelledLessons);
          } catch (e) {
            opts.onError(errorMessage(e, "Couldn't archive — please try again"));
          }
        },
      },
    ],
  );
}

export function confirmPauseStudent(opts: {
  studentId: string;
  name: string;
  onPaused: () => void;
  onError: (message: string) => void;
}): void {
  const lessons = safeCount(opts.studentId);
  const run = () => {
    try {
      pauseStudent(opts.studentId);
      opts.onPaused();
    } catch {
      opts.onError("Couldn't pause — please try again");
    }
  };
  Alert.alert(`Pause ${opts.name}?`, pauseConfirmMessage(opts.name, lessons), [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Pause', onPress: run },
  ]);
}
