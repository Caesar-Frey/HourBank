import { getDb } from './client';
import { CreditPackage, LedgerEntry } from './schema';
import { appendEntry } from './ledger';

export function createPackage(data: {
  studentId: string;
  hoursAdded: number;
  amountPaid: number;
  paymentMethod: CreditPackage['payment_method'];
  paymentRef?: string;
  proofImageUri?: string;
  notes?: string;
}): { pkg: CreditPackage; entry: LedgerEntry } {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  let pkg: CreditPackage;
  let entry: LedgerEntry;

  db.withTransactionSync(() => {
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

    entry = appendEntry({
      studentId: data.studentId,
      type: 'top_up',
      hoursDelta: data.hoursAdded,
      relatedPackageId: id,
    });
  });

  return { pkg: pkg!, entry: entry! };
}
