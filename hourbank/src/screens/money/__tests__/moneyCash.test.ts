import { formatRand } from '../../../utils/format';
import { cashSplitLabel, mergeCashRows, travelOwedLabel } from '../moneyModel';

describe('money in: cash rows', () => {
  it('merges packages and travel newest first', () => {
    const rows = mergeCashRows(
      [{ id: 'p', created_at: '2026-10-05T10:00:00.000Z', student_full_name: 'A', amount_paid: 5500, payment_method: 'eft', hours_delta: 10, subject_name: 'Maths' }],
      [
        { id: 't1', created_at: '2026-10-07T10:00:00.000Z', student_full_name: 'A', amount: 360, payment_method: 'cash', package_id: null },
        { id: 't2', created_at: '2026-10-01T10:00:00.000Z', student_full_name: 'B', amount: 50, payment_method: 'eft', package_id: 'pk' },
      ]
    );
    expect(rows.map(r => r.id)).toEqual(['t1', 'p', 't2']);
    expect(rows[0]).toMatchObject({ kind: 'travel', withTopUp: false });
    expect(rows[1]).toMatchObject({ kind: 'package', hours: 10, subject: 'Maths' });
    expect(rows[2]).toMatchObject({ kind: 'travel', withTopUp: true });
  });

  it('labels the split and travel owed', () => {
    expect(cashSplitLabel(5860, 360)).toBe(`Packages ${formatRand(5500)} · Travel ${formatRand(360)}`);
    expect(cashSplitLabel(5500, 0)).toBeNull();
    expect(travelOwedLabel(1)).toBe('Travel owed by 1 family');
    expect(travelOwedLabel(3)).toBe('Travel owed by 3 families');
  });
});
