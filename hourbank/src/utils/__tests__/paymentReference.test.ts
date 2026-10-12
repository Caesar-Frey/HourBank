import {
  buildPaymentReference,
  previewPaymentReference,
  shortStudentRef,
  DEFAULT_PAYMENT_REFERENCE_TEMPLATE,
  PAYMENT_REFERENCE_MAX,
  PAYMENT_REFERENCE_TOKENS,
  insertReferenceToken,
} from '../paymentReference';

const amahle = { id: '3f2a9c10-7b4e-4d2a-9c1e-0a1b2c3d4e5f', full_name: 'Amahle Dlamini' };
const OCT = new Date(2026, 9, 12);

describe('buildPaymentReference', () => {
  it('default template is "{first} {surname}"', () => {
    expect(DEFAULT_PAYMENT_REFERENCE_TEMPLATE).toBe('{first} {surname}');
    expect(buildPaymentReference(DEFAULT_PAYMENT_REFERENCE_TEMPLATE, amahle, OCT)).toBe('Amahle Dlamini');
  });

  it('supports case variants and initial', () => {
    expect(buildPaymentReference('{SURNAME}{initial}', amahle, OCT)).toBe('DLAMINIA');
    expect(buildPaymentReference('{FIRST} {INITIAL}', amahle, OCT)).toBe('AMAHLE A');
    expect(buildPaymentReference('{initial} {surname}', amahle, OCT)).toBe('A Dlamini');
  });

  it('{month} renders as MMMYY', () => {
    expect(buildPaymentReference('{surname} {month}', amahle, OCT)).toBe('Dlamini OCT26');
    expect(buildPaymentReference('{month}', amahle, new Date(2027, 0, 3))).toBe('JAN27');
  });

  it('{id} is a stable 5-char uppercase code', () => {
    const a = shortStudentRef(amahle.id);
    expect(a).toMatch(/^[0-9A-Z]{5}$/);
    expect(shortStudentRef(amahle.id)).toBe(a);
    expect(shortStudentRef('another-id')).not.toBe(a);
    expect(buildPaymentReference('HB{id}', amahle, OCT)).toBe(`HB${a}`);
  });

  it('uses the last word as surname for multi-part names; single names have no surname', () => {
    expect(buildPaymentReference('{surname}', { id: 'x', full_name: 'Sipho  van der Merwe ' }, OCT)).toBe('Merwe');
    expect(buildPaymentReference('{first} {surname}', { id: 'x', full_name: 'Sipho' }, OCT)).toBe('Sipho');
  });

  it('strips characters banks reject and accents, collapses spaces', () => {
    expect(buildPaymentReference('{first} /{surname}!', { id: 'x', full_name: "Zoë O'Neil-Smith" }, OCT)).toBe('Zoe ONeil-Smith');
    expect(buildPaymentReference('  {first}   #  {surname} ', amahle, OCT)).toBe('Amahle Dlamini');
  });

  it('drops unknown tokens', () => {
    expect(buildPaymentReference('{first}{bogus}', amahle, OCT)).toBe('Amahle');
  });

  it('caps at 20 characters', () => {
    const ref = buildPaymentReference('{first} {surname} tutoring fees', amahle, OCT);
    expect(ref.length).toBeLessThanOrEqual(PAYMENT_REFERENCE_MAX);
    expect(PAYMENT_REFERENCE_MAX).toBe(20);
    expect(ref).toBe('Amahle Dlamini tutor');
  });

  it('falls back to the default template when the template is blank or renders empty', () => {
    expect(buildPaymentReference('', amahle, OCT)).toBe('Amahle Dlamini');
    expect(buildPaymentReference(null, amahle, OCT)).toBe('Amahle Dlamini');
    expect(buildPaymentReference('{bogus}!!', amahle, OCT)).toBe('Amahle Dlamini');
  });
});

describe('previewPaymentReference', () => {
  it('reports when the rendered reference exceeds the bank limit', () => {
    const long = previewPaymentReference('{FIRST} {SURNAME} {month}', amahle, OCT);
    expect(long.full).toBe('AMAHLE DLAMINI OCT26');
    expect(long.tooLong).toBe(false);
    const longer = previewPaymentReference('{first} {surname} {month} {id}', amahle, OCT);
    expect(longer.tooLong).toBe(true);
    expect(longer.reference).toHaveLength(20);
  });
});

describe('insertReferenceToken', () => {
  it('inserts at the cursor / replaces the selection', () => {
    expect(insertReferenceToken('{first}', '{month}', { start: 7, end: 7 })).toEqual({ value: '{first} {month}', cursor: 15 });
    expect(insertReferenceToken('{first} X', '{surname}', { start: 8, end: 9 })).toEqual({ value: '{first} {surname}', cursor: 17 });
  });
  it('appends with a space when no selection is known', () => {
    expect(insertReferenceToken('{first}', '{id}')).toEqual({ value: '{first} {id}', cursor: 12 });
    expect(insertReferenceToken('', '{id}')).toEqual({ value: '{id}', cursor: 4 });
  });
  it('does not double a space', () => {
    expect(insertReferenceToken('{first} ', '{id}')).toEqual({ value: '{first} {id}', cursor: 12 });
  });
});

describe('PAYMENT_REFERENCE_TOKENS', () => {
  it('lists insertable tokens', () => {
    expect(PAYMENT_REFERENCE_TOKENS.map(t => t.token)).toEqual(
      expect.arrayContaining(['{first}', '{surname}', '{initial}', '{FIRST}', '{SURNAME}', '{month}', '{id}'])
    );
  });
});
