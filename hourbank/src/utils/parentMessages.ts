/**
 * parentMessages.ts — plain-text messages for parents or students (WhatsApp /
 * share sheet). Pure functions: take plain values, never read the DB.
 *
 * `recipientName` + `audience` decide greeting and wording ("Amahle's balance"
 * for a parent vs "your balance" for the student). `parentName` is the legacy
 * name for `recipientName` and is still honoured.
 */
import { formatDateLong, formatHours, formatMinutes, formatRand, formatTime } from './format';

export type MessageAudience = 'parent' | 'student';

type RecipientFields = {
  /** Who is greeted ("Hi Thandi,"). Falls back to `parentName`. */
  recipientName?: string | null;
  /** @deprecated use recipientName */
  parentName?: string | null;
  /** Default 'parent'. */
  audience?: MessageAudience;
};

function greeting(i: RecipientFields): string {
  const first = (i.recipientName ?? i.parentName)?.trim().split(/\s+/)[0];
  return first ? `Hi ${first},` : 'Hi,';
}

function isStudent(i: RecipientFields): boolean {
  return i.audience === 'student';
}

function signOff(tutorName?: string | null): string {
  const name = tutorName?.trim();
  return name ? `Thank you,\n${name}` : 'Thank you!';
}

function balanceLine(balance: number, positiveLabel: string): string {
  return Math.round(balance * 60) < 0 ? `Owing: ${formatHours(-balance)}` : `${positiveLabel}: ${formatHours(balance)}`;
}

export type LessonReceiptTextInput = RecipientFields & {
  tutorName?: string | null;
  studentName: string;
  startedAt: string;
  endedAt?: string | null;
  billedMinutes: number;
  topics?: string[];
  notes?: string | null;
  balanceAfter: number;
};

export function buildLessonReceiptText(i: LessonReceiptTextInput): string {
  const student = isStudent(i);
  const when = i.endedAt
    ? `${formatDateLong(i.startedAt)} · ${formatTime(i.startedAt)}–${formatTime(i.endedAt)}`
    : `${formatDateLong(i.startedAt)} · ${formatTime(i.startedAt)}`;
  const lines = [
    greeting(i),
    '',
    student ? 'Your lesson summary' : `Lesson summary for ${i.studentName}`,
    when,
    `Billed: ${formatMinutes(i.billedMinutes)}`,
  ];
  const topics = (i.topics ?? []).map(t => t.trim()).filter(Boolean);
  if (topics.length > 0) lines.push(`Topics: ${topics.join(', ')}`);
  const notes = i.notes?.trim();
  if (notes) lines.push(`Notes: ${notes}`);
  lines.push(
    balanceLine(i.balanceAfter, student ? 'Your balance remaining' : 'Balance remaining'),
    '',
    signOff(i.tutorName)
  );
  return lines.join('\n');
}

export type TopUpTextInput = RecipientFields & {
  tutorName?: string | null;
  studentName: string;
  hoursAdded: number;
  amountPaid: number;
  newBalance: number;
  paidAt?: string | null;
};

export function buildTopUpText(i: TopUpTextInput): string {
  const student = isStudent(i);
  const forWhom = student ? 'your lessons' : i.studentName;
  const lines = [
    greeting(i),
    '',
    `Payment received for ${forWhom}${i.paidAt ? ` on ${formatDateLong(i.paidAt)}` : ''}.`,
    `Hours added: ${formatHours(i.hoursAdded)}`,
    `Amount: ${formatRand(i.amountPaid)}`,
    balanceLine(i.newBalance, student ? 'Your new balance' : 'New balance'),
    '',
    signOff(i.tutorName),
  ];
  return lines.join('\n');
}

export type LowBalanceReminderTextInput = RecipientFields & {
  tutorName?: string | null;
  studentName: string;
  balanceHours: number;
  suggestedPackage?: { hours: number; price: number } | null;
  paymentDetails?: string | null;
  /** EFT reference (see buildPaymentReference). Defaults to the student's name. */
  paymentReference?: string | null;
};

export function buildLowBalanceReminderText(i: LowBalanceReminderTextInput): string {
  const owing = Math.round(i.balanceHours * 60) < 0;
  const whose = isStudent(i) ? 'your' : `${i.studentName}'s`;
  const status = owing
    ? `${whose} lesson account is owing ${formatHours(-i.balanceHours)}.`
    : `${whose} lesson balance is low: ${formatHours(i.balanceHours)} remaining.`;
  const lines = [greeting(i), '', `A quick reminder — ${status}`];
  if (i.suggestedPackage) {
    lines.push(
      `To top up: ${formatHours(i.suggestedPackage.hours)} for ${formatRand(i.suggestedPackage.price)}.`
    );
  }
  const details = i.paymentDetails?.trim();
  if (details) {
    const reference = i.paymentReference?.trim() || i.studentName;
    lines.push('', 'Payment details:', details, `Reference: ${reference}`);
  }
  lines.push('', signOff(i.tutorName));
  return lines.join('\n');
}
