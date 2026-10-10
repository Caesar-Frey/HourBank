/**
 * Pure helpers for app/start-lesson.tsx (ad-hoc lesson starter).
 */
import { formatHours } from '../../utils/format';

const EPS = 1e-9;

export interface PickableStudent {
  id: string;
  full_name: string;
  subject?: string | null;
  current_balance: number;
}

/** Case-insensitive match on name or subject; empty query → all. */
export function filterStudents<T extends PickableStudent>(students: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return students;
  return students.filter(s =>
    s.full_name.toLowerCase().includes(q) || (s.subject ?? '').toLowerCase().includes(q));
}

/** Hours owed after a lesson of `minutes`, or null if the balance stays ≥ 0. */
export function owesAfterLesson(balanceHours: number, minutes: number): number | null {
  const after = balanceHours - minutes / 60;
  return after < -EPS ? -after : null;
}

/** "Owes 1h 30m" / "Will owe 30m after a 1h lesson" / null. */
export function balanceWarning(balanceHours: number, minutes: number): string | null {
  if (balanceHours < -EPS) return `Already owes ${formatHours(-balanceHours)}`;
  const owes = owesAfterLesson(balanceHours, minutes);
  return owes == null ? null : `Will owe ${formatHours(owes)} after a ${formatHours(minutes / 60)} lesson`;
}

/** Confirm copy for an OVER_OWE_LIMIT nudge. */
export function overOweMessage(
  studentName: string,
  details: { projectedBalanceHours?: unknown; maxOweHours?: unknown } | undefined,
): { title: string; message: string } {
  const projected = typeof details?.projectedBalanceHours === 'number' ? details.projectedBalanceHours : null;
  const maxOwe = typeof details?.maxOweHours === 'number' ? details.maxOweHours : null;
  const owes = projected != null && projected < 0 ? formatHours(-projected) : null;
  const title = owes ? `${studentName} will owe ${owes}` : `${studentName} is over the owing limit`;
  const limit =
    maxOwe == null ? '' : maxOwe <= 0 ? ' Your settings don’t allow owing.' : ` Your limit is ${formatHours(maxOwe)}.`;
  return { title, message: `Start anyway?${limit} You can ask for a top-up afterwards.` };
}
