process.env.TZ = 'Africa/Johannesburg';

import {
  formatRand,
  formatRandCompact,
  formatHours,
  formatHoursSigned,
  parseDecimal,
  formatDayShort,
  formatTime,
  formatTimeRange,
  formatDateLong,
  formatLedgerDate,
  formatScheduledTime,
  formatClaimPeriod,
  inclusivePeriodEnd,
  formatMinutes,
} from '../format';

const NB = '\u00A0';
/** Test literals are written with plain spaces for readability; the formatter emits U+00A0. */
const nb = (s: string) => s.replace(/ /g, NB);

describe('formatRand (deterministic, no toLocaleString)', () => {
  it.each([
    [5500, 'R 5 500.00'],
    [0, 'R 0.00'],
    [12.5, 'R 12.50'],
    [999.999, 'R 1 000.00'],
    [1234567.891, 'R 1 234 567.89'],
    [0.1 + 0.2, 'R 0.30'],
    [1.005, 'R 1.01'],
    [-250, '−R 250.00'],
  ])('%p → %p', (n, out) => expect(formatRand(n)).toBe(nb(out)));

  it('handles non-finite input safely', () => {
    expect(formatRand(NaN)).toBe(nb('R 0.00'));
  });

  it('never contains a breakable space (no "R 1 / 750.00" line wraps)', () => {
    for (const n of [1750, 1234567.89, -250, 0]) {
      expect(formatRand(n)).not.toMatch(/ /);
      expect(formatRand(n)).toContain(`R${NB}`);
    }
    expect(formatRand(1750)).toBe(`R${NB}1${NB}750.00`);
  });

  it('round-trips through parseDecimal', () => {
    expect(parseDecimal(formatRand(1234567.5))).toBe(1234567.5);
  });
});

describe('formatRandCompact', () => {
  it.each([
    [5500, 'R 5 500'],
    [5499.6, 'R 5 500'],
    [600, 'R 600'],
    [0, 'R 0'],
    [-1200, '−R 1 200'],
  ])('%p → %p', (n, out) => expect(formatRandCompact(n)).toBe(nb(out)));

  it('never contains a breakable space', () => {
    expect(formatRandCompact(1750)).toBe(`R${NB}1${NB}750`);
    expect(formatRandCompact(-1200)).not.toMatch(/ /);
  });
});

describe('formatHours / formatHoursSigned', () => {
  it('keeps unsigned format', () => {
    expect(formatHours(1.5)).toBe('1h 30m');
    expect(formatHours(0.75)).toBe('45m');
    expect(formatHours(2)).toBe('2h');
  });
  it('signs positive, negative and zero', () => {
    expect(formatHoursSigned(1.5)).toBe('+1h 30m');
    expect(formatHoursSigned(-0.5)).toBe('−30m');
    expect(formatHoursSigned(0)).toBe('0m');
    expect(formatHoursSigned(-0.001)).toBe('0m');
  });
  it('formatMinutes', () => {
    expect(formatMinutes(90)).toBe('1h 30m');
    expect(formatMinutes(45)).toBe('45m');
  });
});

describe('parseDecimal', () => {
  it.each<[string, number | null]>([
    ['1.5', 1.5],
    ['1,5', 1.5],
    ['1,50', 1.5],
    ['4,500', 4500],
    ['4 500', 4500],
    ['4 500', 4500],
    ['1,234,567', 1234567],
    ['4,500.50', 4500.5],
    ['4 500,50', 4500.5],
    ['4.500,50', 4500.5],
    ['0,500', 0.5],
    ['R 5 500', 5500],
    ['R5500.00', 5500],
    ['  12 ', 12],
    ['.5', 0.5],
    [',5', 0.5],
    ['-2', -2],
    ['', null],
    ['   ', null],
    ['abc', null],
    ['1.2.3', null],
    ['1,2,3', null],
    ['1,5,', null],
  ])('%p → %p', (s, out) => expect(parseDecimal(s)).toBe(out));
});

describe('date formats (local time, deterministic)', () => {
  // 2026-10-09 07:30Z = Fri 9 Oct 09:30 SAST
  const iso = '2026-10-09T07:30:00.000Z';
  it('formatDayShort', () => expect(formatDayShort(iso)).toBe('Fri 9 Oct'));
  it('formatTime', () => expect(formatTime(iso)).toBe('09:30'));
  it('formatTimeRange', () =>
    expect(formatTimeRange(iso, '2026-10-09T08:45:00.000Z')).toBe('09:30–10:45'));
  it('formatDateLong', () => expect(formatDateLong(iso)).toBe('Fri 9 Oct 2026'));
  it('formatLedgerDate', () => expect(formatLedgerDate(iso)).toEqual({ day: '09', month: 'OCT' }));
  it('formatScheduledTime', () => expect(formatScheduledTime(iso)).toBe('Fri 9 Oct · 09:30'));
  it('uses local day, not UTC day', () => {
    // 22:30Z on the 8th is 00:30 on Fri 9th in SAST
    expect(formatDayShort('2026-10-08T22:30:00.000Z')).toBe('Fri 9 Oct');
  });
});

describe('formatClaimPeriod', () => {
  // Stored as [local midnight start, exclusive next local midnight end)
  const start = new Date(2026, 8, 1).toISOString(); // 1 Sep local
  const end = new Date(2026, 9, 1).toISOString();   // 1 Oct local (exclusive)

  it('shows the inclusive end day', () => {
    expect(formatClaimPeriod(start, end)).toBe('1 Sep – 30 Sep 2026');
  });
  it('single day', () => {
    const s = new Date(2026, 9, 9).toISOString();
    const e = new Date(2026, 9, 10).toISOString();
    expect(formatClaimPeriod(s, e)).toBe('9 Oct 2026');
  });
  it('spans years', () => {
    const s = new Date(2025, 11, 15).toISOString();
    const e = new Date(2026, 0, 15).toISOString();
    expect(formatClaimPeriod(s, e)).toBe('15 Dec 2025 – 14 Jan 2026');
  });
  it('whole-pool claim', () => {
    expect(formatClaimPeriod(null, null)).toBe('All lessons');
  });
  it('inclusivePeriodEnd is the last included local day', () => {
    const d = inclusivePeriodEnd(end);
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 8, 30]);
  });
});
