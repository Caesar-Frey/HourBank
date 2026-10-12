/**
 * travelBilling.ts — pure helpers for PARENT travel billing screens and
 * messages (travel owed card, travel screen, top-up with travel, reminders).
 * No React, no DB.
 */
import { formatHours, formatRand, parseDecimal, pluralize } from './format';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** "2 Oct" (local date). */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MON[d.getMonth()]}`;
}

/** "3 in-person lessons" */
export function inPersonLessonsLabel(count: number): string {
  return `${count} in-person ${pluralize(count, 'lesson')}`;
}

/** Card line: "R 360.00 · 3 in-person lessons since 2 Oct" (null when nothing owed). */
export function travelOwedSummary(o: { amount: number; lessonCount: number; since: string | null }): string | null {
  if (!(o.amount > 0)) return null;
  const parts = [formatRand(o.amount)];
  if (o.lessonCount > 0) {
    parts.push(`${inPersonLessonsLabel(o.lessonCount)}${o.since ? ` since ${shortDate(o.since)}` : ''}`);
  }
  return parts.join(' · ');
}

/** Message line: "Travel owed: R 360.00 (3 in-person lessons)" — null when nothing owed. */
export function travelOwedMessageLine(amount: number | null | undefined, lessonCount: number | null | undefined): string | null {
  if (!amount || !(amount > 0)) return null;
  const n = lessonCount ?? 0;
  return n > 0 ? `Travel owed: ${formatRand(amount)} (${inPersonLessonsLabel(n)})` : `Travel owed: ${formatRand(amount)}`;
}

// ─── Settlement validation ───────────────────────────────────────────────────

export type TravelPaymentCheck = { value: number | null; error: string | null };

/** Validate a typed travel payment: > 0, ≤ owed (partial allowed). */
export function validateTravelPayment(input: string, owed: number): TravelPaymentCheck {
  if (input.trim() === '') return { value: null, error: null };
  const v = parseDecimal(input);
  if (v === null || v < 0) return { value: null, error: 'Not a valid amount' };
  const amount = round2(v);
  if (amount <= 0) return { value: null, error: 'Amount must be more than zero' };
  if (amount > round2(owed) + 0.001) return { value: null, error: `Only ${formatRand(owed)} travel is owed` };
  return { value: amount, error: null };
}

/** Prefill text for the travel payment field ("360" / "360.50"). */
export function travelAmountInput(owed: number): string {
  const r = round2(Math.max(0, owed));
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

// ─── Top-up with travel ──────────────────────────────────────────────────────

/** Travel to settle with this top-up (0 when toggled off / nothing owed). */
export function topUpTravelAmount(owed: number, include: boolean): number {
  return include && owed > 0 ? round2(owed) : 0;
}

/** Cash expected for the whole payment (package price + travel). */
export function topUpGrandTotal(price: number | null, travel: number): number | null {
  if (price === null || price < 0) return null;
  return round2(price + Math.max(0, travel));
}

/**
 * CTA: "Add 10h Maths · R 5 500.00 + travel R 360.00". Subject name is shown
 * only when the student has more than one subject (pass null otherwise).
 */
export function topUpCtaWithTravel(args: {
  hours: number | null;
  price: number | null;
  hasSelection: boolean;
  subjectName?: string | null;
  travel?: number;
}): string {
  if (!args.hasSelection) return 'Choose a package';
  if (args.hours === null || args.hours <= 0) return 'Enter hours';
  const what = `${formatHours(args.hours)}${args.subjectName ? ` ${args.subjectName}` : ''}`;
  if (args.price === null || args.price < 0) return `Add ${what} · enter amount`;
  const travel = args.travel && args.travel > 0 ? ` + travel ${formatRand(args.travel)}` : '';
  return `Add ${what} · ${formatRand(args.price)}${travel}`;
}

/** Travel toggle copy on the top-up screen: "Travel owed R 360.00 (3 lessons)". */
export function topUpTravelToggleLabel(amount: number, lessonCount: number): string {
  return `Travel owed ${formatRand(amount)} (${lessonCount} ${pluralize(lessonCount, 'lesson')})`;
}

/** Success toast after a top-up. */
export function topUpSuccessMessage(args: {
  hours: number;
  subjectName?: string | null;
  balanceLabel: string;
  travelSettled?: number;
  travelFailed?: boolean;
}): string {
  const subj = args.subjectName ? ` ${args.subjectName}` : '';
  let msg = `Added ${formatHours(args.hours)}${subj} · balance ${args.balanceLabel}`;
  if (args.travelSettled && args.travelSettled > 0) msg += ` · travel ${formatRand(args.travelSettled)} settled`;
  if (args.travelFailed) msg += " · travel payment wasn't recorded — record it on the travel screen";
  return msg;
}

// ─── Per-subject money table ─────────────────────────────────────────────────

export type SubjectTotalsRow = { subject: string; students: number; sessions: number; hours: number };

/** Collapse per-student-subject rows into one row per subject name (case-insensitive), hours desc. */
export function aggregateBySubject(
  rows: Array<{ studentId: string; subject: string; sessions: number; hours: number }>
): SubjectTotalsRow[] {
  const map = new Map<string, { subject: string; students: Set<string>; sessions: number; hours: number }>();
  for (const r of rows) {
    const name = r.subject?.trim() || 'Other';
    const key = name.toLowerCase();
    let g = map.get(key);
    if (!g) {
      g = { subject: name, students: new Set(), sessions: 0, hours: 0 };
      map.set(key, g);
    }
    g.students.add(r.studentId);
    g.sessions += r.sessions;
    g.hours += r.hours;
  }
  return [...map.values()]
    .map(g => ({ subject: g.subject, students: g.students.size, sessions: g.sessions, hours: Math.round(g.hours * 1e6) / 1e6 }))
    .sort((a, b) => b.hours - a.hours || a.subject.localeCompare(b.subject));
}

/** Claim line km label: "12 km" / "12.5 km"; null for online / unknown / zero. */
export function kmLabel(mode: 'in_person' | 'online', km: number | null | undefined): string | null {
  if (mode !== 'in_person' || km == null || !(km > 0)) return null;
  const r = Math.round(km * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)} km`;
}
