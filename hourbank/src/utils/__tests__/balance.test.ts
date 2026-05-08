import { balanceStatus, balanceColour } from '../balance';

describe('balanceStatus', () => {
  it('returns "owes" for negative hours', () => expect(balanceStatus(-0.5)).toBe('owes'));
  it('returns "low" for 0', () => expect(balanceStatus(0)).toBe('low'));
  it('returns "low" for 0.5', () => expect(balanceStatus(0.5)).toBe('low'));
  it('returns "warn" for 1.5', () => expect(balanceStatus(1.5)).toBe('warn'));
  it('returns "ok" for 3.5', () => expect(balanceStatus(3.5)).toBe('ok'));
});

describe('balanceColour', () => {
  it('returns oxblood (#7A2530) for owes', () => expect(balanceColour('owes')).toBe('#7A2530'));
});
