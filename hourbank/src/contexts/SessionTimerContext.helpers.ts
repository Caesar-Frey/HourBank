/**
 * Pure helpers for the live-lesson flow (timer context, root orphan recovery,
 * timer / end / summary screens). No React, no DB access — unit-tested.
 */
import { computeElapsedSeconds, isSessionError, DEFAULT_LESSON_MINUTES } from '../db/sessions';
import type { Session } from '../db/schema';
import { formatHours, formatMinutes } from '../utils/format';
import type { TimerAction, TimerStatus } from './sessionTimerReducer';

// ─── Routes ──────────────────────────────────────────────────────────────────

/** Exact live-lesson routes (timer + end-of-lesson review). */
export const LIVE_LESSON_ROUTE = /^\/student\/[^/]+\/(session|end-session)$/;

export function isLiveLessonRoute(path: string | null | undefined): boolean {
  return !!path && LIVE_LESSON_ROUTE.test(path);
}

// ─── Orphan recovery ─────────────────────────────────────────────────────────

export type OrphanTrigger = 'cold_start' | 'foreground';

export type InFlightSession = Pick<
  Session,
  'id' | 'student_id' | 'status' | 'started_at' | 'ended_at' | 'paused_at' | 'paused_seconds'
> & { student_full_name: string };

/**
 * Whether the root layout should ask "continue or discard?" about an in-flight
 * lesson. Cold start: always (if one exists). Foreground: only when the timer
 * context lost track of it (idle). Never on the live lesson screens themselves,
 * and never while a prompt is already showing.
 */
export function shouldPromptOrphan(args: {
  trigger: OrphanTrigger;
  pathname: string | null | undefined;
  timerStatus: TimerStatus;
  dbSession: Pick<Session, 'id' | 'status'> | null;
  promptOpen?: boolean;
}): boolean {
  const { trigger, pathname, timerStatus, dbSession, promptOpen } = args;
  if (!dbSession) return false;
  if (dbSession.status !== 'active' && dbSession.status !== 'paused') return false;
  if (promptOpen) return false;
  if (isLiveLessonRoute(pathname)) return false;
  if (trigger === 'cold_start') return true;
  return timerStatus === 'idle';
}

export function orphanPromptCopy(
  s: InFlightSession,
  now: Date = new Date(),
): { title: string; message: string } {
  const taught = formatMinutes(Math.floor(computeElapsedSeconds(s, now) / 60));
  if (s.status === 'paused') {
    return {
      title: 'Lesson paused',
      message: `You have a paused lesson with ${s.student_full_name} (${taught} taught). Continue it or discard it?`,
    };
  }
  return {
    title: 'Lesson still running',
    message: `Your lesson with ${s.student_full_name} is still running (${taught} so far). Continue it or discard it?`,
  };
}

// ─── Timer sync ──────────────────────────────────────────────────────────────

/** Map the DB's in-flight session (or none) to a reducer action. */
export function syncActionFromSession(
  s: Pick<Session, 'id' | 'student_id' | 'status' | 'started_at' | 'ended_at' | 'paused_at' | 'paused_seconds'> | null,
  now: Date = new Date(),
): TimerAction {
  if (!s || !s.started_at || (s.status !== 'active' && s.status !== 'paused')) return { type: 'RESET' };
  return {
    type: 'SYNC',
    sessionId: s.id,
    studentId: s.student_id,
    status: s.status,
    elapsedSeconds: computeElapsedSeconds(s, now),
    atMs: now.getTime(),
  };
}

export function canEndFromStatus(status: Session['status'] | null | undefined): boolean {
  return status === 'active' || status === 'paused';
}

// ─── Timer "remaining" line ──────────────────────────────────────────────────

/** Minutes left at which REMAINING turns amber. */
export const REMAINING_WARN_MINUTES = 10;

export type RemainingInfo = {
  mode: 'remaining' | 'over';
  minutes: number;
  tone: 'normal' | 'amber' | 'crimson';
  /** What the countdown is measured against: the booked length or the student's credit. */
  basis: 'booked' | 'balance';
  /** "40m REMAINING" / "OVER BY 12m" */
  label: string;
  /** "OF 1h BOOKED" / "OF 2h CREDIT" */
  caption: string;
};

/**
 * Countdown for the live timer: against the booked length, or against the
 * student's credit when that runs out first (or the lesson is unbooked).
 */
export function remainingInfo(args: {
  elapsedSeconds: number;
  bookedMinutes: number | null | undefined;
  balanceHours: number;
}): RemainingInfo {
  const { elapsedSeconds, bookedMinutes, balanceHours } = args;
  const balanceSeconds = Math.max(0, balanceHours) * 3600;
  const bookedSeconds = bookedMinutes && bookedMinutes > 0 ? bookedMinutes * 60 : null;

  const basis: 'booked' | 'balance' =
    bookedSeconds != null && bookedSeconds <= balanceSeconds ? 'booked' : 'balance';
  const limitSeconds = basis === 'booked' ? bookedSeconds! : balanceSeconds;
  const caption =
    basis === 'booked'
      ? `OF ${formatHours(bookedSeconds! / 3600)} BOOKED`
      : `OF ${formatHours(balanceSeconds / 3600)} CREDIT`;

  const left = limitSeconds - elapsedSeconds;
  if (left > 0) {
    const minutes = Math.ceil(left / 60);
    return {
      mode: 'remaining',
      minutes,
      tone: minutes <= REMAINING_WARN_MINUTES ? 'amber' : 'normal',
      basis,
      label: `${formatMinutes(minutes)} REMAINING`,
      caption,
    };
  }
  const minutes = Math.floor(-left / 60);
  return {
    mode: 'over',
    minutes,
    tone: 'crimson',
    basis,
    label: `OVER BY ${formatMinutes(minutes)}`,
    caption,
  };
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/** Friendly copy for a failed start (never surfaces raw DB messages). */
export function startErrorCopy(e: unknown): { title: string; message: string } {
  if (isSessionError(e, 'ALREADY_ACTIVE')) {
    return { title: 'Another lesson is running', message: 'Another lesson is already in progress. Finish or discard it first.' };
  }
  if (isSessionError(e, 'NOT_STARTABLE')) {
    return { title: "Can't start this lesson", message: "This lesson can't be started — it may already be finished, cancelled, or the student is archived." };
  }
  if (isSessionError(e, 'NOT_FOUND')) {
    return { title: 'Lesson not found', message: 'This lesson no longer exists.' };
  }
  if (isSessionError(e, 'INVALID_STATE')) {
    return { title: 'Lesson changed', message: 'This lesson changed in the meantime. Go back and try again.' };
  }
  return { title: 'Could not start lesson', message: 'Something went wrong starting the lesson. Please try again.' };
}

// ─── Lesson summary ──────────────────────────────────────────────────────────

export type LessonStatusKind = 'completed' | 'cancelled' | 'no_show' | 'scheduled' | 'overdue' | 'active' | 'paused';

/** Badge kind for a lesson (feed into `eventKindStyle`). Overdue = booked slot ended, never started. */
export function lessonStatusKind(
  s: Pick<Session, 'status' | 'cancel_reason' | 'scheduled_for' | 'estimated_duration_minutes'>,
  now: Date = new Date(),
): LessonStatusKind {
  switch (s.status) {
    case 'completed':
      return 'completed';
    case 'cancelled':
      return s.cancel_reason === 'no_show' ? 'no_show' : 'cancelled';
    case 'active':
      return 'active';
    case 'paused':
      return 'paused';
    case 'scheduled': {
      if (!s.scheduled_for) return 'scheduled';
      const start = new Date(s.scheduled_for).getTime();
      if (Number.isNaN(start)) return 'scheduled';
      const end = start + (s.estimated_duration_minutes ?? DEFAULT_LESSON_MINUTES) * 60_000;
      return end <= now.getTime() ? 'overdue' : 'scheduled';
    }
    default:
      return 'scheduled';
  }
}

/** Balance for tiles: "2h 30m", or "OWES 1h" when negative. */
export function balanceTileText(hours: number): string {
  return hours < 0 ? `OWES ${formatHours(Math.abs(hours))}` : formatHours(hours);
}

// ─── End-of-lesson draft (in memory, per session) ────────────────────────────

export type LessonDraft = {
  notes?: string;
  billedMinutes?: number;
  billedChanged?: boolean;
  /** Subject picked on the review screen. */
  subjectId?: string | null;
  /** Travel km as typed on the review screen. */
  kmText?: string;
};

const drafts = new Map<string, LessonDraft>();

/**
 * Keeps end-of-lesson edits while the tutor hops back to the timer and returns.
 * In memory only — cleared on save/discard, lost if the app is killed.
 */
export const lessonDraftStore = {
  get(sessionId: string): LessonDraft | null {
    const d = drafts.get(sessionId);
    return d ? { ...d } : null;
  },
  set(sessionId: string, patch: LessonDraft): void {
    drafts.set(sessionId, { ...(drafts.get(sessionId) ?? {}), ...patch });
  },
  clear(sessionId: string): void {
    drafts.delete(sessionId);
  },
};
