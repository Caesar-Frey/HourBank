/**
 * One document family (F2): the frame shared by invoices, receipts and claim
 * reports. Modelled on the owner's invoice (mockup M8): logo top left, title
 * top right, a rule, a meta block (billed to / numbers and dates), a bordered
 * table with column rules and a fixed minimum height, payment details and the
 * total, terms, and a footer with the business details.
 *
 * Pure: builds an HTML string for expo-print, black on white (COLORS.print*).
 * Every value passed in is escaped here; callers pass plain text.
 */
import { escapeHtmlMultiline } from './html';
import { COLORS } from '../theme/colors';

export type DocColumn = { label: string; width?: string; align?: 'left' | 'center' | 'right' };

export type DocumentSpec = {
  /** "INVOICE", "RECEIPT", "CLAIM REPORT". */
  title: string;
  /** data: URI of the tutor's logo; when missing the business name is shown instead. */
  logoDataUri?: string | null;
  brandName?: string | null;
  /** Left meta block, e.g. BILLED TO. A `strong` line is semi-bold. */
  left?: { heading?: string; lines: Array<{ text: string; strong?: boolean }> } | null;
  /** Right-aligned lines: number, date, reference. */
  right?: string[];
  table: { columns: DocColumn[]; rows: string[][]; minHeight?: number };
  /** "Please make payment to:" lines; omitted when empty. */
  payment?: string[] | null;
  /** Extra rows above the total (e.g. Lesson fees, Travel). */
  subtotals?: Array<{ label: string; value: string }>;
  total?: { label: string; value: string } | null;
  terms?: { heading: string; text: string; strong?: string } | null;
  /** Short note under the table (e.g. "Lessons edited since this claim"). */
  notes?: string[];
  footer?: { left: string[]; right: string[] };
  /** Boxed warning under the meta block (e.g. a voided claim). */
  banner?: string | null;
  /** Large faint diagonal word behind the page (e.g. VOID). */
  watermark?: string | null;
  /** Strike the total through (void). */
  totalStruck?: boolean;
};

/** Who issues documents: logo, name and footer details (from Invoice details). */
export type DocumentBrand = {
  logoDataUri?: string | null;
  name?: string | null;
  regNo?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
};

const INK = COLORS.printInk;
const FAINT = COLORS.printFaint;
const ROW_HEIGHT = 40;

/** Escape; a newline becomes a line break (notes, addresses). */
function e(s: string): string {
  return escapeHtmlMultiline(s);
}

/** Accept only image data URIs for the logo; anything else is dropped. */
export function safeLogoSrc(uri: string | null | undefined): string | null {
  if (!uri) return null;
  return /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(uri) ? uri : null;
}

export function buildDocumentHtml(d: DocumentSpec): string {
  const logo = safeLogoSrc(d.logoDataUri);
  const brand = logo
    ? `<img src="${logo}" alt="" style="max-width: 240px; max-height: 72px; object-fit: contain;" />`
    : `<div style="font-size: 20px; font-weight: 600;">${e(d.brandName?.trim() || '')}</div>`;

  const left = d.left
    ? `<div class="meta">${d.left.heading ? `<div>${e(d.left.heading)}</div>` : ''}${d.left.lines
        .map(l => `<div${l.strong ? ' class="strong"' : ''}>${e(l.text)}</div>`)
        .join('')}</div>`
    : '<div></div>';
  const right = d.right?.length
    ? `<div class="meta" style="text-align: right;">${d.right.map(l => `<div>${e(l)}</div>`).join('')}</div>`
    : '';
  const metaBlock = d.left || d.right?.length ? `<div class="metarow">${left}${right}</div>` : '';

  const cols = d.table.columns;
  const widths = `<colgroup>${cols.map(c => `<col${c.width ? ` style="width: ${c.width};"` : ''} />`).join('')}</colgroup>`;
  const head = `<tr>${cols.map(c => `<th style="text-align: ${c.align ?? 'center'};">${e(c.label)}</th>`).join('')}</tr>`;
  const body = d.table.rows
    .map(r => `<tr>${r.map((cell, i) => `<td style="text-align: ${cols[i]?.align ?? 'center'};">${e(cell)}</td>`).join('')}</tr>`)
    .join('');
  const fill = Math.max(0, (d.table.minHeight ?? 0) - d.table.rows.length * ROW_HEIGHT - 24);
  const filler = fill > 0 ? `<tr class="fill">${cols.map(() => `<td style="height: ${fill}px;"></td>`).join('')}</tr>` : '';

  const payment = d.payment?.length
    ? `<div class="meta"><div class="strong" style="margin-bottom: 4px;">Please make payment to:</div>${d.payment
        .map(l => `<div>${e(l)}</div>`)
        .join('')}</div>`
    : '<div></div>';
  const subtotals = d.subtotals?.length
    ? d.subtotals.map(s => `<div class="sub"><span>${e(s.label)}</span><span>${e(s.value)}</span></div>`).join('')
    : '';
  const total = d.total
    ? `<div class="total">${subtotals}<div class="tlabel">${e(d.total.label)}</div><div class="tvalue"${d.totalStruck ? ' style="text-decoration: line-through;"' : ''}>${e(d.total.value)}</div></div>`
    : '';
  const notes = d.notes?.length ? `<div class="notes">${d.notes.map(n => `<div>${e(n)}</div>`).join('')}</div>` : '';
  const terms = d.terms
    ? `<div class="terms"><div class="strong" style="font-size: 17px;">${e(d.terms.heading)}</div><div>${e(d.terms.text)}${
        d.terms.strong ? ` <span class="strong">${e(d.terms.strong)}</span>` : ''
      }</div></div>`
    : '<div class="terms"></div>';
  const footer = d.footer && (d.footer.left.length || d.footer.right.length)
    ? `<div class="footer"><div>${d.footer.left.map((l, i) => `<div${i > 0 ? ' class="light"' : ''}>${e(l)}</div>`).join('')}</div>` +
      `<div style="text-align: right;">${d.footer.right.map(l => `<div>${e(l)}</div>`).join('')}</div></div>`
    : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600;800&display=swap" rel="stylesheet" />
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Geist', Helvetica, Arial, sans-serif; color: ${INK}; background: ${COLORS.printPaper}; }
  .page { width: 794px; min-height: 1123px; padding: 64px 72px 48px; display: flex; flex-direction: column; }
  .top { display: flex; justify-content: space-between; align-items: center; padding-bottom: 28px; border-bottom: 1px solid ${INK}; }
  .title { font-size: 38px; font-weight: 800; letter-spacing: 1px; }
  .metarow { display: flex; justify-content: space-between; gap: 24px; padding: 28px 12px 36px; border-bottom: 1px solid ${INK}; }
  .meta { display: flex; flex-direction: column; gap: 4px; font-size: 15px; }
  .strong { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 36px; font-size: 15px; table-layout: fixed; }
  th { font-size: 16px; font-weight: 600; padding: 0 8px 10px; vertical-align: bottom; }
  tbody { border: 1px solid ${INK}; }
  td { padding: 10px 12px; height: ${ROW_HEIGHT}px; border-right: 1px solid ${INK}; vertical-align: top; word-wrap: break-word; }
  td:last-child { border-right: none; }
  tbody tr:first-child td { padding-top: 20px; }
  .bottom { display: flex; justify-content: space-between; gap: 24px; padding-top: 32px; }
  .total { display: flex; flex-direction: column; gap: 6px; min-width: 200px; padding-right: 24px; }
  .sub { display: flex; justify-content: space-between; gap: 16px; font-size: 14px; color: ${FAINT}; }
  .tlabel { font-size: 20px; font-weight: 600; margin-top: 4px; }
  .tvalue { font-size: 30px; font-weight: 800; }
  .notes { margin-top: 20px; font-size: 13px; color: ${FAINT}; display: flex; flex-direction: column; gap: 4px; }
  .terms { display: flex; flex-direction: column; align-items: center; gap: 8px; margin-top: auto; padding: 32px 0 24px; font-size: 15px; }
  .footer { display: flex; justify-content: space-between; align-items: flex-start; border-top: 1px solid ${INK}; padding-top: 18px; font-size: 12px; font-weight: 600; gap: 24px; }
  .footer .light { font-weight: 400; }
  .banner { margin-top: 20px; padding: 10px 14px; border: 2px solid ${INK}; font-size: 14px; font-weight: 600; }
  .watermark { position: fixed; top: 38%; left: 0; right: 0; text-align: center; transform: rotate(-30deg); font-size: 160px; font-weight: 800; letter-spacing: 16px; color: ${INK}; opacity: 0.08; z-index: 0; }
  .page > * { position: relative; z-index: 1; }
</style>
</head>
<body>
${d.watermark ? `<div class="watermark">${e(d.watermark)}</div>` : ''}
<div class="page">
  <div class="top">${brand}<div class="title">${e(d.title)}</div></div>
  ${metaBlock}
  ${d.banner ? `<div class="banner">${e(d.banner)}</div>` : ''}
  <table>${widths}<thead>${head}</thead><tbody>${body}${filler}</tbody></table>
  ${notes}
  ${payment || total ? `<div class="bottom">${payment}${total}</div>` : ''}
  ${terms}
  ${footer}
</div>
</body>
</html>`;
}

/** Footer lines from the business details; empty lines are dropped. */
export function businessFooter(b: {
  name?: string | null; regNo?: string | null; phone?: string | null; email?: string | null; address?: string | null;
}): { left: string[]; right: string[] } {
  return {
    left: [b.name, b.regNo].map(x => x?.trim()).filter((x): x is string => !!x),
    right: [b.phone, b.email, b.address].map(x => x?.trim()).filter((x): x is string => !!x),
  };
}
