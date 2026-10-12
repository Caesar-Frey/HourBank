/**
 * notifications.ts — legacy notification entry points.
 *
 * No automatic sending happens here: these build the plain-text message and
 * return it. Sending is always tutor-initiated via `openWhatsApp` (whatsapp.ts)
 * from an explicit "Send via WhatsApp" action.
 */
import {
  buildLessonReceiptText,
  buildLowBalanceReminderText,
  buildTopUpText,
} from './parentMessages';

export async function sendReceipt(payload: {
  studentName: string;
  durationMinutes: number;
  topics: string[];
  notes: string;
  balanceAfter: number;
  startedAt?: string;
  endedAt?: string | null;
  tutorName?: string | null;
  parentName?: string | null;
  subjectName?: string | null;
  travelCharge?: number | null;
  travelKm?: number | null;
}): Promise<string> {
  return buildLessonReceiptText({
    subjectName: payload.subjectName,
    travelCharge: payload.travelCharge,
    travelKm: payload.travelKm,
    tutorName: payload.tutorName,
    studentName: payload.studentName,
    parentName: payload.parentName,
    startedAt: payload.startedAt ?? new Date().toISOString(),
    endedAt: payload.endedAt,
    billedMinutes: payload.durationMinutes,
    topics: payload.topics,
    notes: payload.notes,
    balanceAfter: payload.balanceAfter,
  });
}

export async function sendTopUpConfirmation(payload: {
  studentName: string;
  hoursAdded: number;
  amountPaid: number;
  newBalance: number;
  tutorName?: string | null;
  parentName?: string | null;
  paidAt?: string | null;
  subjectName?: string | null;
  travelSettled?: number | null;
  travelStillOwed?: number | null;
}): Promise<string> {
  return buildTopUpText(payload);
}

export async function sendLowBalanceAlert(payload: {
  studentName: string;
  currentBalance: number;
  tutorName?: string | null;
  parentName?: string | null;
  paymentDetails?: string | null;
  paymentReference?: string | null;
  subjectBalances?: Array<{ subject: string; balanceHours: number }> | null;
  travelOwed?: { amount: number; lessonCount: number } | null;
}): Promise<string> {
  return buildLowBalanceReminderText({
    tutorName: payload.tutorName,
    studentName: payload.studentName,
    parentName: payload.parentName,
    balanceHours: payload.currentBalance,
    paymentDetails: payload.paymentDetails,
    paymentReference: payload.paymentReference,
    subjectBalances: payload.subjectBalances,
    travelOwed: payload.travelOwed,
  });
}
