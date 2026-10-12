import {
  lastBackupLabel,
  validateAmount,
  tierDraftsFromTiers,
  validateTierDrafts,
  backupErrorMessage,
  backupErrorDetail,
  billingRoundingExplanation,
  restoreSummaryLines,
  BILLING_ROUND_OPTIONS,
  RESTORE_CONFIRM_WORD,
} from '../settingsLogic';

describe('lastBackupLabel', () => {
  const now = new Date(2026, 9, 10, 15, 0);
  test('never', () => {
    expect(lastBackupLabel(null, now)).toBe('Never');
    expect(lastBackupLabel('garbage', now)).toBe('Never');
  });
  test('today / yesterday use calendar days', () => {
    expect(lastBackupLabel(new Date(2026, 9, 10, 0, 5).toISOString(), now)).toBe('Today');
    expect(lastBackupLabel(new Date(2026, 9, 9, 23, 55).toISOString(), now)).toBe('Yesterday');
  });
  test('n days ago', () => {
    expect(lastBackupLabel(new Date(2026, 9, 7, 9, 0).toISOString(), now)).toBe('3 days ago');
  });
});

describe('validateAmount', () => {
  test('accepts SA formats', () => {
    expect(validateAmount('450')).toEqual({ value: 450, error: null });
    expect(validateAmount('1,5')).toEqual({ value: 1.5, error: null });
    expect(validateAmount('4 500')).toEqual({ value: 4500, error: null });
    expect(validateAmount('R 5 500')).toEqual({ value: 5500, error: null });
  });
  test('rejects empty / junk / negative instead of silently saving 0', () => {
    expect(validateAmount('').error).toBe('Required');
    expect(validateAmount('abc').error).toMatch(/Enter a number/);
    expect(validateAmount('-5').error).toBe('Must be 0 or more');
  });
  test('positive option', () => {
    expect(validateAmount('0', { positive: true }).error).toBe('Must be more than 0');
  });
});

describe('package tiers', () => {
  let n = 0;
  const makeKey = () => `k${n++}`;
  beforeEach(() => { n = 0; });

  test('drafts carry stable keys and string fields', () => {
    const drafts = tierDraftsFromTiers([{ hours: 10, price: 5500, label: 'Best Value', sort_order: 1 }], makeKey);
    expect(drafts).toEqual([{ key: 'k0', hours: '10', price: '5500', label: 'Best Value', sort_order: 1 }]);
  });

  test('valid drafts → tiers sorted by sort_order, numeric hours authoritative', () => {
    const r = validateTierDrafts([
      { key: 'a', hours: '10', price: '5 500', label: ' Best Value ', sort_order: 2 },
      { key: 'b', hours: '1,5', price: '900', label: '', sort_order: 1 },
    ]);
    expect(r.errors).toEqual({});
    expect(r.tiers).toEqual([
      { hours: 1.5, price: 900, label: '', sort_order: 1 },
      { hours: 10, price: 5500, label: 'Best Value', sort_order: 2 },
    ]);
  });

  test('0h or blank tiers are rejected per tier, nothing returned', () => {
    const r = validateTierDrafts([
      { key: 'a', hours: '0', price: '100', label: '', sort_order: 0 },
      { key: 'b', hours: '5', price: '', label: '', sort_order: 1 },
      { key: 'c', hours: '5', price: '3000', label: '', sort_order: 2 },
    ]);
    expect(r.tiers).toBeNull();
    expect(r.errors).toEqual({
      a: { hours: 'Must be more than 0' },
      b: { price: 'Required' },
    });
  });
});

describe('backupErrorMessage', () => {
  test('maps BackupError codes to friendly copy', () => {
    const e = Object.assign(new Error('x'), { name: 'BackupError', code: 'NOT_SQLITE' });
    expect(backupErrorMessage(e)).toMatch(/isn't an HourBank backup/);
    expect(backupErrorMessage(Object.assign(new Error('x'), { name: 'BackupError', code: 'NEWER_VERSION' }))).toMatch(/newer version/);
    expect(backupErrorMessage(Object.assign(new Error('x'), { name: 'BackupError', code: 'RESTORE_FAILED' }))).toMatch(/previous data was kept/);
  });
  test('unknown errors get a generic message', () => {
    expect(backupErrorMessage(new Error('boom'))).toBe("Couldn't read that file. Try again or pick another backup.");
  });
  test('empty old-version backups and partial ones get distinct copy', () => {
    const be = (code: string) => Object.assign(new Error('x'), { name: 'BackupError', code });
    expect(backupErrorMessage(be('EMPTY_BACKUP'))).toMatch(/backup file is empty/);
    expect(backupErrorMessage(be('MISSING_TABLES'))).toMatch(/missing part of HourBank's data/);
    expect(backupErrorMessage(be('UNREADABLE'))).toMatch(/Couldn't open that file/);
  });
});

describe('backupErrorDetail', () => {
  test('code plus detail for BackupErrors', () => {
    const e = Object.assign(new Error('x'), { name: 'BackupError', code: 'MISSING_TABLES', detail: 'missing ledger_entries · found students · 8 KB' });
    expect(backupErrorDetail(e)).toBe('MISSING_TABLES · missing ledger_entries · found students · 8 KB');
    expect(backupErrorDetail(Object.assign(new Error('x'), { name: 'BackupError', code: 'CORRUPT' }))).toBe('CORRUPT');
  });
  test('other errors show their message', () => {
    expect(backupErrorDetail(new Error('boom'))).toBe('UNKNOWN · boom');
  });
});

describe('billing rounding', () => {
  test('options', () => expect(BILLING_ROUND_OPTIONS).toEqual([5, 10, 15, 30]));
  test('explanation names tolerance and unit', () => {
    expect(billingRoundingExplanation(10)).toBe(
      'If a lesson runs within 15 min of its booked length, the booked length is billed. Otherwise the actual time is rounded to the nearest 10 min. You can always adjust before saving.'
    );
  });
});

describe('restore summary', () => {
  test('lines', () => {
    const lines = restoreSummaryLines({
      students: 7, activeStudents: 5, sessions: 40, ledgerRows: 52,
      lastEntryAt: new Date(2026, 9, 3, 10, 0).toISOString(),
      proofImages: 2, exportedAt: new Date(2026, 9, 4, 8, 0).toISOString(), migrationVersions: [],
    });
    expect(lines).toEqual([
      ['Students', '7 (5 active)'],
      ['Lessons', '40'],
      ['Ledger entries', '52'],
      ['Last entry', 'Sat 3 Oct 2026'],
      ['Backup created', 'Sun 4 Oct 2026'],
    ]);
  });
  test('older-version backups (no exported_at) say so', () => {
    const lines = restoreSummaryLines({
      students: 1, activeStudents: 1, sessions: 1, ledgerRows: 2, lastEntryAt: null,
      proofImages: 0, exportedAt: null, migrationVersions: ['002_post_grilling'],
    });
    expect(lines[lines.length - 1]).toEqual(['Backup created', 'Older app version — check Last entry']);
  });
  test('confirm word', () => expect(RESTORE_CONFIRM_WORD).toBe('RESTORE'));
});
