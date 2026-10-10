import type { Agenda, AgendaItem } from '../../../db/sessions';
import {
  agendaSections,
  agendaIsEmpty,
  agendaTimeLabel,
  bookedMinutes,
  owedAfter,
  projectAgendaBalances,
} from '../agendaModel';
import { sessionTypeLabel, modeLabel, paymentMethodLabel } from '../labels';

function item(over: Partial<AgendaItem>): AgendaItem {
  return {
    id: 'x', student_id: 's1', mode: 'in_person', scheduled_for: null, estimated_duration_minutes: null,
    started_at: null, ended_at: null, paused_seconds: 0, duration_minutes: null, billed_minutes: null,
    paused_at: null, cancel_reason: null, topics: '[]', session_notes: null, status: 'scheduled',
    session_type: 'general', verified_at: null, updated_at: null, tutor_id: null, created_at: '',
    student_full_name: 'Ann Lee', student_subject: 'Maths', student_status: 'active',
    ...over,
  };
}

const at = (h: number, m = 0, day = 9) => new Date(2026, 9, day, h, m).toISOString();

const empty: Agenda = { inProgress: [], overdue: [], today: [], upcoming: [] };

describe('agendaSections', () => {
  test('orders In progress, Overdue, Today, Upcoming and drops empty sections', () => {
    const a: Agenda = {
      inProgress: [item({ id: 'live', status: 'active' })],
      overdue: [],
      today: [item({ id: 't' })],
      upcoming: [item({ id: 'u' })],
    };
    expect(agendaSections(a).map(s => s.title)).toEqual(['In progress', 'Today', 'Upcoming']);
    expect(agendaIsEmpty(a)).toBe(false);
    expect(agendaIsEmpty(empty)).toBe(true);
  });
});

describe('agendaTimeLabel / bookedMinutes', () => {
  test('scheduled row shows booked range (null estimate = 60m)', () => {
    expect(bookedMinutes(item({}))).toBe(60);
    expect(agendaTimeLabel(item({ scheduled_for: at(9, 30) }))).toBe('09:30–10:30');
    expect(agendaTimeLabel(item({ scheduled_for: at(15), estimated_duration_minutes: 90 }))).toBe('15:00–16:30');
  });

  test('in-progress row shows start time and paused state', () => {
    expect(agendaTimeLabel(item({ status: 'active', started_at: at(8, 5) }))).toBe('Started 08:05');
    expect(agendaTimeLabel(item({ status: 'paused', started_at: at(8, 5) }))).toBe('Started 08:05 · Paused');
  });
});

describe('projectAgendaBalances', () => {
  test('deducts booked lengths chronologically per student, live lesson first', () => {
    const a: Agenda = {
      inProgress: [item({ id: 'live', student_id: 's1', status: 'active', started_at: at(8), estimated_duration_minutes: 60 })],
      overdue: [],
      today: [item({ id: 'a', student_id: 's1', scheduled_for: at(14), estimated_duration_minutes: 90 })],
      upcoming: [
        item({ id: 'c', student_id: 's1', scheduled_for: at(10, 0, 12) }),
        item({ id: 'b', student_id: 's2', scheduled_for: at(9, 0, 11) }),
      ],
    };
    const p = projectAgendaBalances(a, { s1: 2, s2: 0.5 });
    expect(p.live).toBeCloseTo(1);
    expect(p.a).toBeCloseTo(-0.5);
    expect(p.c).toBeCloseTo(-1.5);
    expect(p.b).toBeCloseTo(-0.5);
    expect(owedAfter(p.live)).toBeNull();
    expect(owedAfter(p.c)).toBeCloseTo(1.5);
  });

  test('unknown balance → no projection', () => {
    const p = projectAgendaBalances({ ...empty, today: [item({ id: 'z', student_id: 'ghost', scheduled_for: at(9) })] }, {});
    expect(p.z).toBeUndefined();
    expect(owedAfter(undefined)).toBeNull();
  });
});

describe('labels', () => {
  test('session types never render raw', () => {
    expect(sessionTypeLabel('test_prep')).toBe('Test prep');
    expect(sessionTypeLabel('exam_prep')).toBe('Exam prep');
    expect(sessionTypeLabel('some_new_type')).toBe('Some new type');
    expect(sessionTypeLabel(null)).toBe('General');
  });
  test('mode + payment method', () => {
    expect(modeLabel('in_person')).toBe('In person');
    expect(modeLabel('online')).toBe('Online');
    expect(paymentMethodLabel('eft')).toBe('EFT');
    expect(paymentMethodLabel(null)).toBe('');
  });
});
