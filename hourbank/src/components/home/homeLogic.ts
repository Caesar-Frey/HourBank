/**
 * Pure helpers for the Home tab (no React, no DB access) — unit tested.
 */
import type { Agenda, AgendaItem, OweCheck } from '../../db/sessions';
import { DEFAULT_LESSON_MINUTES } from '../../db/sessions';
import type { Session, Student } from '../../db/schema';
import type { StudentSubjectBalanceSummary } from '../../db/students';
import { formatDayShort, formatHours, formatMinutes, formatTime, pluralize } from '../../utils/format';
import { getCurrentNudgeTier, shouldShowNudge } from '../../utils/backup';
import { rosterSubjectBalances, worstSubjectBalance } from '../../utils/subjectBalances';

export { rosterBalanceLine, rosterSubjectBalances, worstSubjectBalance } from '../../utils/subjectBalances';
export type { SubjectBalanceSource } from '../../utils/subjectBalances';

export type RosterStudent = Student & {
  current_balance: number;
  next_session: Session | null;
  /** Active subjects with their own balances (listActiveStudents / listPausedStudents). */
  subject_balances?: StudentSubjectBalanceSummary[];
};

// ─── Subjects (each has its own balance) ─────────────────────────────────────

/** Hours banked / owed across students, summed per subject. */
export function rosterHoursTotals(students: RosterStudent[]): { banked: number; owed: number } {
  let banked = 0;
  let owed = 0;
  for (const s of students) {
    for (const b of rosterSubjectBalances(s)) {
      if (b.balance_hours > 0) banked += b.balance_hours;
      else owed += -b.balance_hours;
    }
  }
  return { banked, owed };
}

/** Search on name or any subject name (case-insensitive). */
export function rosterMatchesSearch(s: RosterStudent, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (s.full_name.toLowerCase().includes(q) || s.subject.toLowerCase().includes(q)) return true;
  return rosterSubjectBalances(s).some(b => b.subject.toLowerCase().includes(q));
}

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
  /** Overdue lessons: straight to the Record lesson form (primary action). */
  recordHref?: string;
};

/** Students with any booked lesson (today / upcoming / overdue / roster next_session). */
export function bookedStudentIds(agenda: Agenda, students: RosterStudent[]): Set<string> {
  const ids = new Set<string>();
  for (const l of [...agenda.today, ...agenda.upcoming, ...agenda.overdue]) ids.add(l.student_id);
  for (const s of students) if (s.next_session) ids.add(s.id);
  return ids;
}

/**
 * "studentId:subjectId" for every booked lesson. Lessons without a subject id
 * (legacy rows, roster next_session) count for the student's first subject.
 */
export function bookedSubjectKeys(agenda: Agenda, students: RosterStudent[]): Set<string> {
  const first = new Map(students.map(s => [s.id, rosterSubjectBalances(s)[0]?.subject_id ?? '']));
  const keys = new Set<string>();
  for (const l of [...agenda.today, ...agenda.upcoming, ...agenda.overdue]) {
    keys.add(`${l.student_id}:${l.subject_id ?? first.get(l.student_id) ?? ''}`);
  }
  for (const s of students) {
    if (s.next_session) keys.add(`${s.id}:${s.next_session.subject_id ?? first.get(s.id) ?? ''}`);
  }
  return keys;
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
      detail: [l.subject_name, 'Not recorded', when].filter(Boolean).join(' · '),
      href: `/lesson/${l.id}`,
      recordHref: `/student/${l.student_id}/log-past?sessionId=${l.id}`,
    });
  }

  // Per subject: each subject has its own balance. Single-subject students keep the short copy.
  type Row = { student: RosterStudent; subjectId: string; subject: string; balance: number; multi: boolean };
  const rows: Row[] = [];
  for (const s of students) {
    const list = rosterSubjectBalances(s);
    for (const b of list) {
      rows.push({ student: s, subjectId: b.subject_id, subject: b.subject, balance: b.balance_hours, multi: list.length > 1 });
    }
  }
  const key = (kind: string, r: Row) => (r.multi ? `${kind}:${r.student.id}:${r.subjectId}` : `${kind}:${r.student.id}`);

  const owing = rows.filter(r => r.balance < 0).sort((a, b) => a.balance - b.balance);
  for (const r of owing) {
    items.push({
      key: key('owing', r),
      kind: 'owing',
      title: r.student.full_name,
      detail: r.multi ? `${r.subject} · owes ${formatHours(-r.balance)}` : `Owes ${formatHours(-r.balance)}`,
      href: `/student/${r.student.id}`,
    });
  }

  const booked = bookedStudentIds(agenda, students);
  const bookedSubjects = bookedSubjectKeys(agenda, students);
  const low = rows
    .filter(r => r.balance >= 0 && r.balance < 1)
    .filter(r => (r.multi ? bookedSubjects.has(`${r.student.id}:${r.subjectId}`) : booked.has(r.student.id)))
    .sort((a, b) => a.balance - b.balance);
  for (const r of low) {
    const left = `${formatHours(r.balance)} left · lesson booked`;
    items.push({
      key: key('low', r),
      kind: 'low',
      title: r.student.full_name,
      detail: r.multi ? `${r.subject} · ${left}` : left,
      href: `/student/${r.student.id}`,
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
      return arr.sort((a, b) => worstSubjectBalance(a) - worstSubjectBalance(b));
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
