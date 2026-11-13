/** Actual vs booked tolerance (minutes) within which the booked length is billed. */
export const BILLING_TOLERANCE_MINUTES = 15;

/**
 * Default billed minutes at the end of a lesson:
 * - booked length if actual is within ±15 min of it;
 * - otherwise actual rounded to the nearest `roundTo` minutes (minimum one unit).
 */
export function defaultBilledMinutes(
  actualMinutes: number,
  bookedMinutes: number | null | undefined,
  roundTo = 15,
): number {
  const unit = roundTo > 0 ? roundTo : 15;
  if (bookedMinutes && bookedMinutes > 0 && Math.abs(actualMinutes - bookedMinutes) <= BILLING_TOLERANCE_MINUTES) {
    return bookedMinutes;
  }
  const rounded = Math.round(Math.max(0, actualMinutes) / unit) * unit;
  return Math.max(unit, rounded);
}

/** Warn only when the tutor changed the billed amount AND it differs from actual by > 15 min. */
export function shouldWarnBilledDeviation(
  billedMinutes: number,
  actualMinutes: number,
  changedByTutor: boolean,
): boolean {
  return changedByTutor && Math.abs(billedMinutes - actualMinutes) > BILLING_TOLERANCE_MINUTES;
}

/** Longest an unbooked timer may run before it is treated as forgotten. */
export const RUNAWAY_UNBOOKED_MINUTES = 4 * 60;

/**
 * A timer is *runaway* (almost certainly forgotten) when it has run longer than
 * max(booked × 2, booked + 60 min), or longer than 4h when nothing was booked.
 */
export function isRunawayTimer(elapsedMinutes: number, bookedMinutes: number | null | undefined): boolean {
  if (!Number.isFinite(elapsedMinutes)) return false;
  if (bookedMinutes && bookedMinutes > 0) {
    return elapsedMinutes > Math.max(bookedMinutes * 2, bookedMinutes + 60);
  }
  return elapsedMinutes > RUNAWAY_UNBOOKED_MINUTES;
}

/** Suggested end of a runaway lesson: start + booked length (start + 1h when unbooked). */
export function runawayDefaultEnd(startedAt: string, bookedMinutes: number | null | undefined): Date {
  const minutes = bookedMinutes && bookedMinutes > 0 ? bookedMinutes : 60;
  return new Date(new Date(startedAt).getTime() + minutes * 60_000);
}

/**
 * Taught minutes when the tutor sets the end time themselves: chosen end −
 * start − paused time (never more pause than the span itself).
 */
export function taughtMinutesUntil(startedAt: string, endedAt: Date, pausedSeconds: number): number {
  const spanSec = Math.max(0, Math.floor((endedAt.getTime() - new Date(startedAt).getTime()) / 1000));
  const paused = Math.min(Math.max(0, pausedSeconds), spanSec);
  return (spanSec - paused) / 60;
}

/** Snap minutes to the lesson-length grid (nearest step, minimum one step). */
export function snapToStep(minutes: number, step: number): number {
  const unit = step > 0 ? step : 30;
  return Math.max(unit, Math.round(Math.max(0, minutes) / unit) * unit);
}
