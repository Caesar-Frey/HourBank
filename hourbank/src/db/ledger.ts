import { getDb } from './client';
import { LedgerEntry } from './schema';
import { newId } from './uuid';

export function currentBalance(studentId: string): number {
  const db = getDb();
  const row = db.getFirstSync<{ balance: number }>(
    'SELECT COALESCE(SUM(hours_delta), 0) AS balance FROM ledger_entries WHERE student_id = ?',
    [studentId]
  );
  return row?.balance ?? 0;
}

type AppendEntryInput = {
  studentId: string;
  type: LedgerEntry['type'];
  hoursDelta: number;
  relatedSessionId?: string;
  relatedPackageId?: string;
  reason?: string;
};

// Use this inside an existing withTransactionSync block to avoid nesting.
export function appendEntryInTx(entry: AppendEntryInput): LedgerEntry {
  const db = getDb();
  const currentBal = currentBalance(entry.studentId);
  const balanceAfter = currentBal + entry.hoursDelta;
  const id = newId();
  const createdAt = new Date().toISOString();

  db.runSync(
    `INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, related_session_id, related_package_id, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      entry.studentId,
      entry.type,
      entry.hoursDelta,
      balanceAfter,
      entry.relatedSessionId ?? null,
      entry.relatedPackageId ?? null,
      entry.reason ?? null,
      createdAt,
    ]
  );

  return {
    id,
    student_id: entry.studentId,
    type: entry.type,
    hours_delta: entry.hoursDelta,
    balance_after: balanceAfter,
    related_session_id: entry.relatedSessionId ?? null,
    related_package_id: entry.relatedPackageId ?? null,
    reason: entry.reason ?? null,
    created_at: createdAt,
  };
}

export function appendEntry(entry: AppendEntryInput): LedgerEntry {
  let result: LedgerEntry | null = null;
  getDb().withTransactionSync(() => {
    result = appendEntryInTx(entry);
  });
  return result!;
}

export function getBalanceAt(studentId: string, isoTimestamp: string): number {
  const db = getDb();
  const row = db.getFirstSync<{ balance: number }>(
    'SELECT COALESCE(SUM(hours_delta), 0) AS balance FROM ledger_entries WHERE student_id = ? AND created_at <= ?',
    [studentId, isoTimestamp]
  );
  return row?.balance ?? 0;
}

export function lastNEntries(studentId: string, n: number): LedgerEntry[] {
  const db = getDb();
  return db.getAllSync<LedgerEntry>(
    'SELECT * FROM ledger_entries WHERE student_id = ? ORDER BY created_at DESC LIMIT ?',
    [studentId, n]
  );
}
