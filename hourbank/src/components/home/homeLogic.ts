/**
 * Pure helpers for the Home tab (no React, no DB access) — unit tested.
 */
import type { Agenda, AgendaItem, OweCheck } from '../../db/sessions';
import { DEFAULT_LESSON_MINUTES } from '../../db/sessions';
import type { Session, Student } from '../../db/schema';
import { formatDayShort, formatHours, formatMinutes, formatTime, pluralize } from '../../utils/format';
import { getCurrentNudgeTier, shouldShowNudge } from '../../utils/backup';

export type RosterStudent = Student & { current_balance: number; next_session: Session | null };

// ─── Today ───────────────────────────────────────────────────────────────────

export type TodaySplit = {
  /** The lesson currently running or paused (at most one). */
  live: AgendaItem | null;
  /** First lesson still to start today — gets the big Start button. */
  next: AgendaItem | null;
  /** Rest-of-today scheduled lessons, earliest first. */
  lessons: AgendaItem[];
};

export function splitToday(agenda: Agenda): TodaySplit {
  return {
    live: agenda.inProgress[0] ?? null,
    next: agenda.today.find(l => l.status === 'scheduled') ?? null,
    lessons: agenda.today,
  };
}

/** Booked end time of a scheduled lesson (start + booked length, default 60m). */
export function lessonEndIso(item: Pick<Session, 'scheduled_for' | 'estimated_duration_minutes'>): string {
  const start = new Date(item.scheduled_for ?? Date.now()).getTime();
  return new Date(start + (item.estimated_duration_minutes ?? DEFAULT_LESSON_MINUTES) * 60_000).toISOString();
}

// ─── Needs attention ─────────────────────────────────────────────────────────

export type AttentionKind = 'overdue' | 'owing' | 'low';

export type AttentionItem = {
  key: string;
  kind: AttentionKind;
  title: string;
  detail: string;
  href: string;
};

/** Students with any booked lesson (today / upcoming / overdue / roster next_session). */
export function bookedStudentIds(agenda: Agenda, students: RosterStudent[]): Set<string> {
  const ids = new Set<string>();
  for (const l of [...agenda.today, ...agenda.upcoming, ...agenda.overdue]) ids.add(l.student_id);
  for (const s of students) if (s.next_session) ids.add(s.id);
  return ids;
}

/**
 * Overdue lessons (→ lesson action screen), students owing (→ student), and
 * students under 1h with a lesson booked (→ student). Order: overdue (oldest
 * first), owing (most owed first), low (lowest first).
 */
export function buildNeedsAttention(input: { agenda: Agenda; students: RosterStudent[] }): AttentionItem[] {
  const { agenda, students } = input;
  const items: AttentionItem[] = [];

  for (const l of agenda.overdue) {
    const when = l.scheduled_for ? `${formatDayShort(l.scheduled_for)} ${formatTime(l.scheduled_for)}` : '';
    items.push({
      key: `overdue:${l.id}`,
      kind: 'overdue',
      title: l.student_full_name,
      detail: `Not logged · ${when}`.trim(),
      href: `/lesson/${l.id}`,
    });
  }

  const owing = students.filter(s => s.current_balance < 0).sort((a, b) => a.current_balance - b.current_balance);
  for (const s of owing) {
    items.push({
      key: `owing:${s.id}`,
      kind: 'owing',
      title: s.full_name,
      detail: `Owes ${formatHours(-s.current_balance)}`,
      href: `/student/${s.id}`,
    });
  }

  const booked = bookedStudentIds(agenda, students);
  const low = students
    .filter(s => s.current_balance >= 0 && s.current_balance < 1 && booked.has(s.id))
    .sort((a, b) => a.current_balance - b.current_balance);
  for (const s of low) {
    items.push({
      key: `low:${s.id}`,
      kind: 'low',
      title: s.full_name,
      detail: `${formatHours(s.current_balance)} left · lesson booked`,
      href: `/student/${s.id}`,
    });
  }
  return items;
}

// ─── Roster ──────────────────────────────────────────────────────────────────

export type SortMode = 'balance' | 'next_session' | 'name' | 'grade';

export const SORT_OPTIONS: { value: SortMode; label: string; summary: string }[] = [
  { value: 'balance', label: 'Lowest balance first', summary: 'lowest balance' },
  { value: 'next_session', label: 'Next lesson', summary: 'next lesson' },
  { value: 'name', label: 'Name A–Z', summary: 'name' },
  { value: 'grade', label: 'Grade', summary: 'grade' },
];

export function isSortMode(v: unknown): v is SortMode {
  return SORT_OPTIONS.some(o => o.value === v);
}

export function sortRoster<T extends RosterStudent>(students: T[], mode: SortMode): T[] {
  const arr = [...students];
  switch (mode) {
    case 'balance':
      return arr.sort((a, b) => a.current_balance - b.current_balance);
    case 'next_session': {
      const t = (s: T) => (s.next_session?.scheduled_for ? new Date(s.next_session.scheduled_for).getTime() : Infinity);
      return arr.sort((a, b) => t(a) - t(b));
    }
    case 'name':
      return arr.sort((a, b) => a.full_name.localeCompare(b.full_name));
    case 'grade':
      return arr.sort((a, b) => a.grade - b.grade);
    default:
      return arr;
  }
}

export function rosterSummary(shown: number, total: number, mode: SortMode): string {
  const sortLabel = SORT_OPTIONS.find(o => o.value === mode)?.summary ?? mode;
  const head =
    total === 1 && shown === 1
      ? 'Showing 1 student'
      : shown >= total
        ? `Showing all ${total}`
        : `Showing ${shown} of ${total}`;
  return `${head} · Sorted by ${sortLabel}`;
}

// ─── Start lesson nudge ──────────────────────────────────────────────────────

export function overOweMessage(
  studentName: string,
  d: Pick<OweCheck, 'balanceHours' | 'projectedBalanceHours' | 'maxOweHours' | 'lessonMinutes'>
): { title: string; body: string } {
  const now = d.balanceHours >= 0 ? `has ${formatHours(d.balanceHours)} left` : `already owes ${formatHours(-d.balanceHours)}`;
  const after = `This ${formatMinutes(d.lessonMinutes)} lesson will leave them owing ${formatHours(-d.projectedBalanceHours)}`;
  const limit = d.maxOweHours > 0 ? ` — past your ${formatHours(d.maxOweHours)} limit.` : '.';
  return { title: 'Start anyway?', body: `${studentName} ${now}. ${after}${limit}` };
}

// ─── Backup nudge ────────────────────────────────────────────────────────────

/** Treat "never backed up" as the oldest tier so a dismissal sticks until the first backup. */
const NEVER_BACKED_UP_DAYS = 999;

export function backupNudge(input: {
  daysSince: number | null;
  hasStudents: boolean;
  dismissedTier: number | null;
}): { show: boolean; tier: number | null; message: string } {
  const never = input.daysSince === null;
  const days = never ? NEVER_BACKED_UP_DAYS : input.daysSince!;
  const tier = getCurrentNudgeTier(days);
  const show = (!never || input.hasStudents) && shouldShowNudge(days, input.dismissedTier);
  const message = never
    ? "You haven't backed up yet. Settings → Back up now."
    : `Last backup created ${Math.floor(days)} ${pluralize(Math.floor(days), 'day')} ago. Settings → Back up now.`;
  return { show, tier, message };
}
