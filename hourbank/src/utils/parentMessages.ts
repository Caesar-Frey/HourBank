/**
 * parentMessages.ts — plain-text messages for parents or students (WhatsApp /
 * share sheet). Pure functions: take plain values, never read the DB.
 *
 * `recipientName` + `audience` decide greeting and wording ("Amahle's balance"
 * for a parent vs "your balance" for the student). `parentName` is the legacy
 * name for `recipientName` and is still honoured.
 */
import { formatDateLong, formatHours, formatMinutes, formatRand, formatTime } from './format';
import { kmLabel, travelOwedMessageLine } from './travelBilling';

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
  /** Lesson subject (shown when given). balanceAfter is then that subject's balance. */
  subjectName?: string | null;
  /** Parent travel charged for this lesson (rand); omitted/0 = none. */
  travelCharge?: number | null;
  travelKm?: number | null;
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
  ];
  const subject = i.subjectName?.trim();
  if (subject) lines.push(`Subject: ${subject}`);
  lines.push(`Billed: ${formatMinutes(i.billedMinutes)}`);
  const topics = (i.topics ?? []).map(t => t.trim()).filter(Boolean);
  if (topics.length > 0) lines.push(`Topics: ${topics.join(', ')}`);
  const notes = i.notes?.trim();
  if (notes) lines.push(`Notes: ${notes}`);
  if (i.travelCharge && i.travelCharge > 0) {
    const km = kmLabel('in_person', i.travelKm);
    lines.push(`Travel: ${formatRand(i.travelCharge)}${km ? ` (${km})` : ''}`);
  }
  const balLabel = subject
    ? (student ? `Your ${subject} balance remaining` : `${subject} balance remaining`)
    : (student ? 'Your balance remaining' : 'Balance remaining');
  lines.push(
    balanceLine(i.balanceAfter, balLabel),
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
  /** Subject the hours were added to; newBalance is then that subject's balance. */
  subjectName?: string | null;
  /** Travel settled in the same payment (rand). */
  travelSettled?: number | null;
  /** Travel still owed after this payment (rand). */
  travelStillOwed?: number | null;
};

export function buildTopUpText(i: TopUpTextInput): string {
  const student = isStudent(i);
  const forWhom = student ? 'your lessons' : i.studentName;
  const lines = [
    greeting(i),
    '',
    `Payment received for ${forWhom}${i.paidAt ? ` on ${formatDateLong(i.paidAt)}` : ''}.`,
  ];
  const subject = i.subjectName?.trim();
  const travel = i.travelSettled && i.travelSettled > 0 ? i.travelSettled : 0;
  lines.push(`Hours added: ${formatHours(i.hoursAdded)}${subject ? ` ${subject}` : ''}`);
  if (travel > 0) {
    lines.push(
      `Lessons: ${formatRand(i.amountPaid)}`,
      `Travel settled: ${formatRand(travel)}`,
      `Total received: ${formatRand(i.amountPaid + travel)}`
    );
  } else {
    lines.push(`Amount: ${formatRand(i.amountPaid)}`);
  }
  const balLabel = subject
    ? (student ? `Your ${subject} balance` : `${subject} balance`)
    : (student ? 'Your new balance' : 'New balance');
  lines.push(balanceLine(i.newBalance, balLabel));
  if (i.travelStillOwed && i.travelStillOwed > 0) lines.push(`Travel still owed: ${formatRand(i.travelStillOwed)}`);
  lines.push('', signOff(i.tutorName));
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
  /**
   * Per-subject balances. With 2+ subjects each is listed; with exactly one its
   * name is used in the wording. balanceHours stays the headline total.
   */
  subjectBalances?: Array<{ subject: string; balanceHours: number }> | null;
  /** Subject that balanceHours belongs to (single-subject wording); ignored when subjectBalances is given. */
  subjectName?: string | null;
  /** Parent travel owed (rand, in arrears). Shown when > 0. */
  travelOwed?: { amount: number; lessonCount: number } | null;
};

function subjectBalanceLine(subject: string, h: number): string {
  return Math.round(h * 60) < 0 ? `${subject}: owing ${formatHours(-h)}` : `${subject}: ${formatHours(h)} remaining`;
}



export function buildLowBalanceReminderText(i: LowBalanceReminderTextInput): string {
  const whose = isStudent(i) ? 'your' : `${i.studentName}'s`;
  const listed = (i.subjectBalances ?? []).filter(s => s.subject?.trim());
  const subjects = listed.length > 0
    ? listed
    : i.subjectName?.trim()
      ? [{ subject: i.subjectName, balanceHours: i.balanceHours }]
      : [];
  let lines: string[];
  if (subjects.length > 1) {
    lines = [
      greeting(i),
      '',
      `A quick reminder — ${whose} lesson balances:`,
      ...subjects.map(s => subjectBalanceLine(s.subject.trim(), s.balanceHours)),
    ];
  } else {
    const one = subjects[0];
    const hours = one ? one.balanceHours : i.balanceHours;
    const what = one ? `${one.subject.trim()} ` : '';
    const owing = Math.round(hours * 60) < 0;
    const status = owing
      ? `${whose} ${what}lesson account is owing ${formatHours(-hours)}.`
      : `${whose} ${what}lesson balance is low: ${formatHours(hours)} remaining.`;
    lines = [greeting(i), '', `A quick reminder — ${status}`];
  }
  const travelLine = travelOwedMessageLine(i.travelOwed?.amount, i.travelOwed?.lessonCount);
  if (travelLine) lines.push(travelLine);
  if (i.suggestedPackage) {
    lines.push(
      `To top up: ${formatHours(i.suggestedPackage.hours)} for ${formatRand(i.suggestedPackage.price)}.`
    );
    if (travelLine && i.travelOwed) {
      lines.push(`Total with travel: ${formatRand(i.suggestedPackage.price + i.travelOwed.amount)}.`);
    }
  }
  const details = i.paymentDetails?.trim();
  // The reference always goes out, so a payment can be matched even when the
  // tutor has not saved bank details yet.
  const reference = i.paymentReference?.trim() || i.studentName;
  if (details) lines.push('', 'Payment details:', details, `Reference: ${reference}`);
  else lines.push('', `Reference: ${reference}`);
  lines.push('', signOff(i.tutorName));
  return lines.join('\n');
}

export type TravelPaymentTextInput = RecipientFields & {
  tutorName?: string | null;
  studentName: string;
  amount: number;
  paidAt?: string | null;
  /** Travel still owed after this payment (rand). */
  stillOwed?: number | null;
};

/** Confirmation for a travel payment (standalone or recorded on its own). */
export function buildTravelPaymentText(i: TravelPaymentTextInput): string {
  const forWhom = isStudent(i) ? 'your lessons' : i.studentName;
  const lines = [
    greeting(i),
    '',
    `Travel payment received for ${forWhom}${i.paidAt ? ` on ${formatDateLong(i.paidAt)}` : ''}.`,
    `Amount: ${formatRand(i.amount)}`,
    i.stillOwed && i.stillOwed > 0 ? `Travel still owed: ${formatRand(i.stillOwed)}` : 'Travel is fully paid up.',
    '',
    signOff(i.tutorName),
  ];
  return lines.join('\n');
}
