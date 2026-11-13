import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { getDb } from '../db/client';
import { claimLineRate, getClaim, setClaimReportPath } from '../db/claims';
import { Claim, ClaimLine } from '../db/schema';
import { formatRandDocument, formatHours, formatClaimPeriod, inclusivePeriodEnd, formatDateLong } from './format';
import { buildDocumentHtml, businessFooter, type DocumentBrand } from './documentHtml';
import { loadDocumentBrand } from './documentBrand';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dateStamp(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = MONTH_ABBR[date.getMonth()];
  const y = date.getFullYear();
  return `${d}${m}${y}`;
}

/** Claim_01Sep2026_30Sep2026.pdf — end is the INCLUSIVE last day; voided claims get _VOID. */
export function claimReportFilename(claim: Claim): string {
  const suffix = claim.voided_at ? '_VOID' : '';
  if (claim.period_start && claim.period_end) {
    return `Claim_${dateStamp(new Date(claim.period_start))}_${dateStamp(inclusivePeriodEnd(claim.period_end))}${suffix}.pdf`;
  }
  return `Claim_All_${dateStamp(new Date(claim.created_at))}${suffix}.pdf`;
}

function modeLabel(mode: 'in_person' | 'online'): string {
  return mode === 'online' ? 'Online' : 'In-person';
}

function lineDateLabel(at: string | null): string {
  if (!at) return '—';
  return dateStamp(new Date(at));
}

/** e.g. #1A2B3C4D — the claim's short number, same as shown in the app. */
export function claimNumber(claim: Pick<Claim, 'id'>): string {
  return `#${claim.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/** The single rate every line shares, or null when lines differ (or none is known). */
export function sharedLineRate(lines: ClaimLine[]): number | null {
  const rates = lines.map(l => claimLineRate(l));
  if (rates.length === 0 || rates.some(r => r == null)) return null;
  return rates.every(r => Math.abs((r as number) - (rates[0] as number)) < 0.005) ? (rates[0] as number) : null;
}

export type ClaimReportLine = { line: ClaimLine; studentName: string; lessonAt: string | null };

/**
 * Pure HTML for a claim report: the tutor's own record, on the shared document
 * frame (F2) without BILLED TO or bank details. All user text is escaped.
 */
export function buildClaimReportHtml(input: {
  claim: Claim;
  tutorName: string;
  lines: ClaimReportLine[];
  brand?: DocumentBrand | null;
}): string {
  const { claim, tutorName, lines } = input;
  const voided = claim.voided_at != null;
  const totalHours = lines.reduce((sum, l) => sum + l.line.billed_hours, 0);
  const sharedRate = sharedLineRate(lines.map(l => l.line));
  const brand: DocumentBrand = { ...(input.brand ?? {}), name: input.brand?.name ?? tutorName };

  const rows = lines.map(({ line, studentName, lessonAt }) => {
    const rate = claimLineRate(line);
    return [
      lineDateLabel(lessonAt),
      studentName,
      modeLabel(line.mode),
      formatHours(line.billed_hours),
      rate == null ? '—' : `${formatRandDocument(rate)}/h`,
      formatRandDocument(line.lesson_fee),
      formatRandDocument(line.travel_fee),
      formatRandDocument(line.lesson_fee + line.travel_fee),
    ];
  });

  return buildDocumentHtml({
    title: 'CLAIM REPORT',
    logoDataUri: brand.logoDataUri,
    brandName: brand.name,
    left: {
      lines: [
        { text: tutorName, strong: true },
        { text: `Claim ${claimNumber(claim)}` },
        { text: `Period: ${formatClaimPeriod(claim.period_start, claim.period_end)}` },
        { text: `Travel mode: ${claim.travel_mode === 'distance' ? 'Per-km' : 'Flat'}` },
      ],
    },
    right: [
      `Created ${formatDateLong(claim.created_at)}`,
      `Lessons: ${lines.length}`,
      `Total hours: ${formatHours(totalHours)}`,
      ...(sharedRate != null ? [`Payout rate: ${formatRandDocument(sharedRate)}/h`] : []),
    ],
    banner: voided
      ? `VOID — voided ${formatDateLong(claim.voided_at!)}${claim.void_reason?.trim() ? `: ${claim.void_reason.trim()}` : ''}. This claim is not payable.`
      : null,
    watermark: voided ? 'VOID' : null,
    table: {
      columns: [
        { label: 'Date', width: '12%' },
        { label: 'Student', align: 'left' },
        { label: 'Mode', width: '11%' },
        { label: 'Hours', width: '9%' },
        { label: 'Rate', width: '11%' },
        { label: 'Lesson', width: '11%' },
        { label: 'Travel', width: '10%' },
        { label: 'Total', width: '12%' },
      ],
      rows,
      minHeight: 330,
    },
    subtotals: [
      { label: 'Lesson fees', value: formatRandDocument(claim.lesson_fee_total) },
      { label: 'Travel', value: formatRandDocument(claim.travel_total) },
    ],
    total: { label: `Grand total${voided ? ' (VOID)' : ''}`, value: formatRandDocument(claim.grand_total) },
    totalStruck: voided,
    footer: businessFooter(brand),
  });
}

/** Claim lines joined to their lesson's student + time. Money stays the frozen snapshot. */
function loadReportLines(claimId: string): ClaimReportLine[] {
  const rows = getDb().getAllSync<ClaimLine & { student_name: string | null; lesson_at: string | null }>(
    `SELECT cl.*, st.full_name AS student_name, COALESCE(s.started_at, s.ended_at, s.scheduled_for) AS lesson_at
     FROM claim_lines cl
     LEFT JOIN sessions s ON s.id = cl.session_id
     LEFT JOIN students st ON st.id = s.student_id
     WHERE cl.claim_id = ?
     ORDER BY lesson_at ASC, cl.created_at ASC`,
    [claimId]
  );
  return rows.map(({ student_name, lesson_at, ...line }) => ({
    line: line as ClaimLine,
    studentName: student_name ?? 'Unknown student',
    lessonAt: lesson_at,
  }));
}

export async function shareClaimReport(claimId: string): Promise<void> {
  const claim = getClaim(claimId);
  if (!claim) return;

  const profile = getDb().getFirstSync<{ full_name: string | null }>('SELECT full_name FROM tutor_profile LIMIT 1');
  const tutorName = profile?.full_name?.trim() || 'Tutor';

  const html = buildClaimReportHtml({ claim, tutorName, lines: loadReportLines(claimId), brand: loadDocumentBrand() });

  const { uri } = await Print.printToFileAsync({ html });
  setClaimReportPath(claimId, uri);

  const filename = claimReportFilename(claim);
  const destUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.copyAsync({ from: uri, to: destUri });
  await Sharing.shareAsync(destUri, { mimeType: 'application/pdf', dialogTitle: 'Share Claim Report', UTI: 'com.adobe.pdf' });
}
