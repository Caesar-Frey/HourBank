/**
 * travel.ts — PARENT travel charge (what a family pays for the tutor's travel).
 *
 * Distinct from the tutor's PAYOUT travel (src/utils/claim.ts `travelFee`, priced
 * from tutor_profile.travel_mode for claims). Parent rates are per student and
 * can change over time, so the charge is snapshotted onto each lesson
 * (sessions.parent_travel_fee) when it is recorded.
 */
import type { ParentTravelMode } from '../db/schema';

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Parent travel charge for one lesson (rand, cents-rounded).
 * online or mode 'none' → 0; 'flat' → flat fee; 'per_km' → km × rate.
 */
export function parentTravelCharge(args: {
  lessonMode: 'in_person' | 'online';
  parentTravelMode: ParentTravelMode;
  flatFee: number;
  perKm: number;
  km: number;
}): number {
  if (args.lessonMode === 'online' || args.parentTravelMode === 'none') return 0;
  if (args.parentTravelMode === 'flat') return round2(Math.max(0, args.flatFee));
  return round2(Math.max(0, args.km) * Math.max(0, args.perKm));
}
