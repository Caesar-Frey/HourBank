import {
  adjustmentPreview,
  archiveConfirmMessage,
  archivedToastMessage,
  balanceReviewLine,
  conflictSummary,
  decimalPreview,
  defaultPastStart,
  formatBalance,
  formatPhoneDisplay,
  groupLedgerByMonth,
  isStudentFormDirty,
  ledgerDescription,
  ledgerRowHref,
  pauseConfirmMessage,
  phoneFieldState,
  projectedBalanceWithBookings,
  shortRef,
  shouldOfferTopUpReminder,
  showPreferredContactChoice,
  stepMinutes,
  studentContactPayload,
  StudentFormValues,
  suggestTopUpPackage,
  telUri,
  tierSavings,
  topUpCtaLabel,
  upcomingOweWarning,
  validatePastStart,
  validateScheduleStart,
  validateStudentForm,
  withDate,
  withTime,
} from '../flowLogic';

describe('balances', () => {
  it('formats balances with a typographic minus when owing', () => {
    expect(formatBalance(3)).toBe('3h');
    expect(formatBalance(1.5)).toBe('1h 30m');
    expect(formatBalance(-0.5)).toBe('−30m');
    expect(formatBalance(0)).toBe('0m');
  });

  it('builds a review line', () => {
    expect(balanceReviewLine(3, 1.5)).toBe('Balance 3h → 1h 30m');
    expect(balanceReviewLine(1, 11)).toBe('Balance 1h → 11h');
  });

  it('offers a reminder under 1h or when owing', () => {
    expect(shouldOfferTopUpReminder(1)).toBe(false);
    expect(shouldOfferTopUpReminder(0.75)).toBe(true);
    expect(shouldOfferTopUpReminder(-2)).toBe(true);
    expect(shouldOfferTopUpReminder(0.999999)).toBe(false); // rounds to 60 min
  });

  it('warns only when an upcoming lesson projects negative', () => {
    expect(upcomingOweWarning(0)).toBeNull();
    expect(upcomingOweWarning(0.25)).toBeNull();
    expect(upcomingOweWarning(-1.5)).toBe('will owe 1h 30m');
  });
});

describe('adjustmentPreview', () => {
  it('previews a removal', () => {
    const p = adjustmentPreview('remove', '1,5', 3);
    expect(p.hoursDelta).toBe(-1.5);
    expect(p.deltaLabel).toBe('−1h 30m');
    expect(p.reviewLine).toBe('Balance 3h → 1h 30m');
    expect(p.error).toBeNull();
  });

  it('previews an addition that clears a debt', () => {
    const p = adjustmentPreview('add', '2', -0.5);
    expect(p.hoursDelta).toBe(2);
    expect(p.deltaLabel).toBe('+2h');
    expect(p.reviewLine).toBe('Balance −30m → 1h 30m');
  });

  it('is silent when empty and errors on junk / zero / huge', () => {
    expect(adjustmentPreview('add', '', 1)).toMatchObject({ hoursDelta: null, error: null });
    expect(adjustmentPreview('add', 'abc', 1).error).toMatch(/number/);
    expect(adjustmentPreview('add', '0', 1).error).toMatch(/more than zero/);
    expect(adjustmentPreview('add', '0,001', 1).error).toMatch(/more than zero/);
    expect(adjustmentPreview('add', '500', 1).error).toMatch(/check the amount/);
    expect(adjustmentPreview('remove', '-1', 1).error).toMatch(/number/);
  });

  it('snaps to whole minutes', () => {
    expect(adjustmentPreview('add', '0.3333', 0).hoursDelta).toBeCloseTo(20 / 60, 10);
  });
});

describe('top-up helpers', () => {
  it('computes savings from parent hourly price', () => {
    expect(tierSavings(10, 5500, 600)).toBe(500);
    expect(tierSavings(5, 3000, 600)).toBeNull();
    expect(tierSavings(5, 3000, 0)).toBeNull();
    expect(tierSavings(5, 3000, null)).toBeNull();
  });

  it('labels the CTA', () => {
    expect(topUpCtaLabel(null, null, false)).toBe('Choose a package');
    expect(topUpCtaLabel(10, 5500, true)).toBe('Add 10h · R\u00A05\u00A0500.00');
    expect(topUpCtaLabel(null, null, true)).toBe('Enter hours');
    expect(topUpCtaLabel(2.5, null, true)).toBe('Add 2h 30m · enter amount');
  });

  it('previews decimal inputs', () => {
    expect(decimalPreview('8,5', 'hours')).toEqual({ value: 8.5, text: '= 8h 30m', error: false });
    expect(decimalPreview('4 500', 'rand')).toEqual({ value: 4500, text: '= R\u00A04\u00A0500.00', error: false });
    expect(decimalPreview('', 'rand')).toEqual({ value: null, text: '', error: false });
    expect(decimalPreview('x', 'hours').error).toBe(true);
    expect(decimalPreview('0', 'hours').error).toBe(true);
    expect(decimalPreview('0', 'rand')).toEqual({ value: 0, text: '= R\u00A00.00', error: false });
  });

  it('suggests the smallest package that clears the debt', () => {
    const tiers = [{ hours: 10, price: 5500 }, { hours: 5, price: 3000 }, { hours: 15, price: 8000 }];
    expect(suggestTopUpPackage(tiers, 0.5)).toEqual({ hours: 5, price: 3000 });
    expect(suggestTopUpPackage(tiers, -6)).toEqual({ hours: 10, price: 5500 });
    expect(suggestTopUpPackage(tiers, -40)).toEqual({ hours: 15, price: 8000 });
    expect(suggestTopUpPackage([], 0)).toBeNull();
  });
});

describe('scheduling', () => {
  const now = new Date(2026, 9, 9, 14, 7);

  it('blocks past and present start times', () => {
    expect(validateScheduleStart(new Date(2026, 9, 9, 14, 0), now)).toMatchObject({ ok: false, reason: 'past' });
    expect(validateScheduleStart(now, now).ok).toBe(false);
    expect(validateScheduleStart(new Date(2026, 9, 9, 15, 0), now).ok).toBe(true);
  });

  it('projects balance including other booked lessons, excluding the one being moved', () => {
    const booked = [
      { id: 'a', estimated_duration_minutes: 60 },
      { id: 'b', estimated_duration_minutes: null },
      { id: 'c', estimated_duration_minutes: 90 },
    ];
    expect(projectedBalanceWithBookings(5, booked, 60)).toEqual({ otherBookedHours: 3.5, projected: 0.5 });
    expect(projectedBalanceWithBookings(5, booked, 60, 'c')).toEqual({ otherBookedHours: 2, projected: 2 });
  });

  it('summarises conflicts', () => {
    expect(conflictSummary({ sessions: [], calendarItems: [] })).toBeNull();
    expect(conflictSummary({
      sessions: [{ studentName: 'Ana' }],
      calendarItems: [{ title: 'Gym', kind: 'time_block' }, { title: '', kind: 'time_block' }],
    })).toBe('Clashes with Ana (lesson), Gym (blocked), Time block (blocked)');
  });

  it('combines date and time parts', () => {
    const base = new Date(2026, 9, 9, 15, 30);
    expect(withDate(base, new Date(2026, 11, 1, 2, 0))).toEqual(new Date(2026, 11, 1, 15, 30));
    expect(withTime(base, new Date(2020, 0, 1, 9, 45, 12))).toEqual(new Date(2026, 9, 9, 9, 45, 0));
  });
});

describe('log past lesson', () => {
  it('defaults to the most recent quarter hour minus the lesson length', () => {
    expect(defaultPastStart(new Date(2026, 9, 9, 14, 7, 30), 60)).toEqual(new Date(2026, 9, 9, 13, 0));
  });

  it('validates start in the past', () => {
    const now = new Date(2026, 9, 9, 14, 0);
    expect(validatePastStart(new Date(2026, 9, 9, 13, 0), now)).toBeNull();
    expect(validatePastStart(new Date(2026, 9, 9, 15, 0), now)).toMatch(/before now/);
    expect(validatePastStart(new Date('nope'), now)).toMatch(/valid/);
  });

  it('steps minutes within bounds', () => {
    expect(stepMinutes(60, 1)).toBe(75);
    expect(stepMinutes(15, -1)).toBe(15);
    expect(stepMinutes(480, 1)).toBe(480);
  });
});

describe('phone', () => {
  it('formats and validates SA numbers', () => {
    expect(formatPhoneDisplay('27821234567')).toBe('+27 82 123 4567');
    expect(phoneFieldState('082 123 4567')).toEqual({
      stored: '+27821234567', preview: 'WhatsApp: +27 82 123 4567', error: null,
    });
    expect(phoneFieldState('')).toEqual({ stored: null, preview: null, error: null });
    expect(phoneFieldState('12345').error).toMatch(/082/);
  });

  it('builds tel: URIs', () => {
    expect(telUri('082 123 4567')).toBe('tel:+27821234567');
    expect(telUri(null)).toBeNull();
  });
});

describe('student form', () => {
  const base: StudentFormValues = {
    fullName: 'Ana B', grade: 10, curriculum: 'CAPS',
    subjects: [{ key: 'k1', id: 'ss1', name: 'Maths', grade: null, curriculum: null, archived: false, initiallyArchived: false, balanceHours: 0, bookedLessons: 0 }],
    parentName: '', parentPhone: '', studentPhone: '', preferredContact: 'parent', travelFlatFee: '', travelDistanceKm: '',
    parentTravelMode: 'flat', parentTravelFlatFee: '', parentTravelPerKm: '',
  };

  it('validates required fields, phone and travel', () => {
    expect(validateStudentForm(base, 'flat')).toEqual({});
    const e = validateStudentForm(
      { ...base, fullName: ' ', grade: null, subjects: [], parentPhone: '1', studentPhone: '12', travelFlatFee: 'x' },
      'flat'
    );
    expect(Object.keys(e).sort()).toEqual(['fullName', 'grade', 'parentPhone', 'studentPhone', 'subjects', 'travel']);
    expect(validateStudentForm({ ...base, travelFlatFee: 'x' }, 'distance')).toEqual({});
    expect(validateStudentForm({ ...base, travelDistanceKm: '-3' }, 'distance')).toEqual({ travelKm: 'Enter a distance, e.g. 12,5' });
  });

  it('validates parent travel terms for the chosen mode only', () => {
    expect(validateStudentForm({ ...base, parentTravelMode: 'flat', parentTravelFlatFee: 'abc' }, 'flat').parentTravel)
      .toBe('Enter an amount, e.g. 50');
    expect(validateStudentForm({ ...base, parentTravelMode: 'per_km', parentTravelPerKm: '' }, 'flat').parentTravel)
      .toBe('Enter a rate per km, e.g. 4,50');
    expect(validateStudentForm({ ...base, parentTravelMode: 'per_km', parentTravelPerKm: '4,5', parentTravelFlatFee: 'x' }, 'flat'))
      .toEqual({});
    expect(validateStudentForm({ ...base, parentTravelMode: 'none', parentTravelFlatFee: 'x', parentTravelPerKm: 'y' }, 'flat'))
      .toEqual({});
  });

  it('contact payload: normalises both numbers and derives who to message', () => {
    expect(studentContactPayload({ ...base, parentName: ' Thandi ', parentPhone: '082 123 4567' })).toEqual({
      parentName: 'Thandi',
      parentPhone: '+27821234567',
      studentPhone: null,
      preferredContact: 'parent',
    });
    // only a student number → student, even if the (hidden) toggle says parent
    expect(studentContactPayload({ ...base, studentPhone: '083 111 2222' })).toMatchObject({
      studentPhone: '+27831112222',
      preferredContact: 'student',
    });
    // both → tutor's choice
    expect(
      studentContactPayload({ ...base, parentPhone: '0821234567', studentPhone: '0831112222', preferredContact: 'student' })
        .preferredContact
    ).toBe('student');
  });

  it('shows the "Send messages to" choice only when both numbers are valid', () => {
    expect(showPreferredContactChoice({ ...base, parentPhone: '0821234567', studentPhone: '0831112222' })).toBe(true);
    expect(showPreferredContactChoice({ ...base, parentPhone: '0821234567', studentPhone: '083' })).toBe(false);
  });

  it('detects dirty state ignoring surrounding whitespace', () => {
    expect(isStudentFormDirty(base, { ...base, fullName: 'Ana B ' })).toBe(false);
    expect(isStudentFormDirty(base, { ...base, grade: 11 })).toBe(true);
    expect(isStudentFormDirty(base, { ...base, parentPhone: '082' })).toBe(true);
    expect(isStudentFormDirty(base, { ...base, subjects: [...base.subjects] })).toBe(false);
    expect(isStudentFormDirty(base, { ...base, subjects: [{ ...base.subjects[0], name: 'Maths ' }] })).toBe(false);
    expect(isStudentFormDirty(base, { ...base, subjects: [{ ...base.subjects[0], name: 'Maths Lit' }] })).toBe(true);
    expect(isStudentFormDirty(base, { ...base, parentTravelMode: 'none' })).toBe(true);
  });
});

describe('archive / pause copy', () => {
  it('warns about credit and cancelled lessons', () => {
    const msg = archiveConfirmMessage('Ana', 2.5, 2);
    expect(msg).toContain('2h 30m of prepaid credit');
    expect(msg).toContain('2 booked lessons will be cancelled');
    expect(archiveConfirmMessage('Ana', -1, 1)).toContain('owe 1h');
    expect(archiveConfirmMessage('Ana', 0, 0)).not.toContain('cancelled');
  });

  it('toasts the cancelled count', () => {
    expect(archivedToastMessage(2)).toBe('Archived · 2 lessons cancelled');
    expect(archivedToastMessage(1)).toBe('Archived · 1 lesson cancelled');
    expect(archivedToastMessage(0)).toBe('Archived');
  });

  it('mentions booked lessons on pause', () => {
    expect(pauseConfirmMessage('Ana', 0)).not.toContain('booked');
    expect(pauseConfirmMessage('Ana', 3)).toContain('3 booked lessons');
  });
});

describe('ledger', () => {
  const entry = (over: Partial<Parameters<typeof ledgerDescription>[0]>) => ({
    id: 'e1', type: 'top_up' as const, hours_delta: 10, created_at: '2026-10-09T10:00:00Z', reason: null, ...over,
  });

  it('describes rows, including adjustment reasons', () => {
    expect(ledgerDescription(entry({}))).toBe('Top-up — 10h added');
    expect(ledgerDescription(entry({ type: 'session_deduction', hours_delta: -1 }), '["Algebra"]')).toBe('Lesson — Algebra');
    expect(ledgerDescription(entry({ type: 'session_deduction', hours_delta: -1 }), 'garbage')).toBe('Lesson');
    expect(ledgerDescription(entry({ type: 'session_deduction', hours_delta: -1, reason: 'No-show' }))).toBe('No-show (charged)');
    expect(ledgerDescription(entry({ type: 'adjustment', hours_delta: -1, reason: ' Double logged ' }))).toBe('Correction — Double logged');
  });

  it('groups by local month, preserving order', () => {
    const rows = [
      { id: '1', created_at: new Date(2026, 9, 9).toISOString() },
      { id: '2', created_at: new Date(2026, 9, 1).toISOString() },
      { id: '3', created_at: new Date(2026, 8, 30).toISOString() },
    ];
    const g = groupLedgerByMonth(rows);
    expect(g.map(x => x.title)).toEqual(['October 2026', 'September 2026']);
    expect(g[0].entries.map(e => e.id)).toEqual(['1', '2']);
  });

  it('routes rows and shortens ids', () => {
    expect(ledgerRowHref({ id: 'x', type: 'session_deduction', related_session_id: 's1' })).toBe('/lesson/s1');
    expect(ledgerRowHref({ id: 'x', type: 'top_up', related_session_id: null })).toBe('/transaction/x');
    expect(shortRef('3f2a9c1b-aaaa-bbbb')).toBe('#3F2A9C1B');
  });
});
