import { BACKUP_READY_TOAST, pdfShareLabel, shareStampText, summaryShareLabel } from '../shareCopy';

const now = new Date(2026, 9, 10, 15, 0);
const today = new Date(2026, 9, 10, 14, 5).toISOString();
const earlier = new Date(2026, 9, 9, 9, 30).toISOString();

describe('shareStampText', () => {
  test('time of day for today, short date otherwise', () => {
    expect(shareStampText(today, now)).toBe('14:05');
    expect(shareStampText(earlier, now)).toBe('Fri 9 Oct');
  });
});

describe('summaryShareLabel — never claims the parent received it', () => {
  test('before sharing', () => {
    expect(summaryShareLabel(null, { parentPhone: true, parentName: 'Mrs Botha' }, now)).toBe('Send to Mrs Botha via WhatsApp');
    expect(summaryShareLabel(null, { parentPhone: true, parentName: '  ' }, now)).toBe('Send to parent via WhatsApp');
    expect(summaryShareLabel(null, { parentPhone: false }, now)).toBe('Share lesson summary');
  });
  test('after the share sheet / WhatsApp was opened', () => {
    const sheet = summaryShareLabel({ via: 'sheet', at: today }, { parentPhone: false }, now);
    expect(sheet).toBe('Last shared 14:05 · Share again');
    const wa = summaryShareLabel({ via: 'whatsapp', at: today }, { parentPhone: true }, now);
    expect(wa).toBe('Opened in WhatsApp 14:05 · Send again');
    for (const l of [sheet, wa]) {
      expect(l).not.toMatch(/✓|sent\b|delivered/i);
    }
  });
});

describe('pdfShareLabel', () => {
  test('uses the persisted shared_at stamp', () => {
    expect(pdfShareLabel(null, now)).toBe('Share PDF receipt');
    expect(pdfShareLabel(earlier, now)).toBe('PDF last shared Fri 9 Oct · Share again');
    expect(pdfShareLabel(today, now)).not.toContain('✓');
  });
});

test('backup toast does not claim the file was saved', () => {
  expect(BACKUP_READY_TOAST).toBe('Backup file ready — save it somewhere safe (Drive, email)');
});
