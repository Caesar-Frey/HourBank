import { defaultBilledMinutes, shouldWarnBilledDeviation } from '../duration';

describe('defaultBilledMinutes', () => {
  it('uses booked length when actual is within +15 min of it', () => {
    expect(defaultBilledMinutes(73, 60)).toBe(60);
    expect(defaultBilledMinutes(75, 60)).toBe(60);
  });
  it('uses booked length when actual is within -15 min of it', () => {
    expect(defaultBilledMinutes(46, 60)).toBe(60);
    expect(defaultBilledMinutes(45, 60)).toBe(60);
  });
  it('rounds actual to nearest 15 min when outside tolerance', () => {
    expect(defaultBilledMinutes(80, 60)).toBe(75);
    expect(defaultBilledMinutes(83, 60)).toBe(90);
    expect(defaultBilledMinutes(40, 60)).toBe(45);
    expect(defaultBilledMinutes(37, 60)).toBe(30);
  });
  it('rounds actual when there is no booked length', () => {
    expect(defaultBilledMinutes(52, null)).toBe(45);
    expect(defaultBilledMinutes(53, undefined)).toBe(60);
    expect(defaultBilledMinutes(53, 0)).toBe(60);
  });
  it('never returns less than one rounding unit', () => {
    expect(defaultBilledMinutes(2, null)).toBe(15);
    expect(defaultBilledMinutes(0, null)).toBe(15);
  });
  it('respects a custom rounding unit', () => {
    expect(defaultBilledMinutes(80, null, 30)).toBe(90);
    expect(defaultBilledMinutes(10, null, 30)).toBe(30);
  });
});

describe('shouldWarnBilledDeviation', () => {
  it('does not warn when the tutor has not changed the default', () => {
    expect(shouldWarnBilledDeviation(60, 120, false)).toBe(false);
  });
  it('does not warn when the change is within 15 min of actual', () => {
    expect(shouldWarnBilledDeviation(75, 62, true)).toBe(false);
  });
  it('warns when tutor-changed billed differs from actual by more than 15 min', () => {
    expect(shouldWarnBilledDeviation(90, 60, true)).toBe(true);
    expect(shouldWarnBilledDeviation(30, 60, true)).toBe(true);
  });
});
