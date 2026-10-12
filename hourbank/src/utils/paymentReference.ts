/**
 * paymentReference.ts — the reference a parent types on an EFT so the tutor can
 * match the payment on their bank statement. Pure; never reads the DB.
 *
 * Template tokens: {first} {surname} {initial} (+ UPPERCASE variants), {month}
 * (e.g. OCT26) and {id} (stable 5-char code derived from the student id).
 */

export const DEFAULT_PAYMENT_REFERENCE_TEMPLATE = '{first} {surname}';

/** Most SA banks cap the beneficiary reference at 20 characters. */
export const PAYMENT_REFERENCE_MAX = 20;

export const PAYMENT_REFERENCE_TOKENS: ReadonlyArray<{ token: string; label: string }> = [
  { token: '{first}', label: 'First name' },
  { token: '{surname}', label: 'Surname' },
  { token: '{initial}', label: 'Initial' },
  { token: '{FIRST}', label: 'FIRST' },
  { token: '{SURNAME}', label: 'SURNAME' },
  { token: '{month}', label: 'Month' },
  { token: '{id}', label: 'Student code' },
];

type RefStudent = { id: string; full_name: string };

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Stable short code from a student id (FNV-1a → base36, 5 chars, uppercase). */
export function shortStudentRef(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % 36 ** 5).toString(36).toUpperCase().padStart(5, '0');
}

function nameParts(fullName: string): { first: string; surname: string } {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  return { first: words[0] ?? '', surname: words.length > 1 ? words[words.length - 1] : '' };
}

/** Keep only characters SA bank reference fields accept: letters, digits, space, hyphen. */
function sanitise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 -]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function render(template: string, student: RefStudent, date: Date): string {
  const { first, surname } = nameParts(student.full_name);
  const initial = first.charAt(0);
  const values: Record<string, string> = {
    first,
    surname,
    initial,
    FIRST: first.toUpperCase(),
    SURNAME: surname.toUpperCase(),
    INITIAL: initial.toUpperCase(),
    month: `${MONTHS[date.getMonth()]}${String(date.getFullYear() % 100).padStart(2, '0')}`,
    id: shortStudentRef(student.id),
  };
  return sanitise(template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? ''));
}

export type PaymentReferencePreview = {
  /** What gets sent (capped at PAYMENT_REFERENCE_MAX). */
  reference: string;
  /** Uncapped render, for showing what was cut off. */
  full: string;
  tooLong: boolean;
};

export function previewPaymentReference(
  template: string | null | undefined,
  student: RefStudent,
  date: Date = new Date()
): PaymentReferencePreview {
  let full = template?.trim() ? render(template, student, date) : '';
  if (!full) full = render(DEFAULT_PAYMENT_REFERENCE_TEMPLATE, student, date);
  return {
    reference: full.slice(0, PAYMENT_REFERENCE_MAX).trim(),
    full,
    tooLong: full.length > PAYMENT_REFERENCE_MAX,
  };
}

/**
 * Insert a token chip into the template at the cursor (replacing any selection),
 * or append when the cursor is unknown. Adds a separating space after a word.
 */
export function insertReferenceToken(
  value: string,
  token: string,
  selection?: { start: number; end: number } | null
): { value: string; cursor: number } {
  const start = selection ? Math.max(0, Math.min(selection.start, value.length)) : value.length;
  const end = selection ? Math.max(start, Math.min(selection.end, value.length)) : value.length;
  const before = value.slice(0, start);
  const insert = before.length > 0 && !/\s$/.test(before) ? ` ${token}` : token;
  return { value: before + insert + value.slice(end), cursor: before.length + insert.length };
}

export function buildPaymentReference(
  template: string | null | undefined,
  student: RefStudent,
  date: Date = new Date()
): string {
  return previewPaymentReference(template, student, date).reference;
}
