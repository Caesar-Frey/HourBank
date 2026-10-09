/**
 * claim.ts — pure fee helpers for the Tutor Claims / payout feature.
 *
 * Single source of truth for per-line claim pricing. Both the LIVE rollup
 * (getOutstandingPayout / listClaimablePool) and the FROZEN snapshot written by
 * finaliseClaim call these helpers, so live totals and stored snapshots are
 * byte-identical. All money values are rounded to 2 decimals (cents) at the
 * helper boundary.
 */

/** Round to 2 decimal places (cents), guarding against binary FP drift. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * COALESCE semantics: use the per-student override when present, otherwise the
 * tutor's default payout rate.
 */
export function effectiveRate(override: number | null, tutorRate: number): number {
  return override != null ? override : tutorRate;
}

/** Lesson fee = billed hours × effective rate, in cents. */
export function lessonFee(billedHours: number, effectiveRate: number): number {
  return round2(billedHours * effectiveRate);
}

/**
 * Travel allowance for a single line.
 * - online           ⇒ R0 (no travel)
 * - in_person + flat ⇒ student's flat travel fee
 * - in_person + dist ⇒ distanceKm × perKmRate
 */
export function travelFee(args: {
  mode: 'in_person' | 'online';
  travelMode: 'flat' | 'distance';
  flatFee: number;
  distanceKm: number;
  perKmRate: number;
}): number {
  if (args.mode === 'online') return 0;
  if (args.travelMode === 'flat') return round2(args.flatFee);
  return round2(args.distanceKm * args.perKmRate);
}

/** Exposed for callers that need to round derived totals consistently. */
export function roundCents(n: number): number {
  return round2(n);
}
