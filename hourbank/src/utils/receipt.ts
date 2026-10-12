import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { getDb } from '../db/client';
import { newId } from '../db/uuid';
import { escapeHtml, escapeHtmlMultiline } from './html';
import { formatDateLong, formatHours, formatMinutes, formatRand, formatTime } from './format';
import { buildLessonReceiptText, buildTopUpText } from './parentMessages';
import type { MessageAudience } from './parentMessages';

export {
  buildLessonReceiptText,
  buildTopUpText,
  buildLowBalanceReminderText,
} from './parentMessages';

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function receiptFilename(prefix: string, studentName: string, date: Date): string {
  const sanitized = studentName.replace(/[^A-Za-z0-9]+/g, '') || 'Student';
  const d = String(date.getDate()).padStart(2, '0');
  const m = MONTH_ABBR[date.getMonth()];
  const y = date.getFullYear();
  return `${prefix}_${sanitized}_${d}${m}${y}.pdf`;
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

/** Ledger-derived balance immediately after a given entry (append-only ⇒ rowid order). */
function balanceThroughEntry(studentId: string, entryId: string | null): number {
  const db = getDb();
  const row = entryId
    ? db.getFirstSync<{ bal: number | null }>(
        `SELECT SUM(hours_delta) AS bal FROM ledger_entries
         WHERE student_id = ? AND rowid <= (SELECT rowid FROM ledger_entries WHERE id = ?)`,
        [studentId, entryId]
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

// ─── Pure HTML builders ───────────────────────────────────────────────────────

const PAGE_STYLE = 'font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 32px; max-width: 600px; color: black;';
const MONO = "font-family: 'Courier New', monospace;";

function row(label: string, valueHtml: string, mono = true): string {
  return `<tr><td style="padding: 4px 16px 4px 0; color: gray; vertical-align: top;">${label}</td>` +
    `<td style="padding: 4px 0; ${mono ? MONO : ''}">${valueHtml}</td></tr>`;
}

function header(title: string, tutor: string | null | undefined): string {
  const brand = tutor?.trim() ? escapeHtml(tutor.trim()) : 'HourBank';
  return `<p style="margin: 0; font-size: 18px;">${brand}</p>
      <h2 style="margin: 4px 0 20px 0; font-weight: normal; font-style: italic;">${title}</h2>`;
}

function balanceHtml(balance: number): string {
  return Math.round(balance * 60) < 0
    ? `Owing ${escapeHtml(formatHours(-balance))}`
    : escapeHtml(formatHours(balance));
}

export type SessionReceiptData = {
  tutorName?: string | null;
  studentName: string;
  startedAt: string | null;
  endedAt: string | null;
  billedMinutes: number;
  topics: string[];
  notes?: string | null;
  creditsUsedHours: number;
  balanceAfter: number;
};

export function buildSessionReceiptHtml(d: SessionReceiptData): string {
  const when = d.startedAt ?? d.endedAt;
  const date = when ? formatDateLong(when) : '—';
  const time = d.startedAt && d.endedAt
    ? `${formatTime(d.startedAt)}–${formatTime(d.endedAt)}`
    : when ? formatTime(when) : '—';
  const topics = d.topics.map(t => t.trim()).filter(Boolean);
  return `
    <html>
    <body style="${PAGE_STYLE}">
      ${header('Lesson receipt', d.tutorName)}
      <table style="border-collapse: collapse;">
        ${row('Student', escapeHtml(d.studentName), false)}
        ${row('Date', escapeHtml(date))}
        ${row('Time', escapeHtml(time))}
        ${row('Billed', escapeHtml(formatMinutes(d.billedMinutes)))}
        ${topics.length ? row('Topics', topics.map(escapeHtml).join(', '), false) : ''}
        ${d.notes?.trim() ? row('Notes', escapeHtmlMultiline(d.notes.trim()), false) : ''}
        ${row('Credits used', escapeHtml(formatHours(d.creditsUsedHours)))}
        ${row('Balance after', balanceHtml(d.balanceAfter))}
      </table>
    </body>
    </html>
  `;
}

const PAYMENT_LABEL: Record<string, string> = { eft: 'EFT', cash: 'Cash', card: 'Card', other: 'Other' };

export type TopUpReceiptData = {
  tutorName?: string | null;
  studentName: string;
  hoursAdded: number;
  amountPaid: number;
  paidAt: string;
  paymentMethod?: string | null;
  newBalance: number;
};

export function buildTopUpReceiptHtml(d: TopUpReceiptData): string {
  return `
    <html>
    <body style="${PAGE_STYLE}">
      ${header('Payment receipt', d.tutorName)}
      <table style="border-collapse: collapse;">
        ${row('Student', escapeHtml(d.studentName), false)}
        ${row('Date', escapeHtml(formatDateLong(d.paidAt)))}
        ${row('Hours added', escapeHtml(formatHours(d.hoursAdded)))}
        ${row('Amount paid', escapeHtml(formatRand(d.amountPaid)))}
        ${d.paymentMethod ? row('Method', escapeHtml(PAYMENT_LABEL[d.paymentMethod] ?? d.paymentMethod), false) : ''}
        ${row('New balance', balanceHtml(d.newBalance))}
      </table>
    </body>
    </html>
  `;
}

// ─── Data loaders (existing columns only) ─────────────────────────────────────

function loadSessionReceiptData(sessionId: string): (SessionReceiptData & { studentId: string }) | null {
  const db = getDb();
  const s = db.getFirstSync<{
    student_id: string; student_name: string; started_at: string | null; ended_at: string | null;
    duration_minutes: number | null; billed_minutes: number | null; topics: string | null;
    session_notes: string | null;
  }>(
    `SELECT s.student_id, st.full_name AS student_name, s.started_at, s.ended_at,
            s.duration_minutes, s.billed_minutes, s.topics, s.session_notes
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
  return {
    studentId: s.student_id,
    tutorName: tutorName(),
    studentName: s.student_name,
    startedAt: s.started_at,
    endedAt: s.ended_at,
    billedMinutes: s.billed_minutes ?? s.duration_minutes ?? 0,
    topics: parseTopics(s.topics),
    notes: s.session_notes,
    creditsUsedHours: entry ? Math.abs(entry.hours_delta) : 0,
    balanceAfter: balanceThroughEntry(s.student_id, entry?.id ?? null),
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
  return {
    tutorName: tutorName(),
    studentName: p.student_name,
    hoursAdded: p.hours_added,
    amountPaid: p.amount_paid,
    paidAt: p.created_at,
    paymentMethod: p.payment_method,
    newBalance: balanceThroughEntry(p.student_id, entry?.id ?? null),
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
  });
}

/** Top-up confirmation text for WhatsApp; null if the package doesn't exist. */
export function getTopUpReceiptText(packageId: string, opts: ReceiptTextOpts = {}): string | null {
  const d = loadTopUpReceiptData(packageId);
  if (!d) return null;
  return buildTopUpText({ ...d, parentName: opts.parentName, recipientName: opts.recipientName, audience: opts.audience });
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
