/**
 * Pure helpers for the Schedule → Agenda segment.
 * Input is `listAgenda()` output plus current student balances; no DB access.
 */
import type { Agenda, AgendaItem } from '../../db/sessions';
import { formatTime, formatTimeRange } from '../../utils/format';

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

/**
 * Projected balance (hours) after each lesson, deducting booked lengths in
 * chronological order per student. In-progress lessons deduct first (they will
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
    const start = running[item.student_id] ?? balances[item.student_id];
    if (start === undefined) continue; // unknown balance → no projection
    const after = start - bookedMinutes(item) / 60;
    running[item.student_id] = after;
    out[item.id] = after;
  }
  return out;
}

/** Hours the student would owe after this lesson, or null when not negative. */
export function owedAfter(projectedBalance: number | undefined): number | null {
  if (projectedBalance === undefined) return null;
  return projectedBalance < -EPS ? -projectedBalance : null;
}
