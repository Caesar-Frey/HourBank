import type { ClaimablePoolLine } from '../../../db/claims';
import {
  claimRange,
  groupByStudent,
  holdBackAll,
  pruneHoldBacks,
  selectedIds,
  toggleHoldBack,
  validateClaimPeriod,
} from '../claimModel';
import {
  isChargedNoShow,
  isFutureMonth,
  lessonBilledLabel,
  noShowChargedLabel,
  outstandingFromBalances,
  payoutHints,
  taughtLessonsLabel,
  shiftMonth,
} from '../moneyModel';

const line = (id: string, student: string, name: string, day: number, total = 100, over: Partial<ClaimablePoolLine> = {}): ClaimablePoolLine => ({
  session_id: id, student_id: student, student_full_name: name, ended_at: new Date(2026, 9, day, 10).toISOString(),
  mode: 'in_person', billed_hours: 1, lesson_fee: total, travel_fee: 0, line_total: total, ...over,
});

describe('claim period', () => {
  test('From must be on or before To (day granularity)', () => {
    expect(validateClaimPeriod(new Date(2026, 9, 9, 18), new Date(2026, 9, 9, 8))).toEqual({ ok: true });
    const bad = validateClaimPeriod(new Date(2026, 9, 10), new Date(2026, 9, 9));
    expect(bad.ok).toBe(false);
  });

  test('range is half-open on local midnights (To inclusive)', () => {
    const r = claimRange(new Date(2026, 8, 1, 15), new Date(2026, 8, 30, 9));
    expect(r.start).toBe(new Date(2026, 8, 1).toISOString());
    expect(r.end).toBe(new Date(2026, 9, 1).toISOString());
  });
});

describe('hold-backs', () => {
  const pool = [line('a', 's1', 'Zoe', 3), line('b', 's2', 'Ann', 2), line('c', 's1', 'Zoe', 1)];

  test('selection = pool minus hold-backs; reload keeps hold-backs and drops vanished ids', () => {
    let held = toggleHoldBack(new Set(), 'b');
    expect(selectedIds(pool, held)).toEqual(['a', 'c']);
    held = pruneHoldBacks(new Set(['b', 'gone']), pool);
    expect([...held]).toEqual(['b']);
    // a newly claimable lesson is selected by default
    expect(selectedIds([...pool, line('d', 's2', 'Ann', 4)], held)).toEqual(['a', 'c', 'd']);
  });

  test('select none / all', () => {
    expect(selectedIds(pool, holdBackAll(pool))).toEqual([]);
    expect(selectedIds(pool, new Set())).toHaveLength(3);
  });

  test('group by student alphabetically, lines in date order, selected totals', () => {
    const groups = groupByStudent(pool, new Set(['a']));
    expect(groups.map(g => g.studentName)).toEqual(['Ann', 'Zoe']);
    expect(groups[1].lines.map(l => l.session_id)).toEqual(['c', 'a']);
    expect(groups[1].selectedCount).toBe(1);
    expect(groups[1].selectedTotal).toBe(100);
  });
});

describe('money in', () => {
  test('month shifting + future guard', () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, monthIdx: 11 });
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, monthIdx: 0 });
    expect(isFutureMonth(2026, 10, new Date(2026, 9, 9))).toBe(true);
    expect(isFutureMonth(2026, 9, new Date(2026, 9, 9))).toBe(false);
  });

  test('outstanding splits owed vs prepaid', () => {
    expect(outstandingFromBalances([2, -1.5, 0, -0.5, 3])).toEqual({ owedHours: 2, owingStudents: 2, prepaidHours: 5 });
  });

  test('charged no-show detection + billed label', () => {
    expect(isChargedNoShow({ status: 'cancelled', cancel_reason: 'no_show' })).toBe(true);
    expect(isChargedNoShow({ status: 'completed', cancel_reason: null })).toBe(false);
    expect(lessonBilledLabel({ billed_minutes: 90 })).toBe('1h 30m');
  });
});

describe('Hours taught tile', () => {
  test('lesson count excludes no-shows (summary already split)', () => {
    expect(taughtLessonsLabel(2)).toBe('2 lessons taught');
    expect(taughtLessonsLabel(1)).toBe('1 lesson taught');
    expect(taughtLessonsLabel(0)).toBe('0 lessons taught');
  });

  test('charged no-shows shown separately, hidden when none', () => {
    expect(noShowChargedLabel(1, 1)).toBe('+ 1 no-show charged · 1h');
    expect(noShowChargedLabel(2, 1.5)).toBe('+ 2 no-shows charged · 1h 30m');
    expect(noShowChargedLabel(0, 0)).toBeNull();
  });
});

describe('payout hints', () => {
  test('zero rate and in-person lessons without travel', () => {
    const h = payoutHints(0, [line('a', 's', 'A', 1), line('b', 's', 'A', 1, 100, { mode: 'online' }), line('c', 's', 'A', 1, 100, { travel_fee: 50 })]);
    expect(h.zeroRate).toBe(true);
    expect(h.inPersonWithoutTravel).toBe(1);
    expect(payoutHints(600, []).zeroRate).toBe(false);
  });
});
