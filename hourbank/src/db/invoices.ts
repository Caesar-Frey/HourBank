/**
 * Invoices (F2). An invoice asks a parent to pay before credit is added. It is
 * created from the top-up screen, shared as a PDF, and later marked paid by
 * recording the top-up it asked for. Numbers are unique and never reused; a
 * cancelled invoice keeps its number. Every printed value is snapshotted so a
 * re-shared invoice never changes when Settings or the student change.
 */
import { getDb } from './client';
import { newId } from './uuid';
import { getOrCreateTutorProfile, getTutorProfile, type TutorProfile } from './tutorProfile';
import { getStudent } from './students';
import { buildPaymentReference } from '../utils/paymentReference';

export type InvoiceStatus = 'unpaid' | 'paid' | 'cancelled';

/** Everything printed on the invoice, frozen at issue. */
export type InvoiceSnapshot = {
  business: {
    name: string | null;
    regNo: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    logoDataUri: string | null;
  };
  bank: {
    holder: string | null;
    bank: string | null;
    accountNo: string | null;
    branchCode: string | null;
    swift: string | null;
  };
  billedTo: { name: string | null; phone: string | null };
  student: { name: string; grade: number | null };
  reference: string;
};

export type Invoice = {
  id: string;
  number: number;
  student_id: string;
  subject_id: string | null;
  issued_at: string;
  due_at: string;
  status: InvoiceStatus;
  status_changed_at: string | null;
  package_id: string | null;
  hours: number;
  total_rand: number;
  travel_rand: number;
  snapshot: string;
  created_at: string;
};

export type InvoiceLine = {
  id: string;
  invoice_id: string;
  sort_order: number;
  item: string;
  description: string;
  qty_hours: number | null;
  rate_rand: number | null;
  amount_rand: number;
};

export type InvoiceErrorCode = 'INVALID' | 'NOT_FOUND' | 'NOT_UNPAID' | 'NUMBER_TAKEN';

export class InvoiceError extends Error {
  constructor(public code: InvoiceErrorCode, message: string) {
    super(message);
    this.name = 'InvoiceError';
  }
}

export function isInvoiceError(e: unknown): e is InvoiceError {
  return e instanceof InvoiceError;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export type InvoiceSettings = {
  business_name: string | null;
  business_reg_no: string | null;
  business_phone: string | null;
  business_email: string | null;
  business_address: string | null;
  logo_data_uri: string | null;
  bank_account_holder: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_branch_code: string | null;
  bank_swift: string | null;
  invoice_next_number: number;
  invoice_due_days: number;
};

const TEXT_KEYS = [
  'business_name', 'business_reg_no', 'business_phone', 'business_email', 'business_address',
  'logo_data_uri', 'bank_account_holder', 'bank_name', 'bank_account_no', 'bank_branch_code', 'bank_swift',
] as const;

type ProfileWithInvoice = TutorProfile & Partial<InvoiceSettings>;

function clean(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

export function getInvoiceSettings(): InvoiceSettings {
  const p = getOrCreateTutorProfile() as ProfileWithInvoice;
  const out = {} as InvoiceSettings;
  for (const k of TEXT_KEYS) (out as Record<string, unknown>)[k] = clean(p[k] as string | null | undefined);
  out.invoice_next_number = Math.max(1, Math.floor(p.invoice_next_number ?? 1));
  out.invoice_due_days = Math.max(0, Math.floor(p.invoice_due_days ?? 7));
  return out;
}

/** Highest number ever issued (cancelled included), or 0. */
export function highestInvoiceNumber(): number {
  return getDb().getFirstSync<{ n: number | null }>('SELECT MAX(number) AS n FROM invoices')?.n ?? 0;
}

/** Save some settings. A next number at or below one already issued is refused. */
export function updateInvoiceSettings(patch: Partial<InvoiceSettings>): InvoiceSettings {
  const p = getOrCreateTutorProfile();
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  for (const k of TEXT_KEYS) {
    if (k in patch) {
      sets.push(`${k} = ?`);
      params.push(clean(patch[k] as string | null | undefined));
    }
  }
  if (patch.invoice_next_number !== undefined) {
    const n = Math.floor(patch.invoice_next_number);
    if (!Number.isFinite(n) || n < 1) throw new InvoiceError('INVALID', 'Invoice number must be 1 or more');
    if (n <= highestInvoiceNumber()) throw new InvoiceError('NUMBER_TAKEN', `Invoice ${n} has already been used`);
    sets.push('invoice_next_number = ?');
    params.push(n);
  }
  if (patch.invoice_due_days !== undefined) {
    const d = Math.floor(patch.invoice_due_days);
    if (!Number.isFinite(d) || d < 0 || d > 365) throw new InvoiceError('INVALID', 'Due days must be 0 to 365');
    sets.push('invoice_due_days = ?');
    params.push(d);
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    params.push(new Date().toISOString(), p.id);
    getDb().runSync(`UPDATE tutor_profile SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  return getInvoiceSettings();
}

/** True when enough bank details are saved to print "Please make payment to". */
export function hasBankDetails(s: Pick<InvoiceSettings, 'bank_name' | 'bank_account_no'>): boolean {
  return !!(s.bank_name && s.bank_account_no);
}

/** WhatsApp payment block from the structured bank fields, or null when not filled in. */
export function bankDetailsText(s: InvoiceSettings): string | null {
  if (!hasBankDetails(s)) return null;
  return [
    s.bank_account_holder,
    s.bank_name,
    `Account no. ${s.bank_account_no}`,
    s.bank_branch_code ? `Branch code: ${s.bank_branch_code}` : null,
    s.bank_swift ? `BIC/SWIFT: ${s.bank_swift}` : null,
  ].filter(Boolean).join('\n');
}

// ─── Lines ───────────────────────────────────────────────────────────────────

export type InvoiceLineInput = Omit<InvoiceLine, 'id' | 'invoice_id' | 'sort_order'>;

/**
 * One "Tutoring" line for the hours (Rate = amount ÷ hours, so QTY × Rate =
 * Amount even for a discounted package) and an optional "Travel" line.
 */
export function buildInvoiceLines(i: {
  subjectName: string | null;
  hours: number;
  amountRand: number;
  travelRand?: number;
  travelLessons?: number;
}): InvoiceLineInput[] {
  const lines: InvoiceLineInput[] = [];
  if (i.hours > 0 && i.amountRand > 0) {
    lines.push({
      item: 'Tutoring',
      description: `${i.subjectName?.trim() || 'Tutoring'} Lesson`,
      qty_hours: i.hours,
      rate_rand: Math.round((i.amountRand / i.hours) * 100) / 100,
      amount_rand: i.amountRand,
    });
  }
  if (i.travelRand && i.travelRand > 0) {
    const n = i.travelLessons ?? 0;
    lines.push({
      item: 'Travel',
      description: n > 0 ? `${n} in-person ${n === 1 ? 'lesson' : 'lessons'}` : 'Travel',
      qty_hours: null,
      rate_rand: null,
      amount_rand: i.travelRand,
    });
  }
  return lines;
}

// ─── Create / read ───────────────────────────────────────────────────────────

export type CreateInvoiceInput = {
  studentId: string;
  subjectId?: string | null;
  subjectName?: string | null;
  hours: number;
  amountRand: number;
  travelRand?: number;
  travelLessons?: number;
  now?: Date;
};

function snapshotFor(studentId: string, settings: InvoiceSettings, now: Date): InvoiceSnapshot {
  const s = getStudent(studentId, { includeArchived: true });
  if (!s) throw new InvoiceError('NOT_FOUND', 'Student not found');
  const template = getTutorProfile()?.payment_reference_template;
  const parent = s.parent_name?.trim() || null;
  return {
    business: {
      name: settings.business_name,
      regNo: settings.business_reg_no,
      phone: settings.business_phone,
      email: settings.business_email,
      address: settings.business_address,
      logoDataUri: settings.logo_data_uri,
    },
    bank: {
      holder: settings.bank_account_holder,
      bank: settings.bank_name,
      accountNo: settings.bank_account_no,
      branchCode: settings.bank_branch_code,
      swift: settings.bank_swift,
    },
    billedTo: {
      name: parent ?? s.full_name,
      phone: (parent ? s.parent_phone : s.student_phone ?? s.parent_phone)?.trim() || null,
    },
    student: { name: s.full_name, grade: s.grade ?? null },
    reference: buildPaymentReference(template, s, now),
  };
}

export function createInvoice(input: CreateInvoiceInput): { invoice: Invoice; lines: InvoiceLine[] } {
  const now = input.now ?? new Date();
  const lines = buildInvoiceLines({
    subjectName: input.subjectName ?? null,
    hours: input.hours,
    amountRand: input.amountRand,
    travelRand: input.travelRand,
    travelLessons: input.travelLessons,
  });
  if (lines.length === 0) throw new InvoiceError('INVALID', 'Nothing to invoice');
  const total = Math.round(lines.reduce((a, l) => a + l.amount_rand, 0) * 100) / 100;
  const db = getDb();
  let result: { invoice: Invoice; lines: InvoiceLine[] } | null = null;
  db.withTransactionSync(() => {
    const settings = getInvoiceSettings();
    // Gapless from the tutor's chosen start, never reusing a number.
    const number = Math.max(settings.invoice_next_number, highestInvoiceNumber() + 1);
    const due = new Date(now);
    due.setDate(due.getDate() + settings.invoice_due_days);
    const invoice: Invoice = {
      id: newId(),
      number,
      student_id: input.studentId,
      subject_id: input.subjectId ?? null,
      issued_at: now.toISOString(),
      due_at: due.toISOString(),
      status: 'unpaid',
      status_changed_at: null,
      package_id: null,
      hours: input.hours,
      total_rand: total,
      travel_rand: input.travelRand && input.travelRand > 0 ? input.travelRand : 0,
      snapshot: JSON.stringify(snapshotFor(input.studentId, settings, now)),
      created_at: now.toISOString(),
    };
    db.runSync(
      `INSERT INTO invoices (id, number, student_id, subject_id, issued_at, due_at, status, status_changed_at, package_id, hours, total_rand, travel_rand, snapshot, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'unpaid', NULL, NULL, ?, ?, ?, ?, ?)`,
      [invoice.id, invoice.number, invoice.student_id, invoice.subject_id, invoice.issued_at, invoice.due_at,
        invoice.hours, invoice.total_rand, invoice.travel_rand, invoice.snapshot, invoice.created_at]
    );
    const stored: InvoiceLine[] = lines.map((l, i) => ({ ...l, id: newId(), invoice_id: invoice.id, sort_order: i }));
    for (const l of stored) {
      db.runSync(
        `INSERT INTO invoice_lines (id, invoice_id, sort_order, item, description, qty_hours, rate_rand, amount_rand)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [l.id, l.invoice_id, l.sort_order, l.item, l.description, l.qty_hours, l.rate_rand, l.amount_rand]
      );
    }
    db.runSync('UPDATE tutor_profile SET invoice_next_number = ?', [number + 1]);
    result = { invoice, lines: stored };
  });
  return result!;
}

export function getInvoice(id: string): Invoice | null {
  return getDb().getFirstSync<Invoice>('SELECT * FROM invoices WHERE id = ?', [id]) ?? null;
}

export function getInvoiceLines(id: string): InvoiceLine[] {
  return getDb().getAllSync<InvoiceLine>('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order', [id]);
}

export function parseSnapshot(inv: Pick<Invoice, 'snapshot'>): InvoiceSnapshot {
  return JSON.parse(inv.snapshot) as InvoiceSnapshot;
}

/** Newest first. */
export function listInvoicesForStudent(studentId: string): Invoice[] {
  return getDb().getAllSync<Invoice>(
    'SELECT * FROM invoices WHERE student_id = ? ORDER BY issued_at DESC, number DESC',
    [studentId]
  );
}

export type OverdueInvoice = Invoice & { student_name: string };

/** Unpaid invoices past their due date (for Home's needs-attention card). */
export function listOverdueInvoices(now: Date = new Date()): OverdueInvoice[] {
  return getDb().getAllSync<OverdueInvoice>(
    `SELECT i.*, s.full_name AS student_name FROM invoices i JOIN students s ON s.id = i.student_id
      WHERE i.status = 'unpaid' AND i.due_at < ? AND s.status != 'archived'
      ORDER BY i.due_at ASC`,
    [now.toISOString()]
  );
}

function setStatus(id: string, from: InvoiceStatus, to: InvoiceStatus, packageId: string | null = null): void {
  const inv = getInvoice(id);
  if (!inv) throw new InvoiceError('NOT_FOUND', 'Invoice not found');
  if (inv.status !== from) throw new InvoiceError('NOT_UNPAID', `Invoice ${inv.number} is ${inv.status}`);
  getDb().runSync(
    'UPDATE invoices SET status = ?, status_changed_at = ?, package_id = COALESCE(?, package_id) WHERE id = ?',
    [to, new Date().toISOString(), packageId, id]
  );
}

export function cancelInvoice(id: string): void {
  setStatus(id, 'unpaid', 'cancelled');
}

/** Link the top-up that paid this invoice. Called inside or after the top-up save. */
export function markInvoicePaid(id: string, packageId: string): void {
  setStatus(id, 'unpaid', 'paid', packageId);
}

/** UNPAID, OVERDUE, PAID or CANCELLED, for the student page. */
export function invoiceStatusLabel(inv: Pick<Invoice, 'status' | 'due_at'>, now: Date = new Date()): string {
  if (inv.status === 'paid') return 'PAID';
  if (inv.status === 'cancelled') return 'CANCELLED';
  return new Date(inv.due_at) < now ? 'OVERDUE' : 'UNPAID';
}

/** "0027" — four digits, more when needed. */
export function invoiceNumberLabel(n: number): string {
  return String(n).padStart(4, '0');
}

/**
 * Payment block for WhatsApp messages: the structured bank fields when they
 * are filled in, otherwise the free-text "Payment details" from Settings.
 */
export function paymentDetailsForMessages(): string | null {
  const structured = bankDetailsText(getInvoiceSettings());
  return structured ?? (getTutorProfile()?.payment_details?.trim() || null);
}
