import { getDb } from './client';
import { CreditPackage, LedgerEntry, TravelSettlement } from './schema';
import { appendEntryInTx } from './ledger';
import { newId } from './uuid';
import { resolveSubjectIdInTx } from './subjects';
import { settleTravelInTx } from './travel';

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
  /** Subject the hours are for; omitted = the student's primary subject. */
  subjectId?: string | null;
  hoursAdded: number;
  amountPaid: number;
  paymentMethod: CreditPackage['payment_method'];
  paymentRef?: string;
  proofImageUri?: string;
  notes?: string;
  /** When the parent paid (B1). Omitted = now. Must not be in the future. */
  paidAt?: string;
  /** Travel owed paid in the same payment: settled in the SAME transaction (B2). */
  travelAmount?: number;
}): { pkg: CreditPackage; entry: LedgerEntry; travel: TravelSettlement | null } {
  const db = getDb();
  const id = data.id ?? newId();
  const nowDate = new Date();
  const paid = data.paidAt ? new Date(data.paidAt) : nowDate;
  if (Number.isNaN(paid.getTime())) throw new Error('Invalid payment date');
  const now = (paid.getTime() > nowDate.getTime() ? nowDate : paid).toISOString();

  let pkg: CreditPackage;
  let entry: LedgerEntry;
  let travel: TravelSettlement | null = null;

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
        travel = db.getFirstSync<TravelSettlement>(
          'SELECT * FROM travel_settlements WHERE package_id = ? ORDER BY created_at ASC LIMIT 1',
          [id]
        ) ?? null;
        return;
      }
    }

    const subjectId = resolveSubjectIdInTx(data.studentId, data.subjectId);
    db.runSync(
      `INSERT INTO credit_packages (id, student_id, hours_added, amount_paid, payment_method, payment_ref, proof_image_uri, notes, created_at, subject_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        subjectId,
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
      subject_id: subjectId,
    };

    entry = appendEntryInTx({
      studentId: data.studentId,
      type: 'top_up',
      hoursDelta: data.hoursAdded,
      relatedPackageId: id,
      subjectId,
      createdAt: now,
    });

    if (data.travelAmount && data.travelAmount > 0) {
      travel = settleTravelInTx({
        studentId: data.studentId,
        amount: data.travelAmount,
        packageId: id,
        method: data.paymentMethod,
        now: new Date(now),
      });
    }
  });

  return { pkg: pkg!, entry: entry!, travel };
}
