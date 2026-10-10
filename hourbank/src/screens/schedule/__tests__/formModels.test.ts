import {
  DEFAULT_BLOCK_TITLE,
  eventIsoRange,
  formatEventWhen,
  initialRange,
  resolveTitle,
  shiftEndWithStart,
  validateEventRange,
  withDatePart,
  withTimePart,
} from '../eventFormModel';
import { balanceWarning, filterStudents, overOweMessage, owesAfterLesson } from '../startLessonModel';

const d = (day: number, h = 0, m = 0) => new Date(2026, 9, day, h, m);

describe('event form', () => {
  test('changing start shifts end and preserves duration', () => {
    const end = shiftEndWithStart(d(9, 9), d(9, 10, 30), d(9, 14));
    expect(end.getTime()).toBe(d(9, 15, 30).getTime());
    // zero/negative duration → 1h
    expect(shiftEndWithStart(d(9, 9), d(9, 9), d(9, 11)).getTime()).toBe(d(9, 12).getTime());
  });

  test('end ≥ start validation (time vs all-day)', () => {
    expect(validateEventRange(d(9, 10), d(9, 9), false)).toMatch(/End time/);
    expect(validateEventRange(d(9, 10), d(9, 10), false)).toBeNull();
    expect(validateEventRange(d(9, 10), d(9, 9), true)).toBeNull(); // same day ok for all-day
    expect(validateEventRange(d(9), d(8), true)).toMatch(/End date/);
  });

  test('date/time part editing', () => {
    expect(withDatePart(d(9, 14, 30), d(12, 3)).getTime()).toBe(d(12, 14, 30).getTime());
    expect(withTimePart(d(9, 14, 30), d(1, 8, 15)).getTime()).toBe(d(9, 8, 15).getTime());
  });

  test('iso range for all-day spans whole local days', () => {
    const r = eventIsoRange(d(9, 13), d(10, 2), true);
    expect(r.startsAt).toBe(d(9).toISOString());
    expect(r.endsAt).toBe(new Date(2026, 9, 10, 23, 59, 59).toISOString());
  });

  test('title optional for blocks only', () => {
    expect(resolveTitle('time_block', '  ')).toEqual({ title: DEFAULT_BLOCK_TITLE });
    expect(resolveTitle('event', '')).toEqual({ error: expect.any(String) });
    expect(resolveTitle('event', ' Exam ')).toEqual({ title: 'Exam' });
  });

  test('initialRange uses the date param at 09:00–10:00', () => {
    const r = initialRange('2026-10-14');
    expect(r.start.getTime()).toBe(d(14, 9).getTime());
    expect(r.end.getTime()).toBe(d(14, 10).getTime());
    expect(initialRange('garbage', d(3, 18)).start.getTime()).toBe(d(3, 9).getTime());
  });
});

test('formatEventWhen covers single-day, all-day and multi-day', () => {
  const iso = (x: Date) => x.toISOString();
  expect(formatEventWhen({ starts_at: iso(d(9, 9)), ends_at: iso(d(9, 10)), all_day: 0 })).toBe('Fri 9 Oct · 09:00–10:00');
  expect(formatEventWhen({ starts_at: iso(d(9)), ends_at: iso(d(9, 23, 59)), all_day: 1 })).toBe('All day · Fri 9 Oct');
  expect(formatEventWhen({ starts_at: iso(d(9, 14)), ends_at: iso(d(11, 10)), all_day: 0 })).toBe('Fri 9 Oct 14:00 – Sun 11 Oct 10:00');
  expect(formatEventWhen({ starts_at: iso(d(9)), ends_at: iso(d(10, 23, 59)), all_day: 1 })).toBe('All day · Fri 9 Oct – Sat 10 Oct');
});

describe('start lesson', () => {
  const students = [
    { id: 'a', full_name: 'Ann Lee', subject: 'Maths', current_balance: 2 },
    { id: 'b', full_name: 'Ben Ng', subject: 'Physics', current_balance: -1 },
  ];

  test('search by name or subject', () => {
    expect(filterStudents(students, 'ben').map(s => s.id)).toEqual(['b']);
    expect(filterStudents(students, 'math').map(s => s.id)).toEqual(['a']);
    expect(filterStudents(students, '  ')).toHaveLength(2);
  });

  test('owe warnings', () => {
    expect(owesAfterLesson(2, 60)).toBeNull();
    expect(owesAfterLesson(0.5, 60)).toBeCloseTo(0.5);
    expect(balanceWarning(2, 60)).toBeNull();
    expect(balanceWarning(0.5, 60)).toBe('Will owe 30m after a 1h lesson');
    expect(balanceWarning(-1, 60)).toBe('Already owes 1h');
  });

  test('over-owe confirm copy', () => {
    const m = overOweMessage('Ann', { projectedBalanceHours: -1.5, maxOweHours: 0 });
    expect(m.title).toBe('Ann will owe 1h 30m');
    expect(m.message).toMatch(/Start anyway\?/);
    expect(m.message).toMatch(/don’t allow owing/);
    expect(overOweMessage('Ann', { projectedBalanceHours: -3, maxOweHours: 2 }).message).toMatch(/limit is 2h/);
    expect(overOweMessage('Ann', undefined).title).toBe('Ann is over the owing limit');
  });
});
