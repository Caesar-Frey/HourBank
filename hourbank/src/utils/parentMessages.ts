/**
 * parentMessages.ts — plain-text messages for parents (WhatsApp / share sheet).
 * Pure functions: take plain values, never read the DB.
 */
import { formatDateLong, formatHours, formatMinutes, formatRand, formatTime } from './format';

function greeting(parentName?: string | null): string {
  const first = parentName?.trim().split(/\s+/)[0];
  return first ? `Hi ${first},` : 'Hi,';
}

function signOff(tutorName?: string | null): string {
  const name = tutorName?.trim();
  return name ? `Thank you,\n${name}` : 'Thank you!';
}

function balanceLine(balance: number, positiveLabel: string): string {
  return Math.round(balance * 60) < 0 ? `Owing: ${formatHours(-balance)}` : `${positiveLabel}: ${formatHours(balance)}`;
}

export type LessonReceiptTextInput = {
  tutorName?: string | null;
  studentName: string;
  parentName?: string | null;
  startedAt: string;
  endedAt?: string | null;
  billedMinutes: number;
  topics?: string[];
  notes?: string | null;
  balanceAfter: number;
};

export function buildLessonReceiptText(i: LessonReceiptTextInput): string {
  const when = i.endedAt
    ? `${formatDateLong(i.startedAt)} · ${formatTime(i.startedAt)}–${formatTime(i.endedAt)}`
    : `${formatDateLong(i.startedAt)} · ${formatTime(i.startedAt)}`;
  const lines = [
    greeting(i.parentName),
    '',
    `Lesson summary for ${i.studentName}`,
    when,
    `Billed: ${formatMinutes(i.billedMinutes)}`,
  ];
  const topics = (i.topics ?? []).map(t => t.trim()).filter(Boolean);
  if (topics.length > 0) lines.push(`Topics: ${topics.join(', ')}`);
  const notes = i.notes?.trim();
  if (notes) lines.push(`Notes: ${notes}`);
  lines.push(balanceLine(i.balanceAfter, 'Balance remaining'), '', signOff(i.tutorName));
  return lines.join('\n');
}

export type TopUpTextInput = {
  tutorName?: string | null;
  studentName: string;
  parentName?: string | null;
  hoursAdded: number;
  amountPaid: number;
  newBalance: number;
  paidAt?: string | null;
};

export function buildTopUpText(i: TopUpTextInput): string {
  const lines = [
    greeting(i.parentName),
    '',
    `Payment received for ${i.studentName}${i.paidAt ? ` on ${formatDateLong(i.paidAt)}` : ''}.`,
    `Hours added: ${formatHours(i.hoursAdded)}`,
    `Amount: ${formatRand(i.amountPaid)}`,
    balanceLine(i.newBalance, 'New balance'),
    '',
    signOff(i.tutorName),
  ];
  return lines.join('\n');
}

export type LowBalanceReminderTextInput = {
  tutorName?: string | null;
  studentName: string;
  parentName?: string | null;
  balanceHours: number;
  suggestedPackage?: { hours: number; price: number } | null;
  paymentDetails?: string | null;
};

export function buildLowBalanceReminderText(i: LowBalanceReminderTextInput): string {
  const owing = Math.round(i.balanceHours * 60) < 0;
  const status = owing
    ? `${i.studentName}'s lesson account is owing ${formatHours(-i.balanceHours)}.`
    : `${i.studentName}'s lesson balance is low: ${formatHours(i.balanceHours)} remaining.`;
  const lines = [greeting(i.parentName), '', `A quick reminder — ${status}`];
  if (i.suggestedPackage) {
    lines.push(
      `To top up: ${formatHours(i.suggestedPackage.hours)} for ${formatRand(i.suggestedPackage.price)}.`
    );
  }
  const details = i.paymentDetails?.trim();
  if (details) {
    lines.push('', 'Payment details:', details, `Reference: ${i.studentName}`);
  }
  lines.push('', signOff(i.tutorName));
  return lines.join('\n');
}
