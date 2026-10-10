/**
 * Pure helpers for Money → In (reports) and Money → Out (payouts/claims).
 */
import type { SessionListRow } from '../../db/reports';
import type { ClaimablePoolLine } from '../../db/claims';
import { formatMinutes } from '../../utils/format';

const EPS = 1e-9;

// ─── Month switcher ──────────────────────────────────────────────────────────

export function shiftMonth(year: number, monthIdx: number, delta: number): { year: number; monthIdx: number } {
  const d = new Date(year, monthIdx + delta, 1);
  return { year: d.getFullYear(), monthIdx: d.getMonth() };
}

export function isFutureMonth(year: number, monthIdx: number, now: Date = new Date()): boolean {
  return year > now.getFullYear() || (year === now.getFullYear() && monthIdx > now.getMonth());
}

// ─── Outstanding (student balances) ──────────────────────────────────────────

export interface Outstanding {
  /** Hours students owe in total (sum of negative balances, as a positive number). */
  owedHours: number;
  owingStudents: number;
  /** Hours parents have paid for but not yet received (sum of positive balances). */
  prepaidHours: number;
}

export function outstandingFromBalances(balances: number[]): Outstanding {
  let owedHours = 0;
  let owingStudents = 0;
  let prepaidHours = 0;
  for (const b of balances) {
    if (b < -EPS) {
      owedHours += -b;
      owingStudents += 1;
    } else if (b > EPS) {
      prepaidHours += b;
    }
  }
  return { owedHours, owingStudents, prepaidHours };
}

// ─── Lessons list ────────────────────────────────────────────────────────────

export function isChargedNoShow(row: Pick<SessionListRow, 'status' | 'cancel_reason'>): boolean {
  return row.status === 'cancelled' && row.cancel_reason === 'no_show';
}

/** Right-hand amount for a lesson row: billed length, e.g. "1h 30m". */
export function lessonBilledLabel(row: Pick<SessionListRow, 'billed_minutes'>): string {
  return formatMinutes(Math.max(0, row.billed_minutes ?? 0));
}

// ─── Payout hints ────────────────────────────────────────────────────────────

export interface PayoutHints {
  /** Payout rate is 0 → every lesson fee is R 0.00. */
  zeroRate: boolean;
  /** In-person lessons in the pool that carry no travel fee. */
  inPersonWithoutTravel: number;
}

export function payoutHints(payoutRate: number, pool: Pick<ClaimablePoolLine, 'mode' | 'travel_fee'>[]): PayoutHints {
  return {
    zeroRate: !(payoutRate > 0),
    inPersonWithoutTravel: pool.filter(l => l.mode === 'in_person' && !(l.travel_fee > 0)).length,
  };
}
