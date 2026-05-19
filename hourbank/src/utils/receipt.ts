import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { getDb } from '../db/client';
import { newId } from '../db/uuid';

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function receiptFilename(studentName: string, date: Date): string {
  const sanitized = studentName.replace(/\s+/g, '');
  const d = String(date.getDate()).padStart(2, '0');
  const m = MONTH_ABBR[date.getMonth()];
  const y = date.getFullYear();
  return `Receipt_${sanitized}_${d}${m}${y}.pdf`;
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

function insertReceiptRow(
  kind: 'session' | 'top_up',
  sessionId: string | null,
  packageId: string | null
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.runSync(
    `INSERT INTO receipts (id, session_id, package_id, kind, rendered_path, shared_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    [newId(), sessionId, packageId, kind, now, now]
  );
}

export async function shareSessionReceipt(sessionId: string): Promise<void> {
  const db = getDb();
  const session = db.getFirstSync<{
    student_id: string; ended_at: string | null; duration_minutes: number | null;
    billed_minutes: number | null;
  }>('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  if (!session) return;

  const student = db.getFirstSync<{ full_name: string }>(
    'SELECT full_name FROM students WHERE id = ?', [session.student_id]
  );
  const ledger = db.getFirstSync<{ hours_delta: number; balance_after: number }>(
    'SELECT hours_delta, balance_after FROM ledger_entries WHERE related_session_id = ? LIMIT 1',
    [sessionId]
  );

  const dateStr = session.ended_at
    ? new Date(session.ended_at).toLocaleDateString('en-ZA')
    : new Date().toLocaleDateString('en-ZA');
  const durationMins = session.billed_minutes ?? session.duration_minutes ?? 0;
  const creditsUsed = ledger ? Math.abs(ledger.hours_delta) : 0;
  const balanceAfter = ledger?.balance_after ?? 0;

  const html = `
    <html>
    <body style="font-family: monospace; padding: 32px; max-width: 600px;">
      <h2>HourBank Receipt</h2>
      <p>Student: ${student?.full_name ?? '—'}</p>
      <p>Date: ${dateStr}</p>
      <p>Duration: ${Math.round(durationMins)} min</p>
      <p>Credits used: ${creditsUsed.toFixed(2)}h</p>
      <p>Balance after: ${balanceAfter.toFixed(2)}h</p>
    </body>
    </html>
  `;

  const { uri } = await Print.printToFileAsync({ html });
  const sessionDate = session.ended_at ? new Date(session.ended_at) : new Date();
  const filename = receiptFilename(student?.full_name ?? 'Receipt', sessionDate);
  const destUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.copyAsync({ from: uri, to: destUri });
  await Sharing.shareAsync(destUri, { mimeType: 'application/pdf', dialogTitle: 'Share Receipt' });
  insertReceiptRow('session', sessionId, null);
}

export async function shareTopUpReceipt(packageId: string): Promise<void> {
  const db = getDb();
  const pkg = db.getFirstSync<{
    student_id: string; hours_added: number; amount_paid: number; created_at: string;
  }>('SELECT * FROM credit_packages WHERE id = ?', [packageId]);
  if (!pkg) return;

  const student = db.getFirstSync<{ full_name: string }>(
    'SELECT full_name FROM students WHERE id = ?', [pkg.student_id]
  );

  const dateStr = new Date(pkg.created_at).toLocaleDateString('en-ZA');

  const html = `
    <html>
    <body style="font-family: monospace; padding: 32px; max-width: 600px;">
      <h2>HourBank Top-Up Receipt</h2>
      <p>Student: ${student?.full_name ?? '—'}</p>
      <p>Date: ${dateStr}</p>
      <p>Hours added: ${pkg.hours_added}h</p>
      <p>Amount paid: R${pkg.amount_paid.toFixed(2)}</p>
    </body>
    </html>
  `;

  const { uri } = await Print.printToFileAsync({ html });
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share Receipt' });
  insertReceiptRow('top_up', null, packageId);
}

export function getSessionReceipt(sessionId: string): ReceiptRow | null {
  const db = getDb();
  return db.getFirstSync<ReceiptRow>(
    'SELECT * FROM receipts WHERE session_id = ? LIMIT 1',
    [sessionId]
  );
}
