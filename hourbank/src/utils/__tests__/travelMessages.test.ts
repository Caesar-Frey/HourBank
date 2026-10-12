process.env.TZ = 'Africa/Johannesburg';

import { formatRand } from '../format';
import {
  buildLessonReceiptText,
  buildLowBalanceReminderText,
  buildTopUpText,
  buildTravelPaymentText,
} from '../parentMessages';

const R = formatRand;

describe('reminder with subjects + travel owed', () => {
  const base = {
    tutorName: 'Mag',
    studentName: 'Amahle',
    recipientName: 'Thandi',
    balanceHours: 0.5,
    paymentDetails: 'FNB 123',
    paymentReference: 'AMAHLE D',
  };

  it('lists each subject balance when there are several', () => {
    const t = buildLowBalanceReminderText({
      ...base,
      subjectBalances: [
        { subject: 'Maths', balanceHours: 0.5 },
        { subject: 'Science', balanceHours: -1 },
      ],
    });
    expect(t).toContain("Amahle's lesson balances:");
    expect(t).toContain('Maths: 30m remaining');
    expect(t).toContain('Science: owing 1h');
  });

  it('names the single subject', () => {
    const t = buildLowBalanceReminderText({ ...base, subjectBalances: [{ subject: 'Maths', balanceHours: 0.5 }] });
    expect(t).toContain("Amahle's Maths lesson balance is low: 30m remaining.");
  });

  it('accepts a plain subjectName (old call shape still works)', () => {
    expect(buildLowBalanceReminderText({ ...base, subjectName: 'Science', balanceHours: -0.5 }))
      .toContain("Amahle's Science lesson account is owing 30m.");
    expect(buildLowBalanceReminderText({ studentName: 'Amahle', balanceHours: 0.5 }))
      .toContain("Amahle's lesson balance is low: 30m remaining.");
  });

  it('adds travel owed, total with travel and keeps the reference line', () => {
    const t = buildLowBalanceReminderText({
      ...base,
      suggestedPackage: { hours: 10, price: 5500 },
      travelOwed: { amount: 360, lessonCount: 3 },
    });
    expect(t).toContain(`Travel owed: ${R(360)} (3 in-person lessons)`);
    expect(t).toContain(`Total with travel: ${R(5860)}.`);
    expect(t).toContain('Reference: AMAHLE D');
  });

  it('omits travel when nothing is owed', () => {
    const t = buildLowBalanceReminderText({ ...base, travelOwed: { amount: 0, lessonCount: 0 } });
    expect(t).not.toContain('Travel');
  });
});

describe('lesson receipt with subject + travel', () => {
  it('shows subject, subject balance and travel charge', () => {
    const t = buildLessonReceiptText({
      studentName: 'Amahle',
      startedAt: '2026-10-09T07:30:00.000Z',
      billedMinutes: 60,
      balanceAfter: 4,
      subjectName: 'Maths',
      travelCharge: 60,
      travelKm: 12,
    });
    expect(t).toContain('Subject: Maths');
    expect(t).toContain(`Travel: ${R(60)} (12 km)`);
    expect(t).toContain('Maths balance remaining: 4h');
  });

  it('student audience wording', () => {
    const t = buildLessonReceiptText({
      studentName: 'Amahle', audience: 'student', startedAt: '2026-10-09T07:30:00.000Z',
      billedMinutes: 60, balanceAfter: 4, subjectName: 'Maths',
    });
    expect(t).toContain('Your Maths balance remaining: 4h');
    expect(t).not.toContain('Travel');
  });
});

describe('top-up confirmation with subject + travel', () => {
  it('mentions subject and travel settled with totals', () => {
    const t = buildTopUpText({
      studentName: 'Amahle', hoursAdded: 10, amountPaid: 5500, newBalance: 11,
      subjectName: 'Maths', travelSettled: 360, travelStillOwed: 40,
    });
    expect(t).toContain('Hours added: 10h Maths');
    expect(t).toContain(`Lessons: ${R(5500)}`);
    expect(t).toContain(`Travel settled: ${R(360)}`);
    expect(t).toContain(`Total received: ${R(5860)}`);
    expect(t).toContain('Maths balance: 11h');
    expect(t).toContain(`Travel still owed: ${R(40)}`);
  });

  it('unchanged wording without subject/travel', () => {
    const t = buildTopUpText({ studentName: 'Amahle', hoursAdded: 10, amountPaid: 5500, newBalance: 11 });
    expect(t).toContain(`Amount: ${R(5500)}`);
    expect(t).toContain('New balance: 11h');
  });
});

describe('travel payment text', () => {
  it('confirms amount and what is still owed', () => {
    const t = buildTravelPaymentText({
      studentName: 'Amahle', recipientName: 'Thandi', amount: 100, stillOwed: 260, paidAt: '2026-10-09T07:30:00.000Z', tutorName: 'Mag',
    });
    expect(t).toContain('Hi Thandi,');
    expect(t).toContain('Travel payment received for Amahle on Fri 9 Oct 2026.');
    expect(t).toContain(`Amount: ${R(100)}`);
    expect(t).toContain(`Travel still owed: ${R(260)}`);
    expect(buildTravelPaymentText({ studentName: 'A', amount: 5, stillOwed: 0 })).toContain('fully paid up');
  });
});
