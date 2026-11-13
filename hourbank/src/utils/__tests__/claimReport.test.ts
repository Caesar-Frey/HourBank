process.env.TZ = 'Africa/Johannesburg';

jest.mock('expo-print', () => ({ printToFileAsync: jest.fn(async () => ({ uri: 'file:///tmp/print.pdf' })) }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => {}) }));
jest.mock('expo-file-system/legacy', () => ({
  __esModule: true,
  cacheDirectory: 'file:///cache/',
  copyAsync: jest.fn(async () => {}),
}));

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { Claim } from '../../db/schema';
import { buildClaimReportHtml, claimReportFilename, shareClaimReport } from '../claimReport';
import { createMigratedTestDb, resetDbSingleton } from '../../db/__tests__/testDb';
import type { TestDb } from '../../db/__tests__/testDb';

const EVIL = `<img src=x onerror="alert(1)">`;

function claim(over: Partial<Claim> = {}): Claim {
  return {
    id: 'c1',
    tutor_id: null,
    period_start: new Date(2026, 8, 1).toISOString(),
    period_end: new Date(2026, 9, 1).toISOString(), // exclusive
    payout_rate: 600,
    travel_mode: 'flat',
    per_km_rate: 0,
    lesson_fee_total: 600,
    travel_total: 50,
    grand_total: 650,
    report_path: null,
    voided_at: null,
    void_reason: null,
    created_at: '2026-10-01T08:00:00.000Z',
    ...over,
  };
}

const line = {
  id: 'cl1', claim_id: 'c1', session_id: 'l1', billed_hours: 1, mode: 'in_person' as const,
  lesson_fee: 600, travel_fee: 50, created_at: '2026-10-01T08:00:00.000Z',
};

describe('buildClaimReportHtml', () => {
  it('escapes tutor and student names', () => {
    const html = buildClaimReportHtml({
      claim: claim(),
      tutorName: EVIL,
      lines: [{ line, studentName: EVIL, lessonAt: '2026-09-15T07:00:00.000Z' }],
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('prints the inclusive period end and deterministic rands', () => {
    const html = buildClaimReportHtml({
      claim: claim(),
      tutorName: 'Mag',
      lines: [{ line, studentName: 'Amara', lessonAt: '2026-09-15T07:00:00.000Z' }],
    });
    expect(html).toContain('1 Sep – 30 Sep 2026');
    expect(html).not.toContain('– 1 Oct');
    expect(html).toContain('R650');
    expect(html).toContain('R600/h');
    expect(html).not.toContain('VOID');
  });

  it('is auditable: number, created date, lesson count, hours and the rate per line (B5)', () => {
    const html = buildClaimReportHtml({
      claim: claim({ id: 'abcd1234-ffff' }),
      tutorName: 'Mag',
      lines: [
        { line: { ...line, rate: 600 }, studentName: 'Amara', lessonAt: '2026-09-15T07:00:00.000Z' },
        { line: { ...line, id: 'cl2', session_id: 'l2', billed_hours: 0.5, lesson_fee: 300, rate: 600 }, studentName: 'Bo', lessonAt: '2026-09-16T07:00:00.000Z' },
      ],
    });
    expect(html).toContain('#ABCD1234');
    expect(html).toContain('Thu 1 Oct 2026');
    expect(html).toContain('Lessons: 2');
    expect(html).toContain('1h 30m');
    expect(html).toContain('Payout rate');
    expect(html).not.toMatch(/rgba|gray|crimson|black/);
  });

  it('hides the header rate when lines differ, and prints — for an unknown rate', () => {
    const html = buildClaimReportHtml({
      claim: claim(),
      tutorName: 'Mag',
      lines: [
        { line: { ...line, rate: 600 }, studentName: 'Amara', lessonAt: '2026-09-15T07:00:00.000Z' },
        { line: { ...line, id: 'cl2', billed_hours: 0, lesson_fee: 0, rate: null }, studentName: 'Bo', lessonAt: null },
      ],
    });
    expect(html).not.toContain('Payout rate');
    expect(html).toContain('R600/h');
    expect(html).toContain('>—<');
  });

  it('watermarks voided claims with VOID and the (escaped) reason', () => {
    const html = buildClaimReportHtml({
      claim: claim({ voided_at: '2026-10-05T08:00:00.000Z', void_reason: `Wrong ${EVIL}` }),
      tutorName: 'Mag',
      lines: [],
    });
    expect(html).toContain('VOID');
    expect(html).toContain('Wrong &lt;img');
    expect(html).not.toContain('<img');
  });

  it('filename uses the inclusive end day', () => {
    expect(claimReportFilename(claim())).toBe('Claim_01Sep2026_30Sep2026.pdf');
    expect(claimReportFilename(claim({ voided_at: '2026-10-05T08:00:00.000Z' }))).toBe('Claim_01Sep2026_30Sep2026_VOID.pdf');
    expect(claimReportFilename(claim({ period_start: null, period_end: null }))).toBe('Claim_All_01Oct2026.pdf');
  });
});

describe('shareClaimReport', () => {
  let db: TestDb;
  beforeEach(() => {
    jest.clearAllMocks();
    db = createMigratedTestDb();
    const t = '2026-09-15T07:00:00.000Z';
    db.runSync(`INSERT INTO tutor_profile (id, full_name) VALUES ('tp', 'Mag Tutor')`);
    db.runSync(
      `INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at)
       VALUES ('s1', 'Amara', 10, 'Mathematics', 'CAPS', 'active', ?)`, [t]
    );
    db.runSync(
      `INSERT INTO sessions (id, student_id, mode, started_at, ended_at, billed_minutes, status, created_at)
       VALUES ('l1', 's1', 'in_person', ?, '2026-09-15T08:00:00.000Z', 60, 'completed', ?)`, [t, t]
    );
    db.runSync(
      `INSERT INTO claims (id, period_start, period_end, payout_rate, travel_mode, lesson_fee_total, travel_total, grand_total, created_at)
       VALUES ('c1', ?, ?, 600, 'flat', 600, 50, 650, '2026-10-01T08:00:00.000Z')`,
      [new Date(2026, 8, 1).toISOString(), new Date(2026, 9, 1).toISOString()]
    );
    db.runSync(
      `INSERT INTO claim_lines (id, claim_id, session_id, billed_hours, mode, lesson_fee, travel_fee, created_at)
       VALUES ('cl1', 'c1', 'l1', 1, 'in_person', 600, 50, '2026-10-01T08:00:00.000Z')`
    );
  });
  afterEach(() => resetDbSingleton());

  it('renders lines with student names and shares under the inclusive filename', async () => {
    await shareClaimReport('c1');
    const html = (Print.printToFileAsync as jest.Mock).mock.calls[0][0].html as string;
    expect(html).toContain('Amara');
    expect(html).toContain('Mag Tutor');
    expect((Sharing.shareAsync as jest.Mock).mock.calls[0][0]).toBe('file:///cache/Claim_01Sep2026_30Sep2026.pdf');
    expect(db.getFirstSync<{ report_path: string }>(`SELECT report_path FROM claims WHERE id = 'c1'`)!.report_path)
      .toBe('file:///tmp/print.pdf');
  });
});
