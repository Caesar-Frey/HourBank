/**
 * format.ts — deterministic display formatters.
 *
 * Nothing here uses toLocaleString / Intl: Hermes ships with varying ICU data
 * per platform/build, which previously produced four different Rand formats.
 * All date helpers render in the device's LOCAL time zone.
 */

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MINUS = '−';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function groupThousands(whole: number): string {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// ─── Hours ────────────────────────────────────────────────────────────────────

export function formatHours(h: number): string {
  // 1.5 → "1h 30m", 0.5 → "30m", 7 → "7h", 0.083 → "5m"
  const totalMinutes = Math.round(Math.abs(h) * 60);
  if (totalMinutes === 0) return '0m';
  if (h < 0) return `-${formatHours(-h)}`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

/** "+1h 30m" / "−30m" / "0m" — for ledger deltas and adjustments. */
export function formatHoursSigned(h: number): string {
  const totalMinutes = Math.round(Math.abs(h) * 60);
  if (totalMinutes === 0) return '0m';
  return `${h < 0 ? MINUS : '+'}${formatHours(Math.abs(h))}`;
}

/** 90 → "1h 30m", 45 → "45m". */
export function formatMinutes(minutes: number): string {
  return formatHours(minutes / 60);
}

// ─── Money ────────────────────────────────────────────────────────────────────

/** 5500 → "R 5 500.00" (space thousands, dot decimal); −250 → "−R 250.00". */
export function formatRand(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const cents = Math.round((Math.abs(n) + Number.EPSILON) * 100);
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  const sign = n < 0 && cents > 0 ? MINUS : '';
  return `${sign}R ${groupThousands(whole)}.${pad2(frac)}`;
}

/** Compact whole-rand variant for badges: 5500 → "R 5 500". */
export function formatRandCompact(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const whole = Math.round(Math.abs(n));
  const sign = n < 0 && whole > 0 ? MINUS : '';
  return `${sign}R ${groupThousands(whole)}`;
}

/**
 * Lenient decimal parser for SA keyboards. Returns null when unparseable.
 *   "1,5" / "1.5" → 1.5     "4,500" / "4 500" → 4500 (comma + exactly 3 digits = thousands)
 *   "4,500.50" / "4.500,50" / "4 500,50" → 4500.5     "R 5 500" → 5500
 */
export function parseDecimal(input: string): number | null {
  let s = (input ?? '').trim();
  let negative = false;
  if (s.startsWith('-') || s.startsWith(MINUS)) {
    negative = true;
    s = s.slice(1).trim();
  }
  s = s.replace(/^R\s*/i, '');
  s = s.replace(/[\s  ]/g, '');
  if (!/^[0-9.,]+$/.test(s) || !/\d/.test(s)) return null;

  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;
  let normalized: string;

  if (commas > 0 && dots > 0) {
    const decimalSep = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const thousandsSep = decimalSep === ',' ? '.' : ',';
    const parts = s.split(decimalSep);
    if (parts.length !== 2) return null;
    const [intPart, fracPart] = parts;
    const groupRe = new RegExp(`^\\d{1,3}(\\${thousandsSep}\\d{3})*$`);
    if (!groupRe.test(intPart) || !/^\d*$/.test(fracPart)) return null;
    normalized = `${intPart.split(thousandsSep).join('')}.${fracPart}`;
  } else if (commas > 0) {
    if (commas === 1) {
      const [intPart, fracPart] = s.split(',');
      const isThousands = fracPart.length === 3 && intPart.length > 0 && !/^0+$/.test(intPart);
      normalized = isThousands ? intPart + fracPart : `${intPart}.${fracPart}`;
    } else {
      if (!/^\d{1,3}(,\d{3})+$/.test(s)) return null;
      normalized = s.replace(/,/g, '');
    }
  } else if (dots > 1) {
    if (!/^\d{1,3}(\.\d{3})+$/.test(s)) return null;
    normalized = s.replace(/\./g, '');
  } else {
    normalized = s;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

// ─── Durations ────────────────────────────────────────────────────────────────

export function formatDuration(totalSeconds: number): string {
  // 4523 → "01:15:23"
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

export function formatBilledDuration(seconds: number): string {
  return formatHours(seconds / 3600);
}

// ─── Dates (local time) ───────────────────────────────────────────────────────

/** "Fri 9 Oct" */
export function formatDayShort(iso: string | Date): string {
  const d = new Date(iso);
  return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
}

/** "Fri 9 Oct 2026" */
export function formatDateLong(iso: string | Date): string {
  const d = new Date(iso);
  return `${formatDayShort(d)} ${d.getFullYear()}`;
}

/** "09:30" (24h) */
export function formatTime(iso: string | Date): string {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "09:30–10:45" */
export function formatTimeRange(startIso: string | Date, endIso: string | Date): string {
  return `${formatTime(startIso)}–${formatTime(endIso)}`;
}

export function formatLedgerDate(isoDate: string): { day: string; month: string } {
  const d = new Date(isoDate);
  return { day: pad2(d.getDate()), month: MON[d.getMonth()].toUpperCase() };
}

export function formatScheduledTime(isoDate: string): string {
  // "Fri 9 Oct · 15:00"
  return `${formatDayShort(isoDate)} · ${formatTime(isoDate)}`;
}

/**
 * Claim periods are stored half-open: [local midnight start, local midnight
 * AFTER the last included day). This returns the last included day.
 */
export function inclusivePeriodEnd(endExclusiveIso: string): Date {
  return new Date(new Date(endExclusiveIso).getTime() - 1);
}

/** "1 Sep – 30 Sep 2026", "9 Oct 2026", "15 Dec 2025 – 14 Jan 2026", or "All lessons". */
export function formatClaimPeriod(start: string | null | undefined, endExclusive: string | null | undefined): string {
  if (!start || !endExclusive) return 'All lessons';
  const s = new Date(start);
  const e = inclusivePeriodEnd(endExclusive);
  const dm = (d: Date) => `${d.getDate()} ${MON[d.getMonth()]}`;
  const sameDay =
    s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth() && s.getDate() === e.getDate();
  if (sameDay || e < s) return `${dm(s)} ${s.getFullYear()}`;
  if (s.getFullYear() === e.getFullYear()) return `${dm(s)} – ${dm(e)} ${e.getFullYear()}`;
  return `${dm(s)} ${s.getFullYear()} – ${dm(e)} ${e.getFullYear()}`;
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

export function formatHoursDisplay(h: number): { integer: string; decimal: string } {
  // For the balance hero display: 7.5 → { integer: '7', decimal: '.5' }
  const fixed = h.toFixed(1);
  const [int, dec] = fixed.split('.');
  return { integer: int, decimal: `.${dec}` };
}

export function pluralize(count: number, singular: string, plural?: string): string {
  // 1 → "lesson", 2 → "lessons"
  return count === 1 ? singular : (plural ?? `${singular}s`);
}
