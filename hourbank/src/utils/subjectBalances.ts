/**
 * Per-subject balance helpers shared by the Home roster and the New lesson picker.
 * Pure (no React, no DB access).
 */
import type { StudentSubjectBalanceSummary } from '../db/students';
import { formatHours } from './format';

/** Minimal shape the subject-balance helpers need (roster row or picker row). */
export type SubjectBalanceSource = {
  subject: string;
  current_balance: number;
  subject_balances?: StudentSubjectBalanceSummary[];
};

/** Subject balances for a roster row; falls back to one row = the total. */
export function rosterSubjectBalances(s: SubjectBalanceSource): StudentSubjectBalanceSummary[] {
  if (s.subject_balances && s.subject_balances.length > 0) return s.subject_balances;
  return [{ subject_id: '', subject: s.subject, balance_hours: s.current_balance }];
}

/** Lowest subject balance — drives the status stripe and "lowest balance" sort. */
export function worstSubjectBalance(s: SubjectBalanceSource): number {
  return Math.min(...rosterSubjectBalances(s).map(b => b.balance_hours));
}

function compactBalance(h: number): string {
  return Math.round(h * 60) < 0 ? `owes ${formatHours(-h)}` : formatHours(h);
}

/** "Maths 3h · Science 45m" — null for single-subject students (card stays as before). */
export function rosterBalanceLine(s: SubjectBalanceSource): string | null {
  const list = rosterSubjectBalances(s);
  if (list.length < 2) return null;
  return list.map(b => `${b.subject} ${compactBalance(b.balance_hours)}`).join(' · ');
}
