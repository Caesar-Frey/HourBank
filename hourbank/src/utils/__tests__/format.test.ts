import { formatBilledDuration } from '../format';

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
