import { roundToBilledMinutes } from '../duration';

describe('roundToBilledMinutes', () => {
  it('returns 0 for 0 seconds', () => expect(roundToBilledMinutes(0)).toBe(0));
  it('returns 0 for 14 minutes (under threshold)', () => expect(roundToBilledMinutes(14 * 60)).toBe(0));
  it('returns 30 for 15 minutes (at threshold)', () => expect(roundToBilledMinutes(15 * 60)).toBe(30));
  it('returns 30 for 20 minutes', () => expect(roundToBilledMinutes(20 * 60)).toBe(30));
  it('returns 60 for 45 minutes', () => expect(roundToBilledMinutes(45 * 60)).toBe(60));
  it('returns 120 for 2h 10min', () => expect(roundToBilledMinutes(2 * 3600 + 10 * 60)).toBe(120));
  it('returns 150 for 2h 15min', () => expect(roundToBilledMinutes(2 * 3600 + 15 * 60)).toBe(150));
});
