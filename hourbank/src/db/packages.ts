import { getDb } from './client';
import { CreditPackage, LedgerEntry } from './schema';
import { appendEntryInTx } from './ledger';
import { newId } from './uuid';

/**
 * Record a top-up: credit package + ledger entry in one transaction.
 *
 * `id` (optional) makes the call idempotent: the top-up screen generates it on
 * mount, so a double-submit (or a retry after an ambiguous failure) returns the
 * already-recorded package instead of crediting the hours twice.
 */
export function createPackage(data: {
  id?: string;
  studentId: string;
  hoursAdded: number;
  amountPaid: number;
  paymentMethod: CreditPackage['payment_method'];
  paymentRef?: string;
  proofImageUri?: string;
  notes?: string;
}): { pkg: CreditPackage; entry: LedgerEntry } {
  const db = getDb();
  const id = data.id ?? newId();
  const now = new Date().toISOString();

  let pkg: CreditPackage;
  let entry: LedgerEntry;

  db.withTransactionSync(() => {
    if (data.id) {
      const existing = db.getFirstSync<CreditPackage>('SELECT * FROM credit_packages WHERE id = ?', [id]);
      if (existing) {
        const existingEntry = db.getFirstSync<LedgerEntry>(
          `SELECT * FROM ledger_entries WHERE related_package_id = ? AND type = 'top_up' ORDER BY created_at ASC LIMIT 1`,
          [id]
        );
        if (existing.student_id !== data.studentId || !existingEntry) {
          throw new Error(`Package ${id} already exists`);
        }
        pkg = existing;
        entry = existingEntry;
        return;
      }
    }

    db.runSync(
      `INSERT INTO credit_packages (id, student_id, hours_added, amount_paid, payment_method, payment_ref, proof_image_uri, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.studentId,
        data.hoursAdded,
        data.amountPaid,
        data.paymentMethod,
        data.paymentRef ?? null,
        data.proofImageUri ?? null,
        data.notes ?? null,
        now,
      ]
    );

    pkg = {
      id,
      student_id: data.studentId,
      hours_added: data.hoursAdded,
      amount_paid: data.amountPaid,
      payment_method: data.paymentMethod,
      payment_ref: data.paymentRef ?? null,
      proof_image_uri: data.proofImageUri ?? null,
      notes: data.notes ?? null,
      created_at: now,
    };

    entry = appendEntryInTx({
      studentId: data.studentId,
      type: 'top_up',
      hoursDelta: data.hoursAdded,
      relatedPackageId: id,
    });
  });

  return { pkg: pkg!, entry: entry! };
}
