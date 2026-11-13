process.env.TZ = 'Africa/Johannesburg';

import { formatRand } from '../format';
import {
  aggregateBySubject,
  kmLabel,
  topUpCtaWithTravel,
  topUpGrandTotal,
  topUpTravelAmount,
  topUpTravelToggleLabel,
  travelAmountInput,
  travelOwedMessageLine,
  travelOwedSummary,
  validateTravelPayment,
} from '../travelBilling';

const R = formatRand;

describe('travelOwedSummary', () => {
  it('formats amount, lesson count and since date', () => {
    expect(travelOwedSummary({ amount: 360, lessonCount: 3, since: '2026-10-02T08:00:00.000Z' }))
      .toBe(`${R(360)} · 3 in-person lessons since 2 Oct`);
    expect(travelOwedSummary({ amount: 50, lessonCount: 1, since: null })).toBe(`${R(50)} · 1 in-person lesson`);
  });
  it('is null when nothing owed', () => {
    expect(travelOwedSummary({ amount: 0, lessonCount: 0, since: null })).toBeNull();
  });
});

describe('travelOwedMessageLine', () => {
  it('builds the reminder line', () => {
    expect(travelOwedMessageLine(360, 3)).toBe(`Travel owed: ${R(360)} (3 in-person lessons)`);
    expect(travelOwedMessageLine(20, 0)).toBe(`Travel owed: ${R(20)}`);
    expect(travelOwedMessageLine(0, 2)).toBeNull();
    expect(travelOwedMessageLine(null, null)).toBeNull();
  });
});

describe('validateTravelPayment', () => {
  it('accepts partial and full amounts with SA decimals', () => {
    expect(validateTravelPayment('360', 360)).toEqual({ value: 360, error: null });
    expect(validateTravelPayment('100,50', 360)).toEqual({ value: 100.5, error: null });
    expect(validateTravelPayment('R 200', 360)).toEqual({ value: 200, error: null });
  });
  it('rejects empty-ish, zero, junk and over-payment', () => {
    expect(validateTravelPayment('  ', 360)).toEqual({ value: null, error: null });
    expect(validateTravelPayment('0', 360).error).toMatch(/more than zero/);
    expect(validateTravelPayment('abc', 360).error).toMatch(/valid/);
    expect(validateTravelPayment('-5', 360).error).toMatch(/valid/);
    expect(validateTravelPayment('360.01', 360).error).toBe(`Only ${R(360)} travel is owed`);
  });
  it('prefills the owed amount', () => {
    expect(travelAmountInput(360)).toBe('360');
    expect(travelAmountInput(52.5)).toBe('52.50');
    expect(travelAmountInput(-1)).toBe('0');
  });
});

describe('top-up with travel', () => {
  it('travel amount follows the toggle', () => {
    expect(topUpTravelAmount(360, true)).toBe(360);
    expect(topUpTravelAmount(360, false)).toBe(0);
    expect(topUpTravelAmount(0, true)).toBe(0);
  });
  it('grand total adds travel', () => {
    expect(topUpGrandTotal(5500, 360)).toBe(5860);
    expect(topUpGrandTotal(null, 360)).toBeNull();
    expect(topUpGrandTotal(5500, 0)).toBe(5500);
  });
  it('CTA names subject and travel', () => {
    expect(topUpCtaWithTravel({ hours: 10, price: 5500, hasSelection: true, subjectName: 'Maths', travel: 360 }))
      .toBe(`Add 10h Maths · ${R(5500)} + travel ${R(360)}`);
    expect(topUpCtaWithTravel({ hours: 10, price: 5500, hasSelection: true }))
      .toBe(`Add 10h · ${R(5500)}`);
    expect(topUpCtaWithTravel({ hours: null, price: null, hasSelection: false })).toBe('Choose a package');
    expect(topUpCtaWithTravel({ hours: 0, price: null, hasSelection: true })).toBe('Enter hours');
    expect(topUpCtaWithTravel({ hours: 2, price: null, hasSelection: true, subjectName: 'Science' }))
      .toBe('Add 2h Science · enter amount');
  });
  it('toggle label and success message', () => {
    expect(topUpTravelToggleLabel(360, 3)).toBe(`Travel owed ${R(360)} (3 lessons)`);
    expect(topUpTravelToggleLabel(50, 1)).toBe(`Travel owed ${R(50)} (1 lesson)`);
  });
});

describe('aggregateBySubject', () => {
  it('collapses rows by subject name across students', () => {
    const rows = aggregateBySubject([
      { studentId: 'a', subject: 'Maths', sessions: 2, hours: 2 },
      { studentId: 'b', subject: 'maths', sessions: 1, hours: 1.5 },
      { studentId: 'a', subject: 'Science', sessions: 1, hours: 1 },
    ]);
    expect(rows).toEqual([
      { subject: 'Maths', students: 2, sessions: 3, hours: 3.5 },
      { subject: 'Science', students: 1, sessions: 1, hours: 1 },
    ]);
  });
});

describe('kmLabel', () => {
  it('labels in-person km only', () => {
    expect(kmLabel('in_person', 12)).toBe('12 km');
    expect(kmLabel('in_person', 12.46)).toBe('12.5 km');
    expect(kmLabel('in_person', 0)).toBeNull();
    expect(kmLabel('in_person', null)).toBeNull();
    expect(kmLabel('online', 12)).toBeNull();
  });
});
