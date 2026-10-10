/**
 * shareCopy.ts — honest copy for share-sheet based flows.
 *
 * Android's share sheet doesn't tell us whether the user actually sent or saved
 * anything, so these labels only ever state that the sheet (or WhatsApp) was
 * OPENED, with when — never "shared ✓" / "backed up".
 */
import { formatDayShort, formatTime } from './format';

export const BACKUP_READY_TOAST = 'Backup file ready — save it somewhere safe (Drive, email)';
export const SHARE_SHEET_OPENED_TOAST = 'Share sheet opened';
export const PDF_SHARE_SHEET_OPENED_TOAST = 'Receipt PDF ready — share sheet opened';

export type ShareStamp = { via: 'whatsapp' | 'sheet'; at: string } | null;

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "14:05" when it happened today, otherwise "Fri 9 Oct". */
export function shareStampText(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  return sameLocalDay(d, now) ? formatTime(d) : formatDayShort(d);
}

/** Primary "tell the parent" button on the lesson summary. */
export function summaryShareLabel(
  stamp: ShareStamp,
  opts: { parentPhone: boolean; parentName?: string | null },
  now: Date = new Date()
): string {
  if (stamp?.via === 'whatsapp') return `Opened in WhatsApp ${shareStampText(stamp.at, now)} · Send again`;
  if (stamp?.via === 'sheet') return `Last shared ${shareStampText(stamp.at, now)} · Share again`;
  if (opts.parentPhone) return `Send to ${opts.parentName?.trim() || 'parent'} via WhatsApp`;
  return 'Share lesson summary';
}

/** Secondary PDF receipt button; `sharedAt` is receipts.shared_at (sheet last opened). */
export function pdfShareLabel(sharedAt: string | null | undefined, now: Date = new Date()): string {
  if (!sharedAt) return 'Share PDF receipt';
  return `PDF last shared ${shareStampText(sharedAt, now)} · Share again`;
}
