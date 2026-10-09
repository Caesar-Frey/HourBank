import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { getClaim, getClaimLines, setClaimReportPath } from '../db/claims';
import { getSessionWithStudent } from '../db/sessions';
import { getTutorProfile } from '../db/tutorProfile';
import { Claim, ClaimLine } from '../db/schema';
import { formatRand, formatHours } from './format';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dateStamp(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = MONTH_ABBR[date.getMonth()];
  const y = date.getFullYear();
  return `${d}${m}${y}`;
}

function claimReportFilename(claim: Claim): string {
  if (claim.period_start && claim.period_end) {
    return `Claim_${dateStamp(new Date(claim.period_start))}_${dateStamp(new Date(claim.period_end))}.pdf`;
  }
  return `Claim_All_${dateStamp(new Date(claim.created_at))}.pdf`;
}

function periodLabel(claim: Claim): string {
  if (!claim.period_start || !claim.period_end) return 'All';
  return `${dateStamp(new Date(claim.period_start))} – ${dateStamp(new Date(claim.period_end))}`;
}

function modeLabel(mode: 'in_person' | 'online'): string {
  return mode === 'online' ? 'Online' : 'In-person';
}

function lineDateLabel(endedAt: string | null): string {
  if (!endedAt) return '—';
  return dateStamp(new Date(endedAt));
}

const MONO = "font-family: 'Courier New', monospace;";

export async function shareClaimReport(claimId: string): Promise<void> {
  const claim = getClaim(claimId);
  if (!claim) return;

  const lines = getClaimLines(claimId);
  const profile = getTutorProfile();
  const tutorName = profile?.full_name?.trim() || 'Tutor';

  // Resolve display name/date per session from the completed session (Phase 4 approach).
  // claim_lines snapshot only money/mode/hours — never recompute money.
  const enriched = lines.map((line: ClaimLine) => {
    const session = getSessionWithStudent(line.session_id);
    return {
      line,
      studentName: session?.student_name ?? 'Unknown student',
      endedAt: session?.ended_at ?? null,
    };
  });

  const rows = enriched
    .map(({ line, studentName, endedAt }) => `
      <tr>
        <td style="${MONO} padding: 6px 8px; border-bottom: 1px solid lightgray;">${lineDateLabel(endedAt)}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid lightgray;">${studentName}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid lightgray;">${modeLabel(line.mode)}</td>
        <td style="${MONO} padding: 6px 8px; border-bottom: 1px solid lightgray; text-align: right;">${formatHours(line.billed_hours)}</td>
        <td style="${MONO} padding: 6px 8px; border-bottom: 1px solid lightgray; text-align: right;">${formatRand(line.lesson_fee)}</td>
        <td style="${MONO} padding: 6px 8px; border-bottom: 1px solid lightgray; text-align: right;">${formatRand(line.travel_fee)}</td>
        <td style="${MONO} padding: 6px 8px; border-bottom: 1px solid lightgray; text-align: right;">${formatRand(line.lesson_fee + line.travel_fee)}</td>
      </tr>`)
    .join('');

  const travelModeLabel = claim.travel_mode === 'distance' ? 'Per-km' : 'Flat';

  const html = `
    <html>
    <body style="font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 32px; max-width: 760px; color: black;">
      <h2 style="margin: 0 0 4px 0;">HourBank Claim Statement</h2>
      <p style="margin: 0 0 16px 0; color: gray;">${tutorName}</p>

      <table style="margin-bottom: 20px; border-collapse: collapse;">
        <tr><td style="padding: 2px 16px 2px 0; color: gray;">Period</td><td style="${MONO}">${periodLabel(claim)}</td></tr>
        <tr><td style="padding: 2px 16px 2px 0; color: gray;">Payout rate</td><td style="${MONO}">${formatRand(claim.payout_rate)}/h</td></tr>
        <tr><td style="padding: 2px 16px 2px 0; color: gray;">Travel mode</td><td>${travelModeLabel}</td></tr>
      </table>

      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="border-bottom: 2px solid black;">
            <th style="padding: 6px 8px; text-align: left;">Date</th>
            <th style="padding: 6px 8px; text-align: left;">Student</th>
            <th style="padding: 6px 8px; text-align: left;">Mode</th>
            <th style="padding: 6px 8px; text-align: right;">Hours</th>
            <th style="padding: 6px 8px; text-align: right;">Lesson</th>
            <th style="padding: 6px 8px; text-align: right;">Travel</th>
            <th style="padding: 6px 8px; text-align: right;">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <table style="width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px;">
        <tr>
          <td style="padding: 4px 8px; text-align: right; color: gray;">Lesson fees</td>
          <td style="${MONO} padding: 4px 8px; text-align: right; width: 140px;">${formatRand(claim.lesson_fee_total)}</td>
        </tr>
        <tr>
          <td style="padding: 4px 8px; text-align: right; color: gray;">Travel</td>
          <td style="${MONO} padding: 4px 8px; text-align: right;">${formatRand(claim.travel_total)}</td>
        </tr>
        <tr style="border-top: 2px solid black;">
          <td style="padding: 8px 8px; text-align: right;">Grand total</td>
          <td style="${MONO} padding: 8px 8px; text-align: right;">${formatRand(claim.grand_total)}</td>
        </tr>
      </table>
    </body>
    </html>
  `;

  const { uri } = await Print.printToFileAsync({ html });
  setClaimReportPath(claimId, uri);

  const filename = claimReportFilename(claim);
  const destUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.copyAsync({ from: uri, to: destUri });
  await Sharing.shareAsync(destUri, { mimeType: 'application/pdf', dialogTitle: 'Share Claim Report' });
}
