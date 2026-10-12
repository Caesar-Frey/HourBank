/**
 * Pure helpers for Money → In (reports) and Money → Out (payouts/claims).
 */
import type { SessionListRow, TopUpRow, TravelSettlementRow } from '../../db/reports';
import type { ClaimablePoolLine } from '../../db/claims';
import { formatHours, formatMinutes, formatRand, pluralize } from '../../utils/format';

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

// ─── Hours taught tile ───────────────────────────────────────────────────────

/** "2 lessons taught" — count of lessons actually taught (charged no-shows excluded). */
export function taughtLessonsLabel(lessons: number): string {
  return `${lessons} ${pluralize(lessons, 'lesson')} taught`;
}

/** "+ 1 no-show charged · 1h", or null when there were none. */
export function noShowChargedLabel(count: number, hours: number): string | null {
  if (!(count > 0)) return null;
  return `+ ${count} ${pluralize(count, 'no-show')} charged · ${formatHours(hours)}`;
}

// ─── Cash received (packages + travel) ───────────────────────────────────────

export type CashRow =
  | { kind: 'package'; id: string; created_at: string; student_full_name: string; amount: number | null; method: string | null; hours: number; subject: string | null }
  | { kind: 'travel'; id: string; created_at: string; student_full_name: string; amount: number; method: string; withTopUp: boolean };

/** One newest-first list of money in: hours packages and travel payments. */
export function mergeCashRows(
  topUps: Pick<TopUpRow, 'id' | 'created_at' | 'student_full_name' | 'amount_paid' | 'payment_method' | 'hours_delta' | 'subject_name'>[],
  travel: Pick<TravelSettlementRow, 'id' | 'created_at' | 'student_full_name' | 'amount' | 'payment_method' | 'package_id'>[]
): CashRow[] {
  const rows: CashRow[] = [
    ...topUps.map(t => ({
      kind: 'package' as const, id: t.id, created_at: t.created_at, student_full_name: t.student_full_name,
      amount: t.amount_paid, method: t.payment_method, hours: t.hours_delta, subject: t.subject_name,
    })),
    ...travel.map(t => ({
      kind: 'travel' as const, id: t.id, created_at: t.created_at, student_full_name: t.student_full_name,
      amount: t.amount, method: t.payment_method, withTopUp: !!t.package_id,
    })),
  ];
  return rows.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

/** "Packages R 5 500.00 · Travel R 360.00"; null when no travel came in. */
export function cashSplitLabel(totalCash: number, travelCash: number): string | null {
  if (!(travelCash > 0)) return null;
  return `Packages ${formatRand(totalCash - travelCash)} · Travel ${formatRand(travelCash)}`;
}

/** "Travel owed by 2 families" */
export function travelOwedLabel(families: number): string {
  return `Travel owed by ${families} ${pluralize(families, 'family', 'families')}`;
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
