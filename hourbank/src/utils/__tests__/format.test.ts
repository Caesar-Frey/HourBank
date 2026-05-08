import { formatHours, formatBilledDuration } from '../format';

describe('formatHours negative', () => {
  it('formats -0.5 as "-30m"', () => expect(formatHours(-0.5)).toBe('-30m'));
  it('formats -1 as "-1h"', () => expect(formatHours(-1)).toBe('-1h'));
  it('formats -1.5 as "-1h 30m"', () => expect(formatHours(-1.5)).toBe('-1h 30m'));
  it('formats 0 as "0m"', () => expect(formatHours(0)).toBe('0m'));
});

describe('formatBilledDuration', () => {
  it('returns "0m" for 0 seconds', () => {
    expect(formatBilledDuration(0)).toBe('0m');
  });

  it('returns "45m" for 2700 seconds', () => {
    expect(formatBilledDuration(2700)).toBe('45m');
  });

  it('returns "1h 30m" for 5400 seconds', () => {
    expect(formatBilledDuration(5400)).toBe('1h 30m');
  });

  it('returns "2h" for 7200 seconds', () => {
    expect(formatBilledDuration(7200)).toBe('2h');
  });
});
