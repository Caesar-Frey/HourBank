process.env.TZ = 'Africa/Johannesburg';

jest.mock('expo-print', () => ({ printToFileAsync: jest.fn(async () => ({ uri: 'file:///tmp/print.pdf' })) }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => {}), isAvailableAsync: jest.fn(async () => true) }));
jest.mock('expo-file-system/legacy', () => ({
  __esModule: true,
  cacheDirectory: 'file:///cache/',
  copyAsync: jest.fn(async () => {}),
}));

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { createMigratedTestDb, resetDbSingleton } from '../../db/__tests__/testDb';
import type { TestDb } from '../../db/__tests__/testDb';
import {
  buildSessionReceiptHtml,
  buildTopUpReceiptHtml,
  shareSessionReceipt,
  shareTopUpReceipt,
  getSessionReceipt,
  getTopUpReceipt,
  getLessonReceiptText,
  getTopUpReceiptText,
} from '../receipt';

const EVIL = `<script>alert('x')</script>`;

describe('receipt HTML builders', () => {
  it('session receipt is branded, shows time range/topics/notes, and escapes user text', () => {
    const html = buildSessionReceiptHtml({
      tutorName: `Mag ${EVIL}`,
      studentName: `Amara ${EVIL}`,
      startedAt: '2026-10-09T07:30:00.000Z',
      endedAt: '2026-10-09T08:35:00.000Z',
      billedMinutes: 60,
      topics: [`Algebra ${EVIL}`],
      notes: `Line 1\nLine 2 ${EVIL}`,
      creditsUsedHours: 1,
      balanceAfter: -0.5,
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Mag');
    expect(html).toContain('Fri 9 Oct 2026');
    expect(html).toContain('09:30–10:35');
    expect(html).toContain('1h');
    expect(html).toContain('Algebra');
    expect(html).toContain('Line 1<br/>Line 2');
    expect(html).toContain('Owing');
    expect(html).toContain('30m');
  });

  it('top-up receipt formats rands deterministically and escapes', () => {
    const html = buildTopUpReceiptHtml({
      tutorName: 'Mag',
      studentName: EVIL,
      hoursAdded: 10,
      amountPaid: 5500,
      paidAt: '2026-10-09T07:30:00.000Z',
      paymentMethod: 'eft',
      newBalance: 12.5,
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('R\u00A05\u00A0500.00');
    expect(html).toContain('10h');
    expect(html).toContain('12h 30m');
    expect(html).toContain('EFT');
  });
});

describe('sharing receipts', () => {
  let db: TestDb;
  beforeEach(() => {
    jest.clearAllMocks();
    db = createMigratedTestDb();
    const t = '2026-10-09T07:30:00.000Z';
    db.runSync(`INSERT INTO tutor_profile (id, full_name) VALUES ('tp', 'Mag Tutor')`);
    db.runSync(
      `INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at)
       VALUES ('s1', 'Amara Nkosi', 10, 'Mathematics', 'CAPS', 'active', ?)`, [t]
    );
    db.runSync(
      `INSERT INTO credit_packages (id, student_id, hours_added, amount_paid, payment_method, created_at)
       VALUES ('p1', 's1', 10, 5500, 'cash', ?)`, [t]
    );
    db.runSync(
      `INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, related_package_id, created_at)
       VALUES ('e1', 's1', 'top_up', 10, 10, 'p1', ?)`, [t]
    );
    db.runSync(
      `INSERT INTO sessions (id, student_id, mode, started_at, ended_at, billed_minutes, duration_minutes, topics, session_notes, status, created_at)
       VALUES ('l1', 's1', 'online', '2026-10-09T07:30:00.000Z', '2026-10-09T08:35:00.000Z', 60, 65, '["Algebra"]', 'Good', 'completed', ?)`, [t]
    );
    db.runSync(
      `INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, related_session_id, created_at)
       VALUES ('e2', 's1', 'session_deduction', -1, 9, 'l1', '2026-10-09T08:35:00.000Z')`
    );
  });
  afterEach(() => resetDbSingleton());

  it('upserts one receipt row per session no matter how often it is shared', async () => {
    await expect(shareSessionReceipt('l1')).resolves.toEqual({ shared: true, uri: expect.any(String) });
    await shareSessionReceipt('l1');
    const n = db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM receipts WHERE session_id = 'l1'`)!.n;
    expect(n).toBe(1);
    expect(getSessionReceipt('l1')?.shared_at).toEqual(expect.any(String));
    const html = (Print.printToFileAsync as jest.Mock).mock.calls[0][0].html as string;
    expect(html).toContain('Mag Tutor');
    expect(html).toContain('Algebra');
  });

  it('does not mark the receipt as sent when sharing fails', async () => {
    (Sharing.shareAsync as jest.Mock).mockRejectedValueOnce(new Error('cancelled'));
    await expect(shareSessionReceipt('l1')).rejects.toThrow('cancelled');
    expect(getSessionReceipt('l1')).toBeNull();
  });

  it('returns shared:false for a missing session without writing', async () => {
    await expect(shareSessionReceipt('nope')).resolves.toEqual({ shared: false, uri: null });
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('top-up receipt upserts and includes the new balance', async () => {
    await shareTopUpReceipt('p1');
    await shareTopUpReceipt('p1');
    const n = db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM receipts WHERE package_id = 'p1'`)!.n;
    expect(n).toBe(1);
    expect(getTopUpReceipt('p1')).not.toBeNull();
    const html = (Print.printToFileAsync as jest.Mock).mock.calls[0][0].html as string;
    expect(html).toContain('R\u00A05\u00A0500.00');
    expect(html).toContain('10h');
  });

  it('builds WhatsApp texts from stored data', () => {
    const lesson = getLessonReceiptText('l1', { parentName: 'Thandi' })!;
    expect(lesson).toContain('Hi Thandi');
    expect(lesson).toContain('09:30–10:35');
    expect(lesson).toContain('Billed: 1h');
    expect(lesson).toContain('Balance remaining: 9h');
    expect(lesson).toContain('Mag Tutor');
    const topUp = getTopUpReceiptText('p1')!;
    expect(topUp).toContain('Amount: R\u00A05\u00A0500.00');
    expect(topUp).toContain('New balance: 10h');
    expect(getLessonReceiptText('nope')).toBeNull();
  });
});
