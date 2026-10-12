/**
 * Pure helpers for the Schedule → Agenda segment.
 * Input is `listAgenda()` output plus current student balances; no DB access.
 */
import type { Agenda, AgendaItem } from '../../db/sessions';
import { formatMinutes, formatTime, formatTimeRange } from '../../utils/format';
import { modeLabel, sessionTypeLabel } from './labels';

/** Matches sessions.ts DEFAULT_LESSON_MINUTES (not imported to keep this module DB-free). */
export const AGENDA_DEFAULT_MINUTES = 60;

const EPS = 1e-9;

export type AgendaSectionKey = 'inProgress' | 'overdue' | 'today' | 'upcoming';

export interface AgendaSection {
  key: AgendaSectionKey;
  title: string;
  items: AgendaItem[];
}

const SECTION_TITLES: Record<AgendaSectionKey, string> = {
  inProgress: 'In progress',
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Upcoming',
};

const SECTION_ORDER: AgendaSectionKey[] = ['inProgress', 'overdue', 'today', 'upcoming'];

/** Non-empty sections in display order. */
export function agendaSections(agenda: Agenda): AgendaSection[] {
  return SECTION_ORDER
    .filter(key => agenda[key].length > 0)
    .map(key => ({ key, title: SECTION_TITLES[key], items: agenda[key] }));
}

export function agendaIsEmpty(agenda: Agenda): boolean {
  return SECTION_ORDER.every(key => agenda[key].length === 0);
}

/** Booked length in minutes (null estimate → 60). */
export function bookedMinutes(item: Pick<AgendaItem, 'estimated_duration_minutes'>): number {
  const m = item.estimated_duration_minutes;
  return m != null && m > 0 ? m : AGENDA_DEFAULT_MINUTES;
}

/**
 * Time label for an agenda row:
 *   scheduled → "09:30–10:30"; in progress → "Started 09:32" (or "Paused" when paused).
 */
export function agendaTimeLabel(item: AgendaItem): string {
  if (item.status === 'active' || item.status === 'paused') {
    const started = item.started_at ? `Started ${formatTime(item.started_at)}` : 'Started';
    return item.status === 'paused' ? `${started} · Paused` : started;
  }
  if (!item.scheduled_for) return '';
  const end = new Date(Date.parse(item.scheduled_for) + bookedMinutes(item) * 60_000);
  return formatTimeRange(item.scheduled_for, end);
}

/** Balance-map key for a lesson: per subject when known, else the student. */
export function agendaBalanceKey(item: Pick<AgendaItem, 'student_id' | 'subject_id'>): string {
  return item.subject_id ? `${item.student_id}|${item.subject_id}` : item.student_id;
}

/** Balances keyed by student id (total) and `student|subject` (per subject). */
export function subjectBalanceMap(
  students: Array<{ id: string; current_balance: number; subject_balances?: Array<{ subject_id: string; balance_hours: number }> }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of students) {
    out[s.id] = s.current_balance;
    for (const b of s.subject_balances ?? []) out[`${s.id}|${b.subject_id}`] = b.balance_hours;
  }
  return out;
}

/** Second line of an agenda row: subject · type · mode · booked length. */
export function agendaRowDetails(item: AgendaItem): string[] {
  return [
    item.subject_name || item.student_subject,
    sessionTypeLabel(item.session_type),
    modeLabel(item.mode),
    `${formatMinutes(bookedMinutes(item))} booked`,
  ].filter(Boolean);
}

/** Inline actions on a row (Record first = primary). */
export function agendaRowActions(section: AgendaSectionKey): Array<'record' | 'timer'> {
  return section === 'overdue' || section === 'today' ? ['record', 'timer'] : [];
}

/**
 * Projected balance (hours) after each lesson, deducting booked lengths in
 * chronological order per student (per SUBJECT when the balance map has
 * `student|subject` keys; otherwise the student's total). In-progress lessons deduct first (they will
 * be billed before anything still scheduled). Returns sessionId → balance after.
 */
export function projectAgendaBalances(
  agenda: Agenda,
  balances: Record<string, number>,
): Record<string, number> {
  const all: AgendaItem[] = [...agenda.inProgress, ...agenda.overdue, ...agenda.today, ...agenda.upcoming];
  const ordered = [...all].sort((a, b) => {
    const rank = (x: AgendaItem) => (x.status === 'active' || x.status === 'paused' ? 0 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return Date.parse(a.scheduled_for ?? a.started_at ?? '') - Date.parse(b.scheduled_for ?? b.started_at ?? '');
  });

  const running: Record<string, number> = {};
  const out: Record<string, number> = {};
  for (const item of ordered) {
    const subjectKey = agendaBalanceKey(item);
    const key = balances[subjectKey] !== undefined || running[subjectKey] !== undefined ? subjectKey : item.student_id;
    const start = running[key] ?? balances[key];
    if (start === undefined) continue; // unknown balance → no projection
    const after = start - bookedMinutes(item) / 60;
    running[key] = after;
    out[item.id] = after;
  }
  return out;
}

/** Hours the student would owe after this lesson, or null when not negative. */
export function owedAfter(projectedBalance: number | undefined): number | null {
  if (projectedBalance === undefined) return null;
  return projectedBalance < -EPS ? -projectedBalance : null;
}
