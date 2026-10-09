import { effectiveRate, lessonFee, travelFee, roundCents } from '../claim';

describe('effectiveRate', () => {
  it('uses the tutor rate when override is null', () => {
    expect(effectiveRate(null, 600)).toBe(600);
  });

  it('uses the override when present (COALESCE semantics)', () => {
    expect(effectiveRate(750, 600)).toBe(750);
  });

  it('treats an override of 0 as a real override, not a fallback', () => {
    expect(effectiveRate(0, 600)).toBe(0);
  });
});

describe('lessonFee', () => {
  it('multiplies billed hours by the effective rate', () => {
    expect(lessonFee(1.5, 600)).toBe(900);
  });

  it('rounds to 2 decimals (cents) at the boundary', () => {
    // 1.333... hours × 450 = 599.85 (rounded)
    expect(lessonFee(1 / 3 * 4, 450)).toBe(roundCents((4 / 3) * 450));
    // FP drift case: 0.1 * 3
    expect(lessonFee(0.1, 30.3)).toBe(3.03);
  });

  it('returns 0 for zero hours', () => {
    expect(lessonFee(0, 600)).toBe(0);
  });
});

describe('travelFee', () => {
  it('is R0 for online lessons regardless of config', () => {
    expect(
      travelFee({ mode: 'online', travelMode: 'flat', flatFee: 100, distanceKm: 50, perKmRate: 5 })
    ).toBe(0);
    expect(
      travelFee({ mode: 'online', travelMode: 'distance', flatFee: 100, distanceKm: 50, perKmRate: 5 })
    ).toBe(0);
  });

  it('uses the flat fee for in-person flat mode', () => {
    expect(
      travelFee({ mode: 'in_person', travelMode: 'flat', flatFee: 80, distanceKm: 50, perKmRate: 5 })
    ).toBe(80);
  });

  it('uses distance × per-km rate for in-person distance mode', () => {
    expect(
      travelFee({ mode: 'in_person', travelMode: 'distance', flatFee: 80, distanceKm: 12, perKmRate: 7.5 })
    ).toBe(90);
  });

  it('rounds distance travel to 2 decimals', () => {
    expect(
      travelFee({ mode: 'in_person', travelMode: 'distance', flatFee: 0, distanceKm: 3.33, perKmRate: 4.5 })
    ).toBe(roundCents(3.33 * 4.5));
  });
});
