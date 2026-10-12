/**
 * subjectLogic.ts — pure helpers for the student form's Subjects editor.
 * No React, no DB: unit-tested in __tests__/subjectLogic.test.ts.
 *
 * Each subject has its own hours balance. Subjects are never deleted — an
 * existing subject can only be archived (balance kept) or restored.
 */
import { formatHours, pluralize } from '../../utils/format';

export type SubjectDraft = {
  /** Stable React key (the subject id for saved rows). */
  key: string;
  /** student_subjects.id; null = not saved yet. */
  id: string | null;
  name: string;
  /** null = same as the student. */
  grade: number | null;
  /** null = same as the student. */
  curriculum: string | null;
  /** Marked archived (saved rows only — unsaved rows are simply removed). */
  archived: boolean;
  /** Archived when the form opened (lets the editor offer Restore). */
  initiallyArchived: boolean;
  balanceHours: number;
  bookedLessons: number;
};

type SubjectRowLike = {
  id: string;
  subject: string;
  grade: number | null;
  curriculum: string | null;
  status: 'active' | 'archived';
};

export function subjectDraftsFromRows(
  rows: SubjectRowLike[],
  balances: Record<string, number> = {},
  booked: Record<string, number> = {},
): SubjectDraft[] {
  return rows.map(r => ({
    key: r.id,
    id: r.id,
    name: r.subject,
    grade: r.grade,
    curriculum: r.curriculum,
    archived: r.status === 'archived',
    initiallyArchived: r.status === 'archived',
    balanceHours: balances[r.id] ?? 0,
    bookedLessons: booked[r.id] ?? 0,
  }));
}

let draftSeq = 0;

export function newSubjectDraft(name = ''): SubjectDraft {
  draftSeq += 1;
  return {
    key: `new-${Date.now().toString(36)}-${draftSeq}`,
    id: null,
    name,
    grade: null,
    curriculum: null,
    archived: false,
    initiallyArchived: false,
    balanceHours: 0,
    bookedLessons: 0,
  };
}

export function cleanSubjectName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function activeSubjectDrafts(drafts: SubjectDraft[]): SubjectDraft[] {
  return drafts.filter(d => !d.archived);
}

/** Error message for the Subjects field, or null when valid. */
export function validateSubjectDrafts(drafts: SubjectDraft[]): string | null {
  const active = activeSubjectDrafts(drafts);
  if (active.length === 0) return 'Add at least one subject.';
  if (active.some(d => cleanSubjectName(d.name) === '')) {
    return 'Every subject needs a name — or remove the empty row.';
  }
  const seen = new Map<string, string>();
  for (const d of active) {
    const name = cleanSubjectName(d.name);
    const k = name.toLowerCase();
    if (seen.has(k)) return `${seen.get(k)} is listed twice.`;
    seen.set(k, name);
  }
  return null;
}

export type SubjectPatch = { subject?: string; grade?: number | null; curriculum?: string | null };

export type SubjectChangePlan = {
  add: Array<{ name: string; grade: number | null; curriculum: string | null }>;
  update: Array<{ id: string; patch: SubjectPatch }>;
  archive: string[];
  restore: Array<{ id: string; name: string }>;
};

/** What to write to turn `initial` into `current` (unsaved blank rows are ignored). */
export function planSubjectChanges(initial: SubjectDraft[], current: SubjectDraft[]): SubjectChangePlan {
  const plan: SubjectChangePlan = { add: [], update: [], archive: [], restore: [] };
  const before = new Map(initial.filter(d => d.id).map(d => [d.id as string, d]));
  for (const d of current) {
    const name = cleanSubjectName(d.name);
    if (!d.id) {
      if (!d.archived && name) plan.add.push({ name, grade: d.grade, curriculum: d.curriculum });
      continue;
    }
    const was = before.get(d.id);
    if (!was) continue;
    if (d.archived && !was.archived) {
      plan.archive.push(d.id);
      continue;
    }
    if (!d.archived && was.archived) {
      plan.restore.push({ id: d.id, name: cleanSubjectName(was.name) });
      continue;
    }
    if (d.archived) continue;
    const patch: SubjectPatch = {};
    if (name && name !== cleanSubjectName(was.name)) patch.subject = name;
    if (d.grade !== was.grade) patch.grade = d.grade;
    if (d.curriculum !== was.curriculum) patch.curriculum = d.curriculum;
    if (Object.keys(patch).length > 0) plan.update.push({ id: d.id, patch });
  }
  return plan;
}

export function subjectsChanged(initial: SubjectDraft[], current: SubjectDraft[]): boolean {
  const p = planSubjectChanges(initial, current);
  return p.add.length + p.update.length + p.archive.length + p.restore.length > 0;
}

/** Confirmation copy before archiving a subject; null when nothing is at stake. */
export function subjectArchiveWarning(d: Pick<SubjectDraft, 'name' | 'balanceHours' | 'bookedLessons'>): string | null {
  const name = cleanSubjectName(d.name) || 'This subject';
  const minutes = Math.round(d.balanceHours * 60);
  const parts: string[] = [];
  if (minutes !== 0) {
    const status = minutes > 0
      ? `${name} still has ${formatHours(d.balanceHours)} of prepaid credit.`
      : `${name} owes ${formatHours(-d.balanceHours)}.`;
    parts.push(`${status} The balance is kept and comes back if you add ${name} again.`);
  }
  if (d.bookedLessons > 0) {
    const n = d.bookedLessons;
    parts.push(
      `${n} booked ${pluralize(n, 'lesson')} ${n === 1 ? 'is' : 'are'} still for ${name} — move or cancel ${n === 1 ? 'it' : 'them'}.`
    );
  }
  return parts.length > 0 ? parts.join(' ') : null;
}
