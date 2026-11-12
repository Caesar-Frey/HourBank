import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { getDb } from '../db/client';
import { claimLineRate, getClaim, setClaimReportPath } from '../db/claims';
import { COLORS } from '../theme/colors';
import { Claim, ClaimLine } from '../db/schema';
import { formatRand, formatHours, formatClaimPeriod, inclusivePeriodEnd, formatDateLong } from './format';
import { escapeHtml, escapeHtmlMultiline } from './html';

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

const MONO = "font-family: 'Courier New', monospace;";
const CELL = `padding: 6px 8px; border-bottom: 1px solid ${COLORS.paperEdge};`;
const SOFT = `color: ${COLORS.inkFaint};`;

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

/** Pure HTML for a claim statement. All user text is escaped. */
export function buildClaimReportHtml(input: {
  claim: Claim;
  tutorName: string;
  lines: ClaimReportLine[];
}): string {
  const { claim, tutorName, lines } = input;
  const voided = claim.voided_at != null;

  const rows = lines
    .map(({ line, studentName, lessonAt }) => {
      const rate = claimLineRate(line);
      return `
      <tr>
        <td style="${MONO} ${CELL}">${escapeHtml(lineDateLabel(lessonAt))}</td>
        <td style="${CELL}">${escapeHtml(studentName)}</td>
        <td style="${CELL}">${modeLabel(line.mode)}</td>
        <td style="${MONO} ${CELL} text-align: right;">${escapeHtml(formatHours(line.billed_hours))}</td>
        <td style="${MONO} ${CELL} text-align: right;">${rate == null ? '—' : `${escapeHtml(formatRand(rate))}/h`}</td>
        <td style="${MONO} ${CELL} text-align: right;">${escapeHtml(formatRand(line.lesson_fee))}</td>
        <td style="${MONO} ${CELL} text-align: right;">${escapeHtml(formatRand(line.travel_fee))}</td>
        <td style="${MONO} ${CELL} text-align: right;">${escapeHtml(formatRand(line.lesson_fee + line.travel_fee))}</td>
      </tr>`;
    })
    .join('');
  const totalHours = lines.reduce((sum, l) => sum + l.line.billed_hours, 0);
  const sharedRate = sharedLineRate(lines.map(l => l.line));

  const travelModeLabel = claim.travel_mode === 'distance' ? 'Per-km' : 'Flat';

  const watermark = voided
    ? `<div style="position: fixed; top: 38%; left: 0; right: 0; text-align: center; transform: rotate(-30deg);
                   font-size: 160px; letter-spacing: 16px; color: ${COLORS.crimson}; opacity: 0.14; z-index: 0; pointer-events: none;">VOID</div>`
    : '';
  const voidBanner = voided
    ? `<p style="margin: 0 0 16px 0; padding: 8px 12px; border: 2px solid ${COLORS.crimson}; color: ${COLORS.crimson};">
         VOID — voided ${escapeHtml(formatDateLong(claim.voided_at!))}${
           claim.void_reason?.trim() ? `: ${escapeHtmlMultiline(claim.void_reason.trim())}` : ''
         }. This claim is not payable.
       </p>`
    : '';

  return `
    <html>
    <body style="font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 32px; max-width: 760px; color: ${COLORS.ink};">
      ${watermark}
      <div style="position: relative; z-index: 1;">
      <h2 style="margin: 0 0 4px 0;">HourBank Claim Statement</h2>
      <p style="margin: 0 0 16px 0; ${SOFT}">${escapeHtml(tutorName)}</p>
      ${voidBanner}

      <table style="margin-bottom: 20px; border-collapse: collapse;">
        <tr><td style="padding: 2px 16px 2px 0; ${SOFT}">Claim</td><td style="${MONO}">${escapeHtml(claimNumber(claim))}</td></tr>
        <tr><td style="padding: 2px 16px 2px 0; ${SOFT}">Created</td><td style="${MONO}">${escapeHtml(formatDateLong(claim.created_at))}</td></tr>
        <tr><td style="padding: 2px 16px 2px 0; ${SOFT}">Period</td><td style="${MONO}">${escapeHtml(formatClaimPeriod(claim.period_start, claim.period_end))}</td></tr>
        <tr><td style="padding: 2px 16px 2px 0; ${SOFT}">Lessons</td><td style="${MONO}">${lines.length}</td></tr>
        <tr><td style="padding: 2px 16px 2px 0; ${SOFT}">Total hours</td><td style="${MONO}">${escapeHtml(formatHours(totalHours))}</td></tr>
        ${sharedRate != null ? `<tr><td style="padding: 2px 16px 2px 0; ${SOFT}">Payout rate</td><td style="${MONO}">${escapeHtml(formatRand(sharedRate))}/h</td></tr>` : ''}
        <tr><td style="padding: 2px 16px 2px 0; ${SOFT}">Travel mode</td><td>${travelModeLabel}</td></tr>
      </table>

      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="border-bottom: 2px solid ${COLORS.ink};">
            <th style="padding: 6px 8px; text-align: left;">Date</th>
            <th style="padding: 6px 8px; text-align: left;">Student</th>
            <th style="padding: 6px 8px; text-align: left;">Mode</th>
            <th style="padding: 6px 8px; text-align: right;">Hours</th>
            <th style="padding: 6px 8px; text-align: right;">Rate</th>
            <th style="padding: 6px 8px; text-align: right;">Lesson</th>
            <th style="padding: 6px 8px; text-align: right;">Travel</th>
            <th style="padding: 6px 8px; text-align: right;">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <table style="width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px;">
        <tr>
          <td style="padding: 4px 8px; text-align: right; ${SOFT}">Lesson fees</td>
          <td style="${MONO} padding: 4px 8px; text-align: right; width: 140px;">${escapeHtml(formatRand(claim.lesson_fee_total))}</td>
        </tr>
        <tr>
          <td style="padding: 4px 8px; text-align: right; ${SOFT}">Travel</td>
          <td style="${MONO} padding: 4px 8px; text-align: right;">${escapeHtml(formatRand(claim.travel_total))}</td>
        </tr>
        <tr style="border-top: 2px solid ${COLORS.ink};">
          <td style="padding: 8px 8px; text-align: right;">Grand total${voided ? ' (VOID)' : ''}</td>
          <td style="${MONO} padding: 8px 8px; text-align: right;${voided ? ' text-decoration: line-through;' : ''}">${escapeHtml(formatRand(claim.grand_total))}</td>
        </tr>
      </table>
      </div>
    </body>
    </html>
  `;
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

  const html = buildClaimReportHtml({ claim, tutorName, lines: loadReportLines(claimId) });

  const { uri } = await Print.printToFileAsync({ html });
  setClaimReportPath(claimId, uri);

  const filename = claimReportFilename(claim);
  const destUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.copyAsync({ from: uri, to: destUri });
  await Sharing.shareAsync(destUri, { mimeType: 'application/pdf', dialogTitle: 'Share Claim Report', UTI: 'com.adobe.pdf' });
}
