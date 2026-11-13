import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { getDb } from '../db/client';
import { newId } from '../db/uuid';
import { formatDateDocument, formatDateLong, formatHours, formatMinutes, formatRandDocument, formatTime } from './format';
import { buildDocumentHtml, businessFooter, type DocumentBrand } from './documentHtml';
import { loadDocumentBrand } from './documentBrand';
import { buildLessonReceiptText, buildLowBalanceReminderText, buildTopUpText, buildTravelPaymentText } from './parentMessages';
import type { MessageAudience } from './parentMessages';
import { getLedgerEntryById, getSessionDeduction, currentBalance } from '../db/ledger';
import { getSubjectBalances, listStudentSubjects } from '../db/subjects';
import { getTravelOwed, getTravelSettlement, listTravelSettlementsForPackage } from '../db/travel';
import { getOrCreateTutorProfile, PackageTier } from '../db/tutorProfile';
import { getStudent } from '../db/students';
import { paymentDetailsForMessages } from '../db/invoices';
import { suggestTopUpPackage } from '../components/student/flowLogic';
import { buildPaymentReference } from './paymentReference';
import { kmLabel } from './travelBilling';

export {
  buildLessonReceiptText,
  buildTopUpText,
  buildLowBalanceReminderText,
  buildTravelPaymentText,
} from './parentMessages';

/** Subject names appear in messages only when the student has 2+ active subjects. */
function isMultiSubject(studentId: string): boolean {
  try {
    return listStudentSubjects(studentId).length > 1;
  } catch {
    return false;
  }
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function receiptFilename(prefix: string, studentName: string, date: Date): string {
  const sanitized = studentName.replace(/[^A-Za-z0-9]+/g, '') || 'Student';
  const d = String(date.getDate()).padStart(2, '0');
  const m = MONTH_ABBR[date.getMonth()];
  const y = date.getFullYear();
  const hm = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
  // -HHmm: two documents for one student on one day no longer overwrite each other (B10).
  return `${prefix}_${sanitized}_${d}${m}${y}-${hm}.pdf`;
}

type ReceiptRow = {
  id: string;
  session_id: string | null;
  package_id: string | null;
  kind: 'session' | 'top_up';
  rendered_path: string | null;
  shared_at: string | null;
  created_at: string;
};

/** Outcome of a share attempt. `shared` = the share sheet completed without error
 * (expo-sharing cannot report a user cancel, so this is best effort). */
export type ShareReceiptResult = { shared: boolean; uri: string | null };

/** One receipts row per session / package: update on re-share, insert first time. */
function upsertReceiptRow(
  kind: 'session' | 'top_up',
  ref: { sessionId?: string; packageId?: string },
  renderedPath: string
): void {
  const db = getDb();
  const now = new Date().toISOString();
  const column = kind === 'session' ? 'session_id' : 'package_id';
  const refId = kind === 'session' ? ref.sessionId! : ref.packageId!;
  const existing = db.getFirstSync<{ id: string }>(
    `SELECT id FROM receipts WHERE kind = ? AND ${column} = ? ORDER BY created_at ASC LIMIT 1`,
    [kind, refId]
  );
  if (existing) {
    db.runSync('UPDATE receipts SET rendered_path = ?, shared_at = ? WHERE id = ?', [renderedPath, now, existing.id]);
  } else {
    db.runSync(
      `INSERT INTO receipts (id, session_id, package_id, kind, rendered_path, shared_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newId(), ref.sessionId ?? null, ref.packageId ?? null, kind, renderedPath, now, now]
    );
  }
}

/** Ledger-derived balance immediately after a given entry (date order, then insert order — as history shows it). */
function balanceThroughEntry(studentId: string, entryId: string | null): number {
  const db = getDb();
  const row = entryId
    ? db.getFirstSync<{ bal: number | null }>(
        `SELECT SUM(l.hours_delta) AS bal FROM ledger_entries l, ledger_entries e
         WHERE e.id = ? AND l.student_id = ?
           AND (l.created_at < e.created_at OR (l.created_at = e.created_at AND l.rowid <= e.rowid))`,
        [entryId, studentId]
      )
    : db.getFirstSync<{ bal: number | null }>(
        'SELECT SUM(hours_delta) AS bal FROM ledger_entries WHERE student_id = ?',
        [studentId]
      );
  return row?.bal ?? 0;
}

function tutorName(): string | null {
  const row = getDb().getFirstSync<{ full_name: string | null }>('SELECT full_name FROM tutor_profile LIMIT 1');
  return row?.full_name?.trim() || null;
}

function parseTopics(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

// ─── Pure HTML builders (shared document frame, F2) ──────────────────────────

function brandOf(d: { brand?: DocumentBrand | null; tutorName?: string | null }): DocumentBrand {
  return { ...(d.brand ?? {}), name: d.brand?.name ?? d.tutorName?.trim() ?? null };
}

function frame(d: { brand?: DocumentBrand | null; tutorName?: string | null }) {
  const b = brandOf(d);
  return { logoDataUri: b.logoDataUri, brandName: b.name, footer: businessFooter(b) };
}

function balanceText(balance: number): string {
  return Math.round(balance * 60) < 0 ? `Owing ${formatHours(-balance)}` : formatHours(balance);
}

const RECEIPT_COLUMNS = [
  { label: 'Item', width: '20%' },
  { label: 'Description', align: 'left' as const },
  { label: 'Amount', width: '24%' },
];

export type SessionReceiptData = {
  tutorName?: string | null;
  brand?: DocumentBrand | null;
  studentName: string;
  startedAt: string | null;
  endedAt: string | null;
  billedMinutes: number;
  topics: string[];
  notes?: string | null;
  creditsUsedHours: number;
  balanceAfter: number;
  /** Set for multi-subject students; balanceAfter is then that subject's balance. */
  subjectName?: string | null;
  travelCharge?: number | null;
  travelKm?: number | null;
};

function travelChargeLabel(charge: number, km: number | null | undefined): string {
  const k = kmLabel('in_person', km);
  return `${formatRandDocument(charge)}${k ? ` (${k})` : ''}`;
}

export function buildSessionReceiptHtml(d: SessionReceiptData): string {
  const when = d.startedAt ?? d.endedAt;
  const date = when ? formatDateLong(when) : '—';
  const time = d.startedAt && d.endedAt
    ? `${formatTime(d.startedAt)}–${formatTime(d.endedAt)}`
    : when ? formatTime(when) : '—';
  const topics = d.topics.map(t => t.trim()).filter(Boolean);
  const rows: string[][] = [[
    'Lesson',
    [d.subjectName, topics.length ? topics.join(', ') : null, `${formatMinutes(d.billedMinutes)} billed`].filter(Boolean).join(' · '),
    `${formatHours(d.creditsUsedHours)} credit`,
  ]];
  if (d.travelCharge && d.travelCharge > 0) rows.push(['Travel', 'In-person lesson', travelChargeLabel(d.travelCharge, d.travelKm)]);
  return buildDocumentHtml({
    title: 'RECEIPT',
    ...frame(d),
    left: { heading: 'LESSON FOR:', lines: [{ text: d.studentName, strong: true }, ...(d.subjectName ? [{ text: d.subjectName }] : [])] },
    right: [date, time],
    table: { columns: RECEIPT_COLUMNS, rows, minHeight: 160 },
    notes: d.notes?.trim() ? [`Notes: ${d.notes.trim()}`] : undefined,
    subtotals: [{ label: 'Credits used', value: formatHours(d.creditsUsedHours) }],
    total: { label: d.subjectName ? `${d.subjectName} credit` : 'Credit left', value: balanceText(d.balanceAfter) },
  });
}

const PAYMENT_LABEL: Record<string, string> = { eft: 'EFT', cash: 'Cash', card: 'Card', other: 'Other' };

export type TopUpReceiptData = {
  tutorName?: string | null;
  brand?: DocumentBrand | null;
  studentName: string;
  hoursAdded: number;
  amountPaid: number;
  paidAt: string;
  paymentMethod?: string | null;
  newBalance: number;
  subjectName?: string | null;
  /** Travel settled with this payment (rand). */
  travelSettled?: number | null;
  travelStillOwed?: number | null;
};

export function buildTopUpReceiptHtml(d: TopUpReceiptData): string {
  const travel = d.travelSettled && d.travelSettled > 0 ? d.travelSettled : 0;
  const rows: string[][] = [[
    'Tutoring',
    `${formatHours(d.hoursAdded)} of ${d.subjectName ? `${d.subjectName} ` : ''}lessons`,
    formatRandDocument(d.amountPaid),
  ]];
  if (travel > 0) rows.push(['Travel', 'Travel owed, settled', formatRandDocument(travel)]);
  const subtotals = [
    ...(d.paymentMethod ? [{ label: 'Method', value: PAYMENT_LABEL[d.paymentMethod] ?? d.paymentMethod }] : []),
    { label: d.subjectName ? `${d.subjectName} credit` : 'New balance', value: balanceText(d.newBalance) },
    ...(d.travelStillOwed && d.travelStillOwed > 0 ? [{ label: 'Travel still owed', value: formatRandDocument(d.travelStillOwed) }] : []),
  ];
  return buildDocumentHtml({
    title: 'RECEIPT',
    ...frame(d),
    left: { heading: 'RECEIVED FOR:', lines: [{ text: d.studentName, strong: true }] },
    right: [formatDateDocument(d.paidAt), 'Payment received'],
    table: { columns: RECEIPT_COLUMNS, rows, minHeight: 160 },
    subtotals,
    total: { label: 'Total paid', value: formatRandDocument(d.amountPaid + travel) },
  });
}

// ─── Data loaders (existing columns only) ─────────────────────────────────────

function loadSessionReceiptData(sessionId: string): (SessionReceiptData & { studentId: string }) | null {
  const db = getDb();
  const s = db.getFirstSync<{
    student_id: string; student_name: string; started_at: string | null; ended_at: string | null;
    duration_minutes: number | null; billed_minutes: number | null; topics: string | null;
    session_notes: string | null; travel_km: number | null; parent_travel_fee: number | null;
  }>(
    `SELECT s.student_id, st.full_name AS student_name, s.started_at, s.ended_at,
            s.duration_minutes, s.billed_minutes, s.topics, s.session_notes,
            s.travel_km, s.parent_travel_fee
     FROM sessions s JOIN students st ON st.id = s.student_id
     WHERE s.id = ?`,
    [sessionId]
  );
  if (!s) return null;
  const entry = db.getFirstSync<{ id: string; hours_delta: number }>(
    `SELECT id, hours_delta FROM ledger_entries
     WHERE related_session_id = ? AND type = 'session_deduction'
     ORDER BY rowid ASC LIMIT 1`,
    [sessionId]
  );
  const deduction = isMultiSubject(s.student_id) ? getSessionDeduction(sessionId) : null;
  return {
    studentId: s.student_id,
    subjectName: deduction?.subject_name ?? null,
    travelCharge: s.parent_travel_fee,
    travelKm: s.travel_km,
    tutorName: tutorName(),
    brand: loadDocumentBrand(),
    studentName: s.student_name,
    startedAt: s.started_at,
    endedAt: s.ended_at,
    billedMinutes: s.billed_minutes ?? s.duration_minutes ?? 0,
    topics: parseTopics(s.topics),
    notes: s.session_notes,
    creditsUsedHours: entry ? Math.abs(entry.hours_delta) : 0,
    balanceAfter: deduction ? deduction.balance_after : balanceThroughEntry(s.student_id, entry?.id ?? null),
  };
}

function loadTopUpReceiptData(packageId: string): TopUpReceiptData | null {
  const db = getDb();
  const p = db.getFirstSync<{
    student_id: string; student_name: string; hours_added: number; amount_paid: number;
    payment_method: string | null; created_at: string;
  }>(
    `SELECT cp.student_id, st.full_name AS student_name, cp.hours_added, cp.amount_paid,
            cp.payment_method, cp.created_at
     FROM credit_packages cp JOIN students st ON st.id = cp.student_id
     WHERE cp.id = ?`,
    [packageId]
  );
  if (!p) return null;
  const entry = db.getFirstSync<{ id: string }>(
    `SELECT id FROM ledger_entries WHERE related_package_id = ? AND type = 'top_up' ORDER BY rowid ASC LIMIT 1`,
    [packageId]
  );
  const detail = entry && isMultiSubject(p.student_id) ? getLedgerEntryById(entry.id) : null;
  const travelSettled = listTravelSettlementsForPackage(packageId).reduce((a, t) => a + t.amount, 0);
  return {
    subjectName: detail?.subject_name ?? null,
    travelSettled,
    travelStillOwed: travelSettled > 0 ? getTravelOwed(p.student_id).amount : null,
    tutorName: tutorName(),
    brand: loadDocumentBrand(),
    studentName: p.student_name,
    hoursAdded: p.hours_added,
    amountPaid: p.amount_paid,
    paidAt: p.created_at,
    paymentMethod: p.payment_method,
    newBalance: detail ? detail.balance_after : balanceThroughEntry(p.student_id, entry?.id ?? null),
  };
}

// ─── Plain-text (WhatsApp) receipts from stored data ─────────────────────────

/** Who the WhatsApp text is addressed to (see utils/recipient). */
export type ReceiptTextOpts = {
  /** @deprecated use recipientName */
  parentName?: string | null;
  recipientName?: string | null;
  audience?: MessageAudience;
};

/** Lesson summary text for WhatsApp; null if the session doesn't exist. */
export function getLessonReceiptText(sessionId: string, opts: ReceiptTextOpts = {}): string | null {
  const d = loadSessionReceiptData(sessionId);
  if (!d) return null;
  return buildLessonReceiptText({
    tutorName: d.tutorName,
    studentName: d.studentName,
    parentName: opts.parentName,
    recipientName: opts.recipientName,
    audience: opts.audience,
    startedAt: d.startedAt ?? d.endedAt ?? new Date().toISOString(),
    endedAt: d.startedAt ? d.endedAt : null,
    billedMinutes: d.billedMinutes,
    topics: d.topics,
    notes: d.notes,
    balanceAfter: d.balanceAfter,
    subjectName: d.subjectName,
    travelCharge: d.travelCharge,
    travelKm: d.travelKm,
  });
}

/** Top-up confirmation text for WhatsApp; null if the package doesn't exist. */
export function getTopUpReceiptText(packageId: string, opts: ReceiptTextOpts = {}): string | null {
  const d = loadTopUpReceiptData(packageId);
  if (!d) return null;
  return buildTopUpText({ ...d, parentName: opts.parentName, recipientName: opts.recipientName, audience: opts.audience });
}

function parseTiers(json: string | null | undefined): PackageTier[] {
  try {
    const parsed = JSON.parse(json ?? '[]');
    return Array.isArray(parsed) ? (parsed as PackageTier[]).filter(t => t.hours > 0 && t.price >= 0) : [];
  } catch {
    return [];
  }
}

/**
 * Top-up reminder text from stored data: per-subject balances, suggested
 * package (for the lowest subject), travel owed, payment details + reference.
 * Null if the student doesn't exist.
 */
export function getLowBalanceReminderText(studentId: string, opts: ReceiptTextOpts = {}): string | null {
  const student = getStudent(studentId);
  if (!student) return null;
  const profile = getOrCreateTutorProfile();
  const subjects = getSubjectBalances(studentId).filter(b => b.status === 'active');
  const total = currentBalance(studentId);
  const lowest = subjects.length > 0 ? Math.min(...subjects.map(b => b.balance_hours)) : total;
  const tiers = profile.tier_system_enabled === 1 ? parseTiers(profile.package_tiers) : [];
  const pkg = suggestTopUpPackage(tiers, lowest);
  const owed = getTravelOwed(studentId);
  return buildLowBalanceReminderText({
    tutorName: profile.full_name,
    studentName: student.full_name.trim().split(/\s+/)[0],
    parentName: opts.parentName,
    recipientName: opts.recipientName,
    audience: opts.audience,
    balanceHours: subjects.length === 1 ? subjects[0].balance_hours : total,
    subjectBalances: subjects.length > 1
      ? subjects.map(b => ({ subject: b.subject, balanceHours: b.balance_hours }))
      : null,
    suggestedPackage: pkg ? { hours: pkg.hours, price: pkg.price } : null,
    paymentDetails: paymentDetailsForMessages(),
    paymentReference: buildPaymentReference(profile.payment_reference_template, student),
    travelOwed: owed.amount > 0 ? { amount: owed.amount, lessonCount: owed.lessonCount } : null,
  });
}

// ─── Travel payments ─────────────────────────────────────────────────────────

export type TravelPaymentReceiptData = {
  tutorName?: string | null;
  brand?: DocumentBrand | null;
  studentName: string;
  amount: number;
  paidAt: string;
  paymentMethod?: string | null;
  note?: string | null;
  stillOwed: number;
};

export function buildTravelPaymentHtml(d: TravelPaymentReceiptData): string {
  return buildDocumentHtml({
    title: 'RECEIPT',
    ...frame(d),
    left: { heading: 'RECEIVED FOR:', lines: [{ text: d.studentName, strong: true }] },
    right: [formatDateDocument(d.paidAt), 'Travel payment'],
    table: { columns: RECEIPT_COLUMNS, rows: [['Travel', d.note?.trim() || 'Travel to lessons', formatRandDocument(d.amount)]], minHeight: 160 },
    subtotals: [
      ...(d.paymentMethod ? [{ label: 'Method', value: PAYMENT_LABEL[d.paymentMethod] ?? d.paymentMethod }] : []),
      { label: 'Travel still owed', value: formatRandDocument(d.stillOwed) },
    ],
    total: { label: 'Total paid', value: formatRandDocument(d.amount) },
  });
}

function loadTravelPaymentData(settlementId: string): TravelPaymentReceiptData | null {
  const t = getTravelSettlement(settlementId);
  if (!t) return null;
  const student = getStudent(t.student_id, { includeArchived: true });
  if (!student) return null;
  return {
    tutorName: tutorName(),
    brand: loadDocumentBrand(),
    studentName: student.full_name,
    amount: t.amount,
    paidAt: t.created_at,
    paymentMethod: t.payment_method,
    note: t.note,
    stillOwed: getTravelOwed(t.student_id).amount,
  };
}

/** WhatsApp confirmation for a travel payment; null if it doesn't exist. */
export function getTravelPaymentText(settlementId: string, opts: ReceiptTextOpts = {}): string | null {
  const d = loadTravelPaymentData(settlementId);
  if (!d) return null;
  return buildTravelPaymentText({
    tutorName: d.tutorName,
    studentName: d.studentName,
    parentName: opts.parentName,
    recipientName: opts.recipientName,
    audience: opts.audience,
    amount: d.amount,
    paidAt: d.paidAt,
    stillOwed: d.stillOwed,
  });
}

// ─── PDF share ────────────────────────────────────────────────────────────────

async function renderAndShare(html: string, filename: string): Promise<string> {
  const { uri } = await Print.printToFileAsync({ html });
  let shareUri = uri;
  if (FileSystem.cacheDirectory) {
    shareUri = `${FileSystem.cacheDirectory}${filename}`;
    await FileSystem.copyAsync({ from: uri, to: shareUri });
  }
  await Sharing.shareAsync(shareUri, { mimeType: 'application/pdf', dialogTitle: 'Share Receipt', UTI: 'com.adobe.pdf' });
  return shareUri;
}

/**
 * Render + share a lesson receipt PDF. The receipt row is upserted (one per
 * session) only after the share sheet resolves; a failed share rejects and
 * records nothing.
 */
export async function shareSessionReceipt(sessionId: string): Promise<ShareReceiptResult> {
  const data = loadSessionReceiptData(sessionId);
  if (!data) return { shared: false, uri: null };
  const date = new Date(data.startedAt ?? data.endedAt ?? Date.now());
  const uri = await renderAndShare(buildSessionReceiptHtml(data), receiptFilename('Receipt', data.studentName, date));
  upsertReceiptRow('session', { sessionId }, uri);
  return { shared: true, uri };
}

export async function shareTopUpReceipt(packageId: string): Promise<ShareReceiptResult> {
  const data = loadTopUpReceiptData(packageId);
  if (!data) return { shared: false, uri: null };
  const uri = await renderAndShare(
    buildTopUpReceiptHtml(data),
    receiptFilename('Payment', data.studentName, new Date(data.paidAt))
  );
  upsertReceiptRow('top_up', { packageId }, uri);
  return { shared: true, uri };
}

/** Render + share a travel payment PDF (no receipts row: that table covers lessons/top-ups only). */
export async function shareTravelPaymentReceipt(settlementId: string): Promise<ShareReceiptResult> {
  const data = loadTravelPaymentData(settlementId);
  if (!data) return { shared: false, uri: null };
  const uri = await renderAndShare(
    buildTravelPaymentHtml(data),
    receiptFilename('Travel', data.studentName, new Date(data.paidAt))
  );
  return { shared: true, uri };
}

export function getSessionReceipt(sessionId: string): ReceiptRow | null {
  const db = getDb();
  return db.getFirstSync<ReceiptRow>(
    `SELECT * FROM receipts WHERE kind = 'session' AND session_id = ? ORDER BY created_at ASC LIMIT 1`,
    [sessionId]
  ) ?? null;
}

export function getTopUpReceipt(packageId: string): ReceiptRow | null {
  const db = getDb();
  return db.getFirstSync<ReceiptRow>(
    `SELECT * FROM receipts WHERE kind = 'top_up' AND package_id = ? ORDER BY created_at ASC LIMIT 1`,
    [packageId]
  ) ?? null;
}
