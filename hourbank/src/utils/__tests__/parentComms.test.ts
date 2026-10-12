process.env.TZ = 'Africa/Johannesburg';

jest.mock('react-native', () => ({
  Linking: { openURL: jest.fn() },
  Share: { share: jest.fn(), sharedAction: 'sharedAction', dismissedAction: 'dismissedAction' },
}));

import { Linking, Share } from 'react-native';
import { escapeHtml } from '../html';
import { normaliseSaPhone, whatsappUrl, openWhatsApp } from '../whatsapp';
import {
  buildLessonReceiptText,
  buildTopUpText,
  buildLowBalanceReminderText,
} from '../parentMessages';
import { sendReceipt, sendTopUpConfirmation, sendLowBalanceAlert } from '../notifications';

describe('escapeHtml', () => {
  it('escapes all HTML-significant characters', () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">&`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;'
    );
  });
  it('handles null/undefined/numbers', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('normaliseSaPhone', () => {
  it.each<[string, string | null]>([
    ['082 123 4567', '27821234567'],
    ['082-123-4567', '27821234567'],
    ['(082) 123 4567', '27821234567'],
    ['+27 82 123 4567', '27821234567'],
    ['+27 082 123 4567', '27821234567'],
    ['0027821234567', '27821234567'],
    ['27821234567', '27821234567'],
    ['821234567', '27821234567'],
    ['+44 20 7946 0958', '442079460958'],
    ['12345', null],
    ['', null],
    ['abc', null],
  ])('%p → %p', (raw, out) => expect(normaliseSaPhone(raw)).toBe(out));
});

describe('whatsappUrl', () => {
  it('builds a whatsapp:// deep link with encoded text', () => {
    expect(whatsappUrl('082 123 4567', 'Hi & bye\nok')).toBe(
      'whatsapp://send?phone=27821234567&text=Hi%20%26%20bye%0Aok'
    );
  });
  it('omits phone when not valid (WhatsApp then asks for a contact)', () => {
    expect(whatsappUrl(null, 'Hi')).toBe('whatsapp://send?text=Hi');
  });
});

describe('openWhatsApp', () => {
  beforeEach(() => jest.clearAllMocks());

  it('opens WhatsApp when the app is available', async () => {
    (Linking.openURL as jest.Mock).mockResolvedValue(true);
    await expect(openWhatsApp('0821234567', 'Hello')).resolves.toBe('whatsapp');
    expect(Linking.openURL).toHaveBeenCalledWith('whatsapp://send?phone=27821234567&text=Hello');
    expect(Share.share).not.toHaveBeenCalled();
  });

  it('falls back to the share sheet when WhatsApp cannot open', async () => {
    (Linking.openURL as jest.Mock).mockRejectedValue(new Error('no handler'));
    (Share.share as jest.Mock).mockResolvedValue({ action: 'sharedAction' });
    await expect(openWhatsApp('0821234567', 'Hello')).resolves.toBe('share_sheet');
    expect(Share.share).toHaveBeenCalledWith({ message: 'Hello' });
  });

  it('reports a dismissed share sheet', async () => {
    (Linking.openURL as jest.Mock).mockRejectedValue(new Error('no handler'));
    (Share.share as jest.Mock).mockResolvedValue({ action: 'dismissedAction' });
    await expect(openWhatsApp(null, 'Hello')).resolves.toBe('dismissed');
  });
});

describe('parent message builders', () => {
  it('lesson receipt includes date, time range, billed length, topics, notes, balance', () => {
    const text = buildLessonReceiptText({
      tutorName: 'Mag Botha',
      studentName: 'Amara Nkosi',
      parentName: 'Thandi Nkosi',
      startedAt: '2026-10-09T07:30:00.000Z',
      endedAt: '2026-10-09T08:35:00.000Z',
      billedMinutes: 60,
      topics: ['Algebra', 'Functions'],
      notes: 'Great progress',
      balanceAfter: 4.5,
    });
    expect(text).toContain('Hi Thandi');
    expect(text).toContain('Amara Nkosi');
    expect(text).toContain('Fri 9 Oct 2026 · 09:30–10:35');
    expect(text).toContain('Billed: 1h');
    expect(text).toContain('Topics: Algebra, Functions');
    expect(text).toContain('Notes: Great progress');
    expect(text).toContain('Balance remaining: 4h 30m');
    expect(text).toContain('Mag Botha');
  });

  it('lesson receipt shows owing for negative balance and omits empty sections', () => {
    const text = buildLessonReceiptText({
      studentName: 'Liam',
      startedAt: '2026-10-09T07:30:00.000Z',
      billedMinutes: 45,
      balanceAfter: -1.5,
    });
    expect(text).toContain('Hi,');
    expect(text).toContain('Owing: 1h 30m');
    expect(text).not.toContain('Topics:');
    expect(text).not.toContain('Notes:');
  });

  it('top-up text', () => {
    const text = buildTopUpText({
      tutorName: 'Mag',
      studentName: 'Amara',
      hoursAdded: 10,
      amountPaid: 5500,
      newBalance: 12.5,
      paidAt: '2026-10-09T07:30:00.000Z',
    });
    expect(text).toContain('Hours added: 10h');
    expect(text).toContain('Amount: R\u00A05\u00A0500.00');
    expect(text).toContain('New balance: 12h 30m');
    expect(text).toContain('Fri 9 Oct 2026');
  });

  it('low-balance reminder with payment details and suggested package', () => {
    const text = buildLowBalanceReminderText({
      tutorName: 'Mag',
      studentName: 'Amara',
      parentName: 'Thandi',
      balanceHours: 0.75,
      suggestedPackage: { hours: 10, price: 5500 },
      paymentDetails: 'FNB 123456789\nBranch 250655',
    });
    expect(text).toContain('45m remaining');
    expect(text).toContain('10h for R\u00A05\u00A0500.00');
    expect(text).toContain('FNB 123456789\nBranch 250655');
    expect(text).toContain('Reference: Amara');
  });

  it('low-balance reminder when owing', () => {
    const text = buildLowBalanceReminderText({ studentName: 'Amara', balanceHours: -2 });
    expect(text).toContain('owing 2h');
    expect(text).not.toContain('Payment details');
  });
});

describe('message wording for parent vs student recipient', () => {
  const lesson = {
    studentName: 'Amahle Dlamini',
    startedAt: '2026-10-09T07:30:00.000Z',
    billedMinutes: 60,
    balanceAfter: 3,
  };

  it('lesson receipt: parent recipient', () => {
    const text = buildLessonReceiptText({ ...lesson, recipientName: 'Thandi Dlamini', audience: 'parent' });
    expect(text).toContain('Hi Thandi,');
    expect(text).toContain('Lesson summary for Amahle Dlamini');
  });

  it('lesson receipt: student recipient', () => {
    const text = buildLessonReceiptText({ ...lesson, recipientName: 'Amahle', audience: 'student' });
    expect(text).toContain('Hi Amahle,');
    expect(text).toContain('Your lesson summary');
    expect(text).not.toContain('for Amahle Dlamini');
    expect(text).toContain('Your balance remaining: 3h');
  });

  it('top-up: student recipient', () => {
    const text = buildTopUpText({
      studentName: 'Amahle Dlamini',
      recipientName: 'Amahle',
      audience: 'student',
      hoursAdded: 5,
      amountPaid: 3000,
      newBalance: 6,
      paidAt: '2026-10-09T07:30:00.000Z',
    });
    expect(text).toContain('Hi Amahle,');
    expect(text).toContain('Payment received for your lessons on Fri 9 Oct 2026.');
    expect(text).toContain('Your new balance: 6h');
  });

  it('reminder: parent says "Amahle\'s", student says "your"', () => {
    const base = { studentName: 'Amahle Dlamini', balanceHours: 0.5 };
    expect(buildLowBalanceReminderText({ ...base, recipientName: 'Thandi', audience: 'parent' })).toContain(
      "Amahle Dlamini's lesson balance is low: 30m remaining."
    );
    const s = buildLowBalanceReminderText({ ...base, recipientName: 'Amahle', audience: 'student' });
    expect(s).toContain('Hi Amahle,');
    expect(s).toContain('your lesson balance is low: 30m remaining.');
    const owing = buildLowBalanceReminderText({ ...base, balanceHours: -1, audience: 'student' });
    expect(owing).toContain('your lesson account is owing 1h.');
  });

  it('reminder uses the supplied payment reference only with payment details', () => {
    const base = { studentName: 'Amahle Dlamini', balanceHours: 0.5, paymentReference: 'DLAMINIA' };
    expect(buildLowBalanceReminderText({ ...base, paymentDetails: 'FNB 1' })).toContain('Reference: DLAMINIA');
    expect(buildLowBalanceReminderText(base)).not.toContain('Reference');
  });

  it('parentName still works as the greeting name (back-compat)', () => {
    expect(buildLessonReceiptText({ ...lesson, parentName: 'Thandi' })).toContain('Hi Thandi,');
  });
});

describe('notifications (no side effects, return text)', () => {
  it('returns built text without logging', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const t1 = await sendReceipt({ studentName: 'A', durationMinutes: 60, topics: [], notes: '', balanceAfter: 2 });
    const t2 = await sendTopUpConfirmation({ studentName: 'A', hoursAdded: 5, amountPaid: 3000, newBalance: 5 });
    const t3 = await sendLowBalanceAlert({ studentName: 'A', currentBalance: 0.5 });
    expect(t1).toContain('Billed: 1h');
    expect(t2).toContain('R\u00A03\u00A0000.00');
    expect(t3).toContain('30m remaining');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
