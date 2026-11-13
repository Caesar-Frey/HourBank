/**
 * F2 — invoices.
 */
import { createMigratedTestDb, createTestDb, resetDbSingleton } from './testDb';
import { getDb } from '../client';
import { createStudent } from '../students';
import { createPackage } from '../packages';
import { upsertTutorProfile } from '../tutorProfile';
import { ALL_MIGRATIONS, MIGRATION_015_INVOICES, runMigrations } from '../migrations';
import {
  bankDetailsText, buildInvoiceLines, cancelInvoice, createInvoice, getInvoice, getInvoiceSettings, InvoiceError,
  invoiceStatusLabel, listInvoicesForStudent, listOverdueInvoices, markInvoicePaid, parseSnapshot, updateInvoiceSettings,
} from '../invoices';
import { buildInvoiceHtml } from '../../utils/invoicePdf';
import { formatRandDocument, formatDateDocument } from '../../utils/format';

const base = { fullName: 'Amahle Dlamini', grade: 11, subject: 'Mathematics', curriculum: 'CAPS' as const, parentName: 'Thandi Dlamini', parentPhone: '0821234567' };

describe('F2 — invoices', () => {
  beforeEach(() => { createMigratedTestDb(); upsertTutorProfile({ full_name: 'Tutor' }); });
  afterEach(() => resetDbSingleton());

  it('numbers are gapless, unique and never reused after a cancel', () => {
    const s = createStudent(base);
    const a = createInvoice({ studentId: s.id, hours: 10, amountRand: 2000 }).invoice;
    cancelInvoice(a.id);
    const b = createInvoice({ studentId: s.id, hours: 5, amountRand: 1000 }).invoice;
    expect([a.number, b.number]).toEqual([1, 2]);
    expect(getInvoiceSettings().invoice_next_number).toBe(3);
  });

  it('continues an existing sequence but refuses a number already used', () => {
    const s = createStudent(base);
    updateInvoiceSettings({ invoice_next_number: 27 });
    expect(createInvoice({ studentId: s.id, hours: 1, amountRand: 200 }).invoice.number).toBe(27);
    expect(() => updateInvoiceSettings({ invoice_next_number: 27 })).toThrow(InvoiceError);
    expect(() => updateInvoiceSettings({ invoice_next_number: 10 })).toThrow(InvoiceError);
    updateInvoiceSettings({ invoice_next_number: 40 });
    expect(createInvoice({ studentId: s.id, hours: 1, amountRand: 200 }).invoice.number).toBe(40);
  });

  it('the snapshot does not change when Settings or the student change', () => {
    const s = createStudent(base);
    updateInvoiceSettings({ business_name: 'Old Name', bank_name: 'Bank A', bank_account_no: '123' });
    const { invoice } = createInvoice({ studentId: s.id, hours: 10, amountRand: 2000 });
    updateInvoiceSettings({ business_name: 'New Name', bank_name: 'Bank B' });
    getDb().runSync("UPDATE students SET parent_name = 'Someone Else' WHERE id = ?", [s.id]);
    const snap = parseSnapshot(getInvoice(invoice.id)!);
    expect(snap.business.name).toBe('Old Name');
    expect(snap.bank.bank).toBe('Bank A');
    expect(snap.billedTo.name).toBe('Thandi Dlamini');
  });

  it('QTY × Rate = Amount for a discounted package', () => {
    const [l] = buildInvoiceLines({ subjectName: 'Maths', hours: 10, amountRand: 5500 });
    expect(l.qty_hours! * l.rate_rand!).toBe(l.amount_rand);
    const [m] = buildInvoiceLines({ subjectName: 'Maths', hours: 3, amountRand: 1000 });
    expect(Math.abs(m.qty_hours! * m.rate_rand! - m.amount_rand)).toBeLessThan(0.02);
  });

  it('adds a travel line and totals both', () => {
    const s = createStudent(base);
    const { invoice, lines } = createInvoice({ studentId: s.id, subjectName: 'Maths', hours: 10, amountRand: 2000, travelRand: 150, travelLessons: 3 });
    expect(lines.map(l => [l.item, l.description])).toEqual([['Tutoring', 'Maths Lesson'], ['Travel', '3 in-person lessons']]);
    expect(invoice.total_rand).toBe(2150);
  });

  it('recording payment links the top-up and marks it paid; only unpaid can change', () => {
    const s = createStudent(base);
    const { invoice } = createInvoice({ studentId: s.id, hours: 10, amountRand: 2000 });
    const { pkg } = createPackage({ studentId: s.id, hoursAdded: 10, amountPaid: 2000, paymentMethod: 'eft' });
    markInvoicePaid(invoice.id, pkg.id);
    const paid = getInvoice(invoice.id)!;
    expect(paid.status).toBe('paid');
    expect(paid.package_id).toBe(pkg.id);
    expect(() => cancelInvoice(invoice.id)).toThrow(InvoiceError);
  });

  it('lists overdue unpaid invoices and labels status', () => {
    const s = createStudent(base);
    const issued = new Date('2026-11-01T10:00:00.000Z');
    const { invoice } = createInvoice({ studentId: s.id, hours: 1, amountRand: 200, now: issued });
    expect(listOverdueInvoices(new Date('2026-11-05T10:00:00.000Z'))).toHaveLength(0);
    expect(listOverdueInvoices(new Date('2026-11-09T10:00:00.000Z')).map(i => i.id)).toEqual([invoice.id]);
    expect(invoiceStatusLabel(invoice, new Date('2026-11-09T10:00:00.000Z'))).toBe('OVERDUE');
    expect(listInvoicesForStudent(s.id)).toHaveLength(1);
  });

  it('bank text comes from the structured fields when filled', () => {
    expect(bankDetailsText(getInvoiceSettings())).toBeNull();
    const s = updateInvoiceSettings({ bank_account_holder: 'A Holder', bank_name: 'Bank', bank_account_no: '1', bank_branch_code: '2' });
    expect(bankDetailsText(s)).toBe('A Holder\nBank\nAccount no. 1\nBranch code: 2');
  });

  it('renders the invoice HTML from the snapshot, escaped', () => {
    const s = createStudent({ ...base, fullName: 'A <b>Kid</b>' });
    updateInvoiceSettings({ business_name: 'My Tutoring', bank_name: 'Bank', bank_account_no: '123' });
    const { invoice, lines } = createInvoice({ studentId: s.id, subjectName: 'Maths', hours: 10, amountRand: 2000, travelRand: 150, travelLessons: 3 });
    const html = buildInvoiceHtml(invoice, lines, parseSnapshot(invoice));
    expect(html).toContain('INVOICE');
    expect(html).toContain('Invoice No. 0001');
    expect(html).toContain('R2 150');
    expect(html).toContain('Please make payment to:');
    expect(html).toContain('A &lt;b&gt;Kid&lt;/b&gt;');
    expect(html).not.toContain('<b>Kid');
  });
});

describe('document formatters', () => {
  it('formats rand the way the owner’s invoice does', () => {
    expect(formatRandDocument(2000)).toBe('R2 000');
    expect(formatRandDocument(150)).toBe('R150');
    expect(formatRandDocument(2000.5)).toBe('R2 000.50');
    expect(formatDateDocument(new Date(2026, 10, 12))).toBe('12 November 2026');
  });
});

describe('migration 015', () => {
  afterEach(() => resetDbSingleton());
  it('adds the tables and settings to an existing database, idempotently', () => {
    createTestDb();
    runMigrations(ALL_MIGRATIONS.slice(0, ALL_MIGRATIONS.indexOf(MIGRATION_015_INVOICES)));
    upsertTutorProfile({ full_name: 'Tutor' });
    runMigrations(ALL_MIGRATIONS);
    runMigrations(ALL_MIGRATIONS);
    expect(getInvoiceSettings()).toEqual(expect.objectContaining({ invoice_next_number: 1, invoice_due_days: 7, business_name: null }));
    expect(getDb().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM invoices')!.n).toBe(0);
  });
});
