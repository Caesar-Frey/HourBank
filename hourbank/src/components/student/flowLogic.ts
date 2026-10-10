/**
 * flowLogic.ts — pure helpers for the student & money screens (WS-5).
 * No React, no DB: everything here is unit-tested in __tests__/flowLogic.test.ts.
 */
import { formatHours, formatHoursSigned, formatRand, parseDecimal } from '../../utils/format';
import { normaliseSaPhone } from '../../utils/whatsapp';

const MINUS = '−';
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ─── Balances ────────────────────────────────────────────────────────────────

/** Balance for review lines: "3h", "1h 30m", "0m", "−30m" (owing). */
export function formatBalance(h: number): string {
  if (Math.round(h * 60) < 0) return `${MINUS}${formatHours(-h)}`;
  return formatHours(Math.abs(h));
}

/** "Balance 3h → 1h 30m" */
export function balanceReviewLine(before: number, after: number): string {
  return `Balance ${formatBalance(before)} → ${formatBalance(after)}`;
}

/** A top-up reminder is worth sending when under 1h remains (incl. owing). */
export function shouldOfferTopUpReminder(balance: number): boolean {
  return Math.round(balance * 60) < 60;
}

/** Upcoming-row warning, e.g. "will owe 1h 30m"; null while still in credit. */
export function upcomingOweWarning(projectedBalanceAfter: number): string | null {
  if (Math.round(projectedBalanceAfter * 60) >= 0) return null;
  return `will owe ${formatHours(-projectedBalanceAfter)}`;
}

// ─── Adjustments ─────────────────────────────────────────────────────────────

export type AdjustDirection = 'add' | 'remove';

export type AdjustmentPreview = {
  /** Signed hours to append, or null while the input is invalid/empty. */
  hoursDelta: number | null;
  /** "+1h 30m" / "−1h 30m" (empty when invalid). */
  deltaLabel: string;
  /** "Balance 3h → 1h 30m" (empty when invalid). */
  reviewLine: string;
  balanceAfter: number | null;
  error: string | null;
};

export const MAX_ADJUSTMENT_HOURS = 200;

export function adjustmentPreview(direction: AdjustDirection, amountInput: string, balance: number): AdjustmentPreview {
  const empty = { hoursDelta: null, deltaLabel: '', reviewLine: '', balanceAfter: null };
  if (amountInput.trim() === '') return { ...empty, error: null };
  const parsed = parseDecimal(amountInput);
  if (parsed === null || parsed < 0) return { ...empty, error: 'Enter hours as a number, e.g. 1,5' };
  // Ledger works in minutes at display time; ignore sub-minute noise.
  const minutes = Math.round(parsed * 60);
  if (minutes <= 0) return { ...empty, error: 'Amount must be more than zero' };
  if (parsed > MAX_ADJUSTMENT_HOURS) return { ...empty, error: `That's more than ${MAX_ADJUSTMENT_HOURS}h — check the amount` };
  const magnitude = minutes / 60;
  const hoursDelta = direction === 'add' ? magnitude : -magnitude;
  const balanceAfter = balance + hoursDelta;
  return {
    hoursDelta,
    deltaLabel: formatHoursSigned(hoursDelta),
    reviewLine: balanceReviewLine(balance, balanceAfter),
    balanceAfter,
    error: null,
  };
}

// ─── Top-up ──────────────────────────────────────────────────────────────────

/** Rands saved vs paying `parentHourlyPrice` per hour; null when no saving. */
export function tierSavings(hours: number, price: number, parentHourlyPrice: number | null | undefined): number | null {
  if (!parentHourlyPrice || parentHourlyPrice <= 0 || hours <= 0 || price < 0) return null;
  const saving = Math.round(parentHourlyPrice * hours - price);
  return saving > 0 ? saving : null;
}

/** CTA label: "Add 10h · R 5 500.00", or a prompt while nothing valid is chosen. */
export function topUpCtaLabel(hours: number | null, price: number | null, hasSelection: boolean): string {
  if (!hasSelection) return 'Choose a package';
  if (hours === null || hours <= 0) return 'Enter hours';
  if (price === null || price < 0) return `Add ${formatHours(hours)} · enter amount`;
  return `Add ${formatHours(hours)} · ${formatRand(price)}`;
}

/** Live preview under a decimal input: "= 8h 30m" / "= R 4 500.00" / error. */
export function decimalPreview(input: string, kind: 'hours' | 'rand'): { value: number | null; text: string; error: boolean } {
  if (input.trim() === '') return { value: null, text: '', error: false };
  const v = parseDecimal(input);
  if (v === null || v < 0) return { value: null, text: kind === 'hours' ? 'Not a valid number of hours' : 'Not a valid amount', error: true };
  if (kind === 'hours') {
    if (Math.round(v * 60) <= 0) return { value: null, text: 'Must be more than zero', error: true };
    return { value: v, text: `= ${formatHours(v)}`, error: false };
  }
  return { value: v, text: `= ${formatRand(v)}`, error: false };
}

export type TierLike = { hours: number; price: number };

/**
 * Package to suggest in a low-balance reminder: the smallest tier that clears
 * what is owed (so the student ends in credit); else the largest tier.
 */
export function suggestTopUpPackage<T extends TierLike>(tiers: T[], balance: number): T | null {
  const valid = tiers.filter(t => t.hours > 0 && t.price >= 0).sort((a, b) => a.hours - b.hours);
  if (valid.length === 0) return null;
  const owed = balance < 0 ? -balance : 0;
  return valid.find(t => t.hours > owed) ?? valid[valid.length - 1];
}

// ─── Scheduling ──────────────────────────────────────────────────────────────

export type ScheduleValidation = { ok: true } | { ok: false; reason: 'past'; message: string };

export function validateScheduleStart(start: Date, now: Date = new Date()): ScheduleValidation {
  if (start.getTime() <= now.getTime()) {
    return { ok: false, reason: 'past', message: 'That time has already passed.' };
  }
  return { ok: true };
}

/**
 * Balance after this booking, counting every other lesson already booked.
 * `booked` = the student's upcoming scheduled lessons (minutes); the lesson
 * being rescheduled is excluded by id.
 */
export function projectedBalanceWithBookings(
  balance: number,
  booked: Array<{ id: string; estimated_duration_minutes: number | null }>,
  newLessonMinutes: number,
  excludeSessionId?: string,
  defaultMinutes = 60,
): { otherBookedHours: number; projected: number } {
  const otherBookedMinutes = booked
    .filter(s => s.id !== excludeSessionId)
    .reduce((sum, s) => sum + (s.estimated_duration_minutes ?? defaultMinutes), 0);
  const otherBookedHours = otherBookedMinutes / 60;
  const projected = balance - otherBookedHours - newLessonMinutes / 60;
  return { otherBookedHours, projected: Math.round(projected * 1e6) / 1e6 };
}

/** Human summary of a conflict check result (null = no conflicts). */
export function conflictSummary(result: {
  sessions: Array<{ studentName: string }>;
  calendarItems: Array<{ title: string; kind: 'event' | 'time_block' }>;
}): string | null {
  const parts = [
    ...result.sessions.map(s => `${s.studentName} (lesson)`),
    ...result.calendarItems.map(c => (c.kind === 'time_block' ? `${c.title || 'Time block'} (blocked)` : c.title)),
  ];
  return parts.length > 0 ? `Clashes with ${parts.join(', ')}` : null;
}

/** Copy `date`'s Y/M/D onto `base` (keeps base's time). */
export function withDate(base: Date, date: Date): Date {
  const d = new Date(base);
  d.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  return d;
}

/** Copy `time`'s H:M onto `base` (seconds zeroed). */
export function withTime(base: Date, time: Date): Date {
  const d = new Date(base);
  d.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return d;
}

// ─── Log past lesson ─────────────────────────────────────────────────────────

/** Default start for a quick-log: now floored to 15 min, minus the lesson length. */
export function defaultPastStart(now: Date, minutes: number): Date {
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15);
  return new Date(d.getTime() - minutes * 60_000);
}

export function validatePastStart(start: Date, now: Date = new Date()): string | null {
  if (Number.isNaN(start.getTime())) return 'Pick a valid date and time.';
  if (start.getTime() > now.getTime()) return 'A past lesson must start before now.';
  return null;
}

export const STEP_MINUTES = 15;
export const MIN_LESSON_MINUTES = 15;
export const MAX_LESSON_MINUTES = 480;

export function stepMinutes(current: number, dir: 1 | -1, step = STEP_MINUTES): number {
  const next = current + dir * step;
  return Math.min(MAX_LESSON_MINUTES, Math.max(MIN_LESSON_MINUTES, next));
}

// ─── Phone ───────────────────────────────────────────────────────────────────

/** "27821234567" → "+27 82 123 4567"; other countries "+<digits>". */
export function formatPhoneDisplay(normalised: string): string {
  if (/^27\d{9}$/.test(normalised)) {
    return `+27 ${normalised.slice(2, 4)} ${normalised.slice(4, 7)} ${normalised.slice(7)}`;
  }
  return `+${normalised}`;
}

export type PhoneFieldState = {
  /** Value to store ("+27821234567"), null when empty. */
  stored: string | null;
  /** "Saved as +27 82 123 4567" preview, or null. */
  preview: string | null;
  error: string | null;
};

export function phoneFieldState(raw: string): PhoneFieldState {
  if (raw.trim() === '') return { stored: null, preview: null, error: null };
  const n = normaliseSaPhone(raw);
  if (!n) return { stored: null, preview: null, error: 'Enter a mobile number like 082 123 4567' };
  return { stored: `+${n}`, preview: `WhatsApp: ${formatPhoneDisplay(n)}`, error: null };
}

/** tel: URI for a stored/typed phone (null when unusable). */
export function telUri(phone: string | null | undefined): string | null {
  const n = normaliseSaPhone(phone);
  return n ? `tel:+${n}` : null;
}

// ─── Student form ────────────────────────────────────────────────────────────

export type StudentFormValues = {
  fullName: string;
  grade: number | null;
  subject: string;
  curriculum: string;
  parentName: string;
  parentPhone: string;
  travelFlatFee: string;
  travelDistanceKm: string;
};

export type StudentFormErrors = Partial<Record<'fullName' | 'grade' | 'subject' | 'parentPhone' | 'travel', string>>;

export function validateStudentForm(v: StudentFormValues, travelMode: 'flat' | 'distance'): StudentFormErrors {
  const e: StudentFormErrors = {};
  if (!v.fullName.trim()) e.fullName = "Enter the student's full name.";
  if (v.grade === null) e.grade = 'Pick a grade.';
  if (!v.subject.trim()) e.subject = 'Enter a subject.';
  const phone = phoneFieldState(v.parentPhone);
  if (phone.error) e.parentPhone = phone.error;
  const travelRaw = travelMode === 'flat' ? v.travelFlatFee : v.travelDistanceKm;
  if (travelRaw.trim() !== '') {
    const t = parseDecimal(travelRaw);
    if (t === null || t < 0) e.travel = travelMode === 'flat' ? 'Enter an amount, e.g. 50' : 'Enter a distance, e.g. 12,5';
  }
  return e;
}

export function hasErrors(e: StudentFormErrors): boolean {
  return Object.values(e).some(Boolean);
}

/** Field-by-field dirty check (trim-insensitive for text). */
export function isStudentFormDirty(initial: StudentFormValues, current: StudentFormValues): boolean {
  const keys = Object.keys(initial) as Array<keyof StudentFormValues>;
  return keys.some(k => {
    const a = initial[k];
    const b = current[k];
    if (typeof a === 'string' && typeof b === 'string') return a.trim() !== b.trim();
    return a !== b;
  });
}

// ─── Archive / pause copy ────────────────────────────────────────────────────

export function archiveConfirmMessage(name: string, balance: number, scheduledLessons: number): string {
  const lines = [`${name} will be hidden from your roster. Their ledger history is kept and you can restore them later.`];
  const mins = Math.round(balance * 60);
  if (mins > 0) lines.push(`They still have ${formatHours(balance)} of prepaid credit.`);
  else if (mins < 0) lines.push(`They still owe ${formatHours(-balance)}.`);
  if (scheduledLessons > 0) {
    lines.push(`${scheduledLessons} booked ${scheduledLessons === 1 ? 'lesson' : 'lessons'} will be cancelled.`);
  }
  return lines.join('\n\n');
}

export function archivedToastMessage(cancelledLessons: number): string {
  if (cancelledLessons <= 0) return 'Archived';
  return `Archived · ${cancelledLessons} ${cancelledLessons === 1 ? 'lesson' : 'lessons'} cancelled`;
}

export function pauseConfirmMessage(name: string, scheduledLessons: number): string {
  const base = `${name} will move to Paused and drop off your active roster.`;
  if (scheduledLessons <= 0) return base;
  return `${base}\n\nThey have ${scheduledLessons} booked ${scheduledLessons === 1 ? 'lesson' : 'lessons'}. ` +
    'Pausing keeps them booked — cancel any you no longer need from the lesson screen.';
}

// ─── Ledger ──────────────────────────────────────────────────────────────────

export type LedgerLike = {
  id: string;
  type: 'top_up' | 'session_deduction' | 'adjustment' | 'refund';
  hours_delta: number;
  created_at: string;
  reason: string | null;
};

export function ledgerDescription(entry: LedgerLike, sessionTopics?: string | null): string {
  switch (entry.type) {
    case 'top_up':
      return `Top-up — ${formatHours(Math.abs(entry.hours_delta))} added`;
    case 'session_deduction': {
      let first: string | undefined;
      try {
        const topics = sessionTopics ? (JSON.parse(sessionTopics) as unknown) : [];
        if (Array.isArray(topics) && typeof topics[0] === 'string') first = topics[0];
      } catch { /* malformed topics — fall through */ }
      const base = entry.reason === 'No-show' ? 'No-show (charged)' : 'Lesson';
      return first ? `${base} — ${first}` : base;
    }
    case 'adjustment':
      return entry.reason?.trim() ? `Correction — ${entry.reason.trim()}` : 'Correction';
    case 'refund':
      return entry.reason?.trim() ? `Refund — ${entry.reason.trim()}` : 'Refund';
    default:
      return 'Entry';
  }
}

export type LedgerMonthGroup<T> = { key: string; title: string; entries: T[] };

/** Group (already newest-first) entries by local calendar month. */
export function groupLedgerByMonth<T extends { created_at: string }>(entries: T[]): LedgerMonthGroup<T>[] {
  const groups: LedgerMonthGroup<T>[] = [];
  const byKey = new Map<string, LedgerMonthGroup<T>>();
  for (const e of entries) {
    const d = new Date(e.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let g = byKey.get(key);
    if (!g) {
      g = { key, title: `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`, entries: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.entries.push(e);
  }
  return groups;
}

/** Net hours for a group, e.g. for a month header. */
export function sumHours(entries: Array<{ hours_delta: number }>): number {
  return entries.reduce((s, e) => s + e.hours_delta, 0);
}

/** Short human reference for an id, e.g. hash + first 8 hex chars uppercased. */
export function shortRef(id: string): string {
  return `#${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/** Ledger route for a row (null = not tappable). */
export function ledgerRowHref(entry: { id: string; type: LedgerLike['type']; related_session_id: string | null }): string | null {
  if (entry.related_session_id) return `/lesson/${entry.related_session_id}`;
  return `/transaction/${entry.id}`;
}
