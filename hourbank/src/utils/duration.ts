/** @deprecated Use `defaultBilledMinutes` (booked-length aware, 15-min rounding). */
export function roundToBilledMinutes(seconds: number): number {
  return Math.round(seconds / 60 / 30) * 30;
}

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
