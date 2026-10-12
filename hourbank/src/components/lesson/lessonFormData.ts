/**
 * DB reads for the Record / Edit lesson form and the timer review screen.
 * Kept out of the screens so they stay easy to mock in tests.
 */
import { getDb } from '../../db/client';
import { getPrimarySubjectId, getSubjectBalances, listStudentSubjects } from '../../db/subjects';
import { getOrCreateTutorProfile } from '../../db/tutorProfile';
import { listTopicsForStudentSubject } from '../../db/catalog';
import type { ParentTravelMode, Student } from '../../db/schema';
import { formatClaimPeriod } from '../../utils/format';

export type SubjectOption = { id: string; subject: string; balance: number };

/** Active subjects with their balances, display order (archived subjects can't be picked). */
export function loadSubjectOptions(studentId: string): { options: SubjectOption[]; primaryId: string | null } {
  const balances = new Map(getSubjectBalances(studentId).map(b => [b.id, b.balance_hours]));
  const options = listStudentSubjects(studentId).map(s => ({ id: s.id, subject: s.subject, balance: balances.get(s.id) ?? 0 }));
  return { options, primaryId: getPrimarySubjectId(studentId) };
}

/** Subject name for a lesson row (may be archived), or null. */
export function subjectNameFor(subjectId: string | null | undefined): string | null {
  if (!subjectId) return null;
  return getDb().getFirstSync<{ subject: string }>('SELECT subject FROM student_subjects WHERE id = ?', [subjectId])?.subject ?? null;
}

export function parentTravelTerms(student: Student): { parentTravelMode: ParentTravelMode; flatFee: number; perKm: number } {
  return {
    parentTravelMode: student.parent_travel_mode ?? 'none',
    flatFee: student.parent_travel_flat_fee ?? 0,
    perKm: student.parent_travel_per_km ?? 0,
  };
}

export function billingRoundMinutes(): number {
  try {
    const m = getOrCreateTutorProfile().billing_round_minutes;
    return m > 0 ? m : 15;
  } catch {
    return 15;
  }
}

export function catalogTopics(subjectName: string | null | undefined): string[] {
  if (!subjectName) return [];
  try {
    return listTopicsForStudentSubject(subjectName).map(t => t.name);
  } catch {
    return [];
  }
}

/** Period label of the (non-void) payout claim holding this lesson, e.g. "1–30 Sep 2026"; null if none. */
export function claimLabelForSession(sessionId: string): string | null {
  const row = getDb().getFirstSync<{ period_start: string | null; period_end: string | null }>(
    `SELECT c.period_start, c.period_end FROM claim_lines cl JOIN claims c ON c.id = cl.claim_id
     WHERE cl.session_id = ? AND c.voided_at IS NULL ORDER BY c.created_at DESC LIMIT 1`,
    [sessionId],
  );
  if (!row) return null;
  return formatClaimPeriod(row.period_start, row.period_end) || null;
}
