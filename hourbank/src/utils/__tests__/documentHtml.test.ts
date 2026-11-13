import { buildDocumentHtml, businessFooter, safeLogoSrc } from '../documentHtml';
import { buildTopUpReceiptHtml } from '../receipt';

describe('shared document frame (F2)', () => {
  const logo = 'data:image/png;base64,iVBORw0KGgo=';

  it('shows the logo, title, footer and escapes text', () => {
    const html = buildDocumentHtml({
      title: 'RECEIPT',
      logoDataUri: logo,
      left: { heading: 'BILLED TO:', lines: [{ text: '<b>x</b>' }] },
      table: { columns: [{ label: 'Item' }], rows: [['Line 1\nLine 2']] },
      footer: businessFooter({ name: 'Biz', phone: '012', address: null }),
    });
    expect(html).toContain(`<img src="${logo}"`);
    expect(html).toContain('RECEIPT');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('Line 1<br/>Line 2');
    expect(html).toContain('Biz');
  });

  it('drops a logo that is not an image data URI', () => {
    expect(safeLogoSrc('javascript:alert(1)')).toBeNull();
    expect(safeLogoSrc('data:image/png;base64,"onerror=x')).toBeNull();
    expect(safeLogoSrc(logo)).toBe(logo);
  });

  it('receipts use the issuer brand and document money format', () => {
    const html = buildTopUpReceiptHtml({
      brand: { name: 'My Tutoring', email: 'me@example.com' },
      studentName: 'Kid', hoursAdded: 10, amountPaid: 2000, paidAt: '2026-11-12T10:00:00.000Z', newBalance: 12,
    });
    expect(html).toContain('My Tutoring');
    expect(html).toContain('me@example.com');
    expect(html).toContain('R2 000');
    expect(html).toContain('Total paid');
  });
});
