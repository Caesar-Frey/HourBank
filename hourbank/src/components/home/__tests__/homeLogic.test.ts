jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}),
}));

import {
  buildNeedsAttention,
  bookedStudentIds,
  splitToday,
  sortRoster,
  rosterSummary,
  overOweMessage,
  backupNudge,
  lessonEndIso,
  rosterSubjectBalances,
  worstSubjectBalance,
  rosterBalanceLine,
  rosterHoursTotals,
  rosterMatchesSearch,
  type RosterStudent,
} from '../homeLogic';
import type { Agenda, AgendaItem } from '../../../db/sessions';

function student(id: string, balance: number, extra: Partial<RosterStudent> = {}): RosterStudent {
  return {
    id,
    full_name: `Student ${id}`,
    grade: 10,
    subject: 'Maths',
    curriculum: 'CAPS',
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
    travel_flat_fee: 0,
    travel_distance_km: 0,
    payout_rate_override: null,
    current_balance: balance,
    next_session: null,
    ...extra,
  };
}

function lesson(id: string, studentId: string, scheduledFor: string, extra: Partial<AgendaItem> = {}): AgendaItem {
  return {
    id,
    student_id: studentId,
    mode: 'online',
    scheduled_for: scheduledFor,
    estimated_duration_minutes: 60,
    started_at: null,
    ended_at: null,
    paused_seconds: 0,
    duration_minutes: null,
    billed_minutes: null,
    paused_at: null,
    cancel_reason: null,
    topics: '[]',
    session_notes: null,
    status: 'scheduled',
    session_type: 'general',
    verified_at: null,
    updated_at: null,
    tutor_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    student_full_name: `Student ${studentId}`,
    student_subject: 'Maths',
    student_status: 'active',
    ...extra,
  };
}

const emptyAgenda: Agenda = { inProgress: [], overdue: [], today: [], upcoming: [] };

describe('bookedStudentIds', () => {
  test('collects students with a lesson today, upcoming or overdue, plus next_session', () => {
    const agenda: Agenda = {
      ...emptyAgenda,
      today: [lesson('l1', 'a', '2026-10-10T10:00:00')],
      upcoming: [lesson('l2', 'b', '2026-10-12T10:00:00')],
      overdue: [lesson('l3', 'c', '2026-10-08T10:00:00')],
    };
    const ids = bookedStudentIds(agenda, [
      student('d', 2, { next_session: lesson('l4', 'd', '2026-10-20T10:00:00') }),
      student('e', 2),
    ]);
    expect([...ids].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('buildNeedsAttention', () => {
  test('empty when nothing is wrong', () => {
    expect(buildNeedsAttention({ agenda: emptyAgenda, students: [student('a', 5)] })).toEqual([]);
  });

  test('overdue lessons link to the lesson screen, oldest first', () => {
    const agenda: Agenda = {
      ...emptyAgenda,
      overdue: [lesson('old', 'a', '2026-10-07T09:00:00'), lesson('new', 'b', '2026-10-09T09:00:00')],
    };
    const items = buildNeedsAttention({ agenda, students: [] });
    expect(items.map(i => i.href)).toEqual(['/lesson/old', '/lesson/new']);
    expect(items[0].kind).toBe('overdue');
    expect(items[0].title).toBe('Student a');
    expect(items[0].detail).toMatch(/^Not recorded · /);
    expect(items[0].recordHref).toBe('/student/a/log-past?sessionId=old');
  });

  test('overdue detail leads with the lesson subject when known', () => {
    const agenda: Agenda = { ...emptyAgenda, overdue: [lesson('o', 'a', '2026-10-07T09:00:00', { subject_name: 'Science' })] };
    expect(buildNeedsAttention({ agenda, students: [] })[0].detail).toMatch(/^Science · Not recorded · /);
  });

  test('students owing link to the student, most owed first', () => {
    const items = buildNeedsAttention({
      agenda: emptyAgenda,
      students: [student('a', -0.5), student('b', -2), student('c', 4)],
    });
    expect(items.map(i => [i.kind, i.href, i.detail])).toEqual([
      ['owing', '/student/b', 'Owes 2h'],
      ['owing', '/student/a', 'Owes 30m'],
    ]);
  });

  test('low balance only counts when a lesson is booked', () => {
    const agenda: Agenda = { ...emptyAgenda, upcoming: [lesson('l', 'booked', '2026-10-12T10:00:00')] };
    const items = buildNeedsAttention({
      agenda,
      students: [student('booked', 0.5), student('idle', 0.5), student('fine', 1)],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'low', href: '/student/booked', detail: '30m left · lesson booked' });
  });

  test('zero balance with a booked lesson is low, not owing', () => {
    const items = buildNeedsAttention({
      agenda: emptyAgenda,
      students: [student('z', 0, { next_session: lesson('l', 'z', '2026-10-12T10:00:00') })],
    });
    expect(items.map(i => i.kind)).toEqual(['low']);
    expect(items[0].detail).toBe('0m left · lesson booked');
  });

  test('ordering: overdue, then owing, then low; keys unique', () => {
    const agenda: Agenda = {
      ...emptyAgenda,
      overdue: [lesson('o', 'x', '2026-10-08T10:00:00')],
      today: [lesson('t', 'low', '2026-10-10T18:00:00')],
    };
    const items = buildNeedsAttention({ agenda, students: [student('low', 0.25), student('owe', -1)] });
    expect(items.map(i => i.kind)).toEqual(['overdue', 'owing', 'low']);
    expect(new Set(items.map(i => i.key)).size).toBe(items.length);
  });
});

describe('splitToday', () => {
  test('next is the first scheduled lesson today; live is the in-progress one', () => {
    const live = lesson('live', 'a', '2026-10-10T08:00:00', { status: 'paused', started_at: '2026-10-10T08:00:00' });
    const agenda: Agenda = {
      ...emptyAgenda,
      inProgress: [live],
      today: [lesson('n1', 'b', '2026-10-10T14:00:00'), lesson('n2', 'c', '2026-10-10T16:00:00')],
    };
    const t = splitToday(agenda);
    expect(t.live?.id).toBe('live');
    expect(t.next?.id).toBe('n1');
    expect(t.lessons.map(l => l.id)).toEqual(['n1', 'n2']);
  });

  test('nothing today', () => {
    expect(splitToday(emptyAgenda)).toEqual({ live: null, next: null, lessons: [] });
  });
});

describe('lessonEndIso', () => {
  test('adds booked length (defaults to 60)', () => {
    const start = new Date(2026, 9, 10, 9, 0).toISOString();
    expect(new Date(lessonEndIso(lesson('a', 'a', start, { estimated_duration_minutes: 90 }))).getHours()).toBe(10);
    expect(new Date(lessonEndIso(lesson('a', 'a', start, { estimated_duration_minutes: null }))).getHours()).toBe(10);
  });
});

describe('sortRoster', () => {
  const list = [
    student('b', 3, { full_name: 'Bongi', grade: 11 }),
    student('a', -1, { full_name: 'Aisha', grade: 9, next_session: lesson('x', 'a', '2026-10-15T10:00:00') }),
    student('c', 1, { full_name: 'Carl', grade: 12, next_session: lesson('y', 'c', '2026-10-11T10:00:00') }),
  ];
  test('balance ascending', () => expect(sortRoster(list, 'balance').map(s => s.id)).toEqual(['a', 'c', 'b']));
  test('next lesson soonest first, none last', () =>
    expect(sortRoster(list, 'next_session').map(s => s.id)).toEqual(['c', 'a', 'b']));
  test('name', () => expect(sortRoster(list, 'name').map(s => s.id)).toEqual(['a', 'b', 'c']));
  test('grade', () => expect(sortRoster(list, 'grade').map(s => s.id)).toEqual(['a', 'b', 'c']));
  test('does not mutate input', () => {
    sortRoster(list, 'name');
    expect(list.map(s => s.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('rosterSummary', () => {
  test('limited view', () => expect(rosterSummary(5, 12, 'balance')).toBe('Showing 5 of 12 · Sorted by lowest balance'));
  test('everything shown', () => expect(rosterSummary(3, 3, 'name')).toBe('Showing all 3 · Sorted by name'));
  test('single', () => expect(rosterSummary(1, 1, 'grade')).toBe('Showing 1 student · Sorted by grade'));
});

describe('overOweMessage', () => {
  test('no owing allowed', () => {
    const m = overOweMessage('Thandi', { balanceHours: 0.5, projectedBalanceHours: -0.5, maxOweHours: 0, lessonMinutes: 60 });
    expect(m.title).toBe('Start anyway?');
    expect(m.body).toBe('Thandi has 30m left. This 1h lesson will leave them owing 30m.');
  });

  test('past a positive limit, already owing', () => {
    const m = overOweMessage('Thandi', { balanceHours: -1, projectedBalanceHours: -2.5, maxOweHours: 2, lessonMinutes: 90 });
    expect(m.body).toBe('Thandi already owes 1h. This 1h 30m lesson will leave them owing 2h 30m — past your 2h limit.');
  });
});

describe('backupNudge', () => {
  test('hidden when recent', () => expect(backupNudge({ daysSince: 3, hasStudents: true, dismissedTier: null }).show).toBe(false));
  test('stale copy points at Settings → Back up now', () => {
    const n = backupNudge({ daysSince: 20.4, hasStudents: true, dismissedTier: null });
    expect(n).toEqual({ show: true, tier: 14, message: 'Last backup created 20 days ago. Settings → Back up now.' });
  });
  test('never backed up variant (only once there is data)', () => {
    expect(backupNudge({ daysSince: null, hasStudents: false, dismissedTier: null }).show).toBe(false);
    const n = backupNudge({ daysSince: null, hasStudents: true, dismissedTier: null });
    expect(n.show).toBe(true);
    expect(n.message).toBe("You haven't backed up yet. Settings → Back up now.");
  });
  test('respects dismissed tier', () => {
    expect(backupNudge({ daysSince: 20, hasStudents: true, dismissedTier: 14 }).show).toBe(false);
    expect(backupNudge({ daysSince: 31, hasStudents: true, dismissedTier: 14 }).show).toBe(true);
    expect(backupNudge({ daysSince: null, hasStudents: true, dismissedTier: 120 }).show).toBe(false);
  });
});

// ─── Multi-subject roster (B2) ──────────────────────────────────────────────

function multi(id: string, balances: Array<[string, number]>, extra: Partial<RosterStudent> = {}): RosterStudent {
  const subject_balances = balances.map(([subject, balance_hours]) => ({ subject_id: `${id}-${subject}`, subject, balance_hours }));
  return student(id, balances.reduce((t, [, b]) => t + b, 0), { subject: balances[0][0], subject_balances, ...extra });
}

describe('multi-subject roster helpers', () => {
  test('rosterSubjectBalances falls back to the total when no subject rows are loaded', () => {
    expect(rosterSubjectBalances(student('a', 2))).toEqual([{ subject_id: '', subject: 'Maths', balance_hours: 2 }]);
    expect(rosterSubjectBalances(multi('b', [['Maths', 3], ['Science', 0.75]])).map(b => b.subject)).toEqual(['Maths', 'Science']);
  });

  test('worst subject balance drives status', () => {
    expect(worstSubjectBalance(multi('b', [['Maths', 3], ['Science', 0.75]]))).toBe(0.75);
    expect(worstSubjectBalance(student('a', 2))).toBe(2);
  });

  test('balance line only for several subjects, compact and owing-aware', () => {
    expect(rosterBalanceLine(student('a', 2))).toBeNull();
    expect(rosterBalanceLine(multi('b', [['Maths', 3], ['Science', 0.75]]))).toBe('Maths 3h · Science 45m');
    expect(rosterBalanceLine(multi('c', [['Maths', 3], ['Science', -0.5]]))).toBe('Maths 3h · Science owes 30m');
  });

  test('hours banked / owed are summed per subject (credit in one does not hide owing in another)', () => {
    expect(rosterHoursTotals([multi('b', [['Maths', 5], ['Science', -1]]), student('a', -2)])).toEqual({ banked: 5, owed: 3 });
  });

  test('sort by balance uses the lowest subject balance', () => {
    const a = multi('a', [['Maths', 10], ['Science', 0.5]]);
    const b = student('b', 2);
    expect(sortRoster([b, a], 'balance').map(s => s.id)).toEqual(['a', 'b']);
  });

  test('search matches name or any subject', () => {
    const a = multi('a', [['Maths', 1], ['Physical Sciences', 1]]);
    expect(rosterMatchesSearch(a, 'phys')).toBe(true);
    expect(rosterMatchesSearch(a, 'student a')).toBe(true);
    expect(rosterMatchesSearch(a, 'english')).toBe(false);
  });

  test('needs attention: owing and low are per subject', () => {
    const s = multi('m', [['Maths', 4], ['Science', -1], ['English', 0.5]]);
    const agenda: Agenda = {
      ...emptyAgenda,
      upcoming: [lesson('l', 'm', '2026-10-12T10:00:00', { subject_id: 'm-English', subject_name: 'English' })],
    };
    const items = buildNeedsAttention({ agenda, students: [s] });
    expect(items.map(i => [i.kind, i.detail])).toEqual([
      ['owing', 'Science · owes 1h'],
      ['low', 'English · 30m left · lesson booked'],
    ]);
    expect(new Set(items.map(i => i.key)).size).toBe(2);
  });

  test('needs attention: low subject without a booking for that subject is skipped', () => {
    const s = multi('m', [['Maths', 0.5], ['Science', 0.5]]);
    const agenda: Agenda = {
      ...emptyAgenda,
      upcoming: [lesson('l', 'm', '2026-10-12T10:00:00', { subject_id: 'm-Science' })],
    };
    expect(buildNeedsAttention({ agenda, students: [s] }).map(i => i.detail)).toEqual(['Science · 30m left · lesson booked']);
  });
});
