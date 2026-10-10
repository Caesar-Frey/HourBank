/**
 * Pure helpers for the claim builder (app/claim/new.tsx).
 */
import type { ClaimablePoolLine } from '../../db/claims';
import { roundCents } from '../../utils/claim';

// ─── Period ──────────────────────────────────────────────────────────────────

function localMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** From must be on or before To (calendar days, local time). */
export function validateClaimPeriod(from: Date, to: Date): { ok: true } | { ok: false; error: string } {
  if (localMidnight(from).getTime() > localMidnight(to).getTime()) {
    return { ok: false, error: '“From” must be on or before “To”.' };
  }
  return { ok: true };
}

/**
 * Half-open [start, end) ISO range for an inclusive From–To day selection:
 * start = local midnight of From, end = local midnight AFTER To.
 */
export function claimRange(from: Date, to: Date): { start: string; end: string } {
  const start = localMidnight(from);
  const end = localMidnight(to);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

// ─── Selection (hold-backs) ──────────────────────────────────────────────────

/**
 * Selection is stored as the set of HELD-BACK session ids so a reload (focus,
 * range change) never re-selects lessons the tutor deliberately left out, and
 * newly claimable lessons are included by default. Ids no longer in the pool
 * are dropped.
 */
export function pruneHoldBacks(heldBack: ReadonlySet<string>, pool: Pick<ClaimablePoolLine, 'session_id'>[]): Set<string> {
  const ids = new Set(pool.map(l => l.session_id));
  return new Set([...heldBack].filter(id => ids.has(id)));
}

export function selectedIds(pool: Pick<ClaimablePoolLine, 'session_id'>[], heldBack: ReadonlySet<string>): string[] {
  return pool.filter(l => !heldBack.has(l.session_id)).map(l => l.session_id);
}

export function toggleHoldBack(heldBack: ReadonlySet<string>, sessionId: string): Set<string> {
  const next = new Set(heldBack);
  if (next.has(sessionId)) next.delete(sessionId);
  else next.add(sessionId);
  return next;
}

/** Select all → nothing held back. Select none → everything held back. */
export function holdBackAll(pool: Pick<ClaimablePoolLine, 'session_id'>[]): Set<string> {
  return new Set(pool.map(l => l.session_id));
}

// ─── Grouping ────────────────────────────────────────────────────────────────

export interface StudentGroup {
  studentId: string;
  studentName: string;
  lines: ClaimablePoolLine[];
  /** Sum of line totals of SELECTED lines. */
  selectedTotal: number;
  selectedCount: number;
}

/** Group pool lines by student (alphabetical), keeping each student's lines in date order. */
export function groupByStudent(pool: ClaimablePoolLine[], heldBack: ReadonlySet<string>): StudentGroup[] {
  const map = new Map<string, StudentGroup>();
  for (const line of pool) {
    let g = map.get(line.student_id);
    if (!g) {
      g = { studentId: line.student_id, studentName: line.student_full_name, lines: [], selectedTotal: 0, selectedCount: 0 };
      map.set(line.student_id, g);
    }
    g.lines.push(line);
    if (!heldBack.has(line.session_id)) {
      g.selectedTotal = roundCents(g.selectedTotal + line.line_total);
      g.selectedCount += 1;
    }
  }
  const groups = [...map.values()];
  for (const g of groups) g.lines.sort((a, b) => Date.parse(a.ended_at) - Date.parse(b.ended_at));
  return groups.sort((a, b) => a.studentName.localeCompare(b.studentName));
}
