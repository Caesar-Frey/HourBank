/**
 * Invoice PDF (F2, mockup M8), built on the shared document frame.
 * Everything printed comes from the invoice's snapshot, never live settings.
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { buildDocumentHtml, businessFooter } from './documentHtml';
import { formatDateDocument, formatRandDocument } from './format';
import {
  getInvoice, getInvoiceLines, getInvoiceSettings, invoiceNumberLabel, parseSnapshot,
  type Invoice, type InvoiceLine, type InvoiceSettings, type InvoiceSnapshot,
} from '../db/invoices';

/** QTY as printed: "10", "1.5"; a dash when there is none. */
function qtyLabel(h: number | null): string {
  if (h == null) return '—';
  return String(Math.round(h * 100) / 100);
}

export function buildInvoiceHtml(inv: Pick<Invoice, 'number' | 'issued_at' | 'due_at' | 'total_rand'>, lines: Array<Pick<InvoiceLine, 'item' | 'description' | 'qty_hours' | 'rate_rand' | 'amount_rand'>>, snap: InvoiceSnapshot): string {
  const b = snap.bank;
  const payment = b.bank && b.accountNo
    ? [
        b.holder,
        b.bank,
        `Account no. ${b.accountNo}`,
        b.branchCode ? `Branch code: ${b.branchCode}` : null,
        b.swift ? `BIC/SWIFT: ${b.swift}` : null,
      ].filter((x): x is string => !!x)
    : null;
  const left: Array<{ text: string; strong?: boolean }> = [];
  if (snap.billedTo.name) left.push({ text: snap.billedTo.name });
  if (snap.billedTo.phone) left.push({ text: `Cell: ${snap.billedTo.phone}`, strong: true });
  left.push({ text: `Student Name: ${snap.student.name}`, strong: true });
  if (snap.student.grade) left.push({ text: `Grade ${snap.student.grade}`, strong: true });

  return buildDocumentHtml({
    title: 'INVOICE',
    logoDataUri: snap.business.logoDataUri,
    brandName: snap.business.name,
    left: { heading: 'BILLED TO:', lines: left },
    right: [
      `Invoice No. ${invoiceNumberLabel(inv.number)}`,
      formatDateDocument(inv.issued_at),
      `Reference: ${snap.reference}`,
    ],
    table: {
      columns: [
        { label: 'Item', width: '17%' },
        { label: 'Description', align: 'left' },
        { label: 'QTY (Hrs)', width: '12%' },
        { label: 'Rate', width: '14%' },
        { label: 'Amount Due', width: '18%' },
      ],
      rows: lines.map(l => [
        l.item,
        l.description,
        qtyLabel(l.qty_hours),
        l.rate_rand == null ? '—' : formatRandDocument(l.rate_rand),
        formatRandDocument(l.amount_rand),
      ]),
      minHeight: 330,
    },
    payment,
    total: { label: 'Total Amount', value: formatRandDocument(inv.total_rand) },
    terms: { heading: 'TERMS & CONDITIONS', text: 'Full payment due on', strong: formatDateDocument(inv.due_at) },
    footer: businessFooter(snap.business),
  });
}

/** A sample invoice from the current settings, for "Preview a sample invoice". */
export function buildSampleInvoiceHtml(s: InvoiceSettings, now: Date = new Date()): string {
  const due = new Date(now);
  due.setDate(due.getDate() + s.invoice_due_days);
  const snap: InvoiceSnapshot = {
    business: {
      name: s.business_name, regNo: s.business_reg_no, phone: s.business_phone, email: s.business_email,
      address: s.business_address, logoDataUri: s.logo_data_uri,
    },
    bank: { holder: s.bank_account_holder, bank: s.bank_name, accountNo: s.bank_account_no, branchCode: s.bank_branch_code, swift: s.bank_swift },
    billedTo: { name: 'Parent name', phone: '082 000 0000' },
    student: { name: 'Student name', grade: 10 },
    reference: 'REFERENCE',
  };
  return buildInvoiceHtml(
    { number: s.invoice_next_number, issued_at: now.toISOString(), due_at: due.toISOString(), total_rand: 2150 },
    [
      { item: 'Tutoring', description: 'Mathematics Lesson', qty_hours: 10, rate_rand: 200, amount_rand: 2000 },
      { item: 'Travel', description: '3 in-person lessons', qty_hours: null, rate_rand: null, amount_rand: 150 },
    ],
    snap,
  );
}

async function shareHtml(html: string, filename: string): Promise<string> {
  const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 });
  let shareUri = uri;
  if (FileSystem.cacheDirectory) {
    shareUri = `${FileSystem.cacheDirectory}${filename}`;
    await FileSystem.copyAsync({ from: uri, to: shareUri });
  }
  await Sharing.shareAsync(shareUri, { mimeType: 'application/pdf', dialogTitle: 'Share invoice', UTI: 'com.adobe.pdf' });
  return shareUri;
}

export async function shareInvoicePdf(invoiceId: string): Promise<boolean> {
  const inv = getInvoice(invoiceId);
  if (!inv) return false;
  const snap = parseSnapshot(inv);
  const name = snap.student.name.replace(/[^A-Za-z0-9]+/g, '') || 'Student';
  await shareHtml(buildInvoiceHtml(inv, getInvoiceLines(inv.id), snap), `Invoice-${invoiceNumberLabel(inv.number)}_${name}.pdf`);
  return true;
}

export async function shareSampleInvoicePdf(): Promise<void> {
  await shareHtml(buildSampleInvoiceHtml(getInvoiceSettings()), 'Invoice-sample.pdf');
}
