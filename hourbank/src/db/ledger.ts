import { getDb } from './client';
import { LedgerEntry, CreditPackage } from './schema';
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

export type LedgerEntryDetail = LedgerEntry & {
  package?: CreditPackage;
  studentName?: string;
};

export function getLedgerEntryById(id: string): LedgerEntryDetail | null {
  const db = getDb();
  type RawRow = {
    // ledger_entries columns
    l_id: string;
    l_student_id: string;
    l_type: LedgerEntry['type'];
    l_hours_delta: number;
    l_balance_after: number;
    l_related_session_id: string | null;
    l_related_package_id: string | null;
    l_reason: string | null;
    l_created_at: string;
    // credit_packages columns (nullable when no package)
    p_id: string | null;
    p_student_id: string | null;
    p_hours_added: number | null;
    p_amount_paid: number | null;
    p_payment_method: string | null;
    p_payment_ref: string | null;
    p_proof_image_uri: string | null;
    p_notes: string | null;
    p_created_at: string | null;
    // student name
    student_name: string | null;
  };

  const row = db.getFirstSync<RawRow>(
    `SELECT
       l.id            AS l_id,
       l.student_id    AS l_student_id,
       l.type          AS l_type,
       l.hours_delta   AS l_hours_delta,
       l.balance_after AS l_balance_after,
       l.related_session_id AS l_related_session_id,
       l.related_package_id AS l_related_package_id,
       l.reason        AS l_reason,
       l.created_at    AS l_created_at,
       p.id            AS p_id,
       p.student_id    AS p_student_id,
       p.hours_added   AS p_hours_added,
       p.amount_paid   AS p_amount_paid,
       p.payment_method AS p_payment_method,
       p.payment_ref   AS p_payment_ref,
       p.proof_image_uri AS p_proof_image_uri,
       p.notes         AS p_notes,
       p.created_at    AS p_created_at,
       s.full_name     AS student_name
     FROM ledger_entries l
     LEFT JOIN credit_packages p ON p.id = l.related_package_id
     LEFT JOIN students s ON s.id = l.student_id
     WHERE l.id = ?`,
    [id]
  );

  if (!row) return null;

  const entry: LedgerEntryDetail = {
    id: row.l_id,
    student_id: row.l_student_id,
    type: row.l_type,
    hours_delta: row.l_hours_delta,
    balance_after: row.l_balance_after,
    related_session_id: row.l_related_session_id,
    related_package_id: row.l_related_package_id,
    reason: row.l_reason,
    created_at: row.l_created_at,
    studentName: row.student_name ?? undefined,
  };

  if (row.p_id) {
    entry.package = {
      id: row.p_id,
      student_id: row.p_student_id!,
      hours_added: row.p_hours_added!,
      amount_paid: row.p_amount_paid!,
      payment_method: row.p_payment_method as CreditPackage['payment_method'],
      payment_ref: row.p_payment_ref,
      proof_image_uri: row.p_proof_image_uri,
      notes: row.p_notes,
      created_at: row.p_created_at!,
    };
  }

  return entry;
}
