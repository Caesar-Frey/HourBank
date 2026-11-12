/**
 * Pure helpers for the Record / Edit lesson form (no React, no DB) — unit tested.
 */
import type { ParentTravelMode, Session } from '../../db/schema';
import type { EditLessonPatch } from '../../db/sessions';
import { formatHours, formatRand, parseDecimal } from '../../utils/format';
import { parentTravelCharge } from '../../utils/travel';

export type LessonMode = Session['mode'];

/** Default lesson-length step; the tutor may switch to 15 in Settings. */
export const LESSON_STEP_MINUTES = 30;
export const LESSON_MIN_MINUTES = 15;
export const LESSON_MAX_MINUTES = 480;
export const LESSON_DEFAULT_MINUTES = 60;

const EPS = 1e-9;

/** The values the form edits (also the "original" snapshot in edit mode). */
export type LessonFormValues = {
  subjectId: string | null;
  start: Date;
  billedMinutes: number;
  mode: LessonMode;
  /** null when online. */
  travelKm: number | null;
  topics: string[];
  notes: string;
};

// ─── Defaults ────────────────────────────────────────────────────────────────

/** Booked subject if still active → primary → first active → null. */
export function defaultSubjectId(
  subjects: Array<{ id: string }>,
  bookedSubjectId: string | null | undefined,
  primaryId: string | null | undefined,
): string | null {
  if (bookedSubjectId && subjects.some(s => s.id === bookedSubjectId)) return bookedSubjectId;
  if (primaryId && subjects.some(s => s.id === primaryId)) return primaryId;
  return subjects[0]?.id ?? null;
}

export function defaultRecordMinutes(bookedMinutes: number | null | undefined): number {
  return bookedMinutes && bookedMinutes > 0 ? bookedMinutes : LESSON_DEFAULT_MINUTES;
}

/** Now floored to 15 min, minus the lesson length ("just finished"). */
function justTaughtStart(now: Date, minutes: number): Date {
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15);
  return new Date(d.getTime() - minutes * 60_000);
}

/**
 * Start time for a lesson being recorded: explicit → booked (if already begun) →
 * "just taught". A booking still in the future is recorded as just taught and
 * flagged so the form can say so.
 */
export function defaultRecordStart(args: {
  bookedStart?: string | null;
  explicitStart?: string | null;
  minutes: number;
  now: Date;
}): { start: Date; movedFromBooking: boolean } {
  if (args.explicitStart) {
    const d = new Date(args.explicitStart);
    if (!Number.isNaN(d.getTime())) return { start: d, movedFromBooking: false };
  }
  if (args.bookedStart) {
    const d = new Date(args.bookedStart);
    if (!Number.isNaN(d.getTime())) {
      if (d.getTime() <= args.now.getTime()) return { start: d, movedFromBooking: false };
      return { start: justTaughtStart(args.now, args.minutes), movedFromBooking: true };
    }
  }
  return { start: justTaughtStart(args.now, args.minutes), movedFromBooking: false };
}

/** Km shown in the form: online → null; lesson override → student default → 0. */
export function defaultTravelKm(args: {
  mode: LessonMode;
  lessonKm: number | null | undefined;
  studentKm: number | null | undefined;
}): number | null {
  if (args.mode === 'online') return null;
  return args.lessonKm ?? args.studentKm ?? 0;
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

export function parseKmInput(text: string): { value: number | null; error: string | null } {
  if (!text.trim()) return { value: null, error: null };
  const n = parseDecimal(text);
  if (n === null || !Number.isFinite(n)) return { value: null, error: 'Enter the km as a number, e.g. 12.5' };
  if (n < 0) return { value: null, error: 'Km can’t be negative' };
  if (n > 2000) return { value: null, error: 'That’s a lot of km — check the number' };
  return { value: Math.round(n * 10) / 10, error: null };
}

/** Quick picks on the record form (owner decision 2026-11-12). */
export const LESSON_LENGTH_PRESETS = [30, 60, 90, 120] as const;

/**
 * One stepper tap on a lesson length. Moves to the next grid line of `step`
 * (15 or 30), so an off-grid stored length (e.g. 50m) snaps only when the tutor
 * changes it: + → 60, − → 30 on a 30 grid. Never below one step.
 */
export function stepBilled(current: number, dir: 1 | -1, step: number = LESSON_STEP_MINUTES): number {
  const unit = step > 0 ? step : LESSON_STEP_MINUTES;
  const next = dir > 0
    ? Math.floor(current / unit + EPS) * unit + unit
    : Math.ceil(current / unit - EPS) * unit - unit;
  return Math.min(LESSON_MAX_MINUTES, Math.max(unit, next));
}

// ─── Previews ────────────────────────────────────────────────────────────────

function balanceText(h: number): string {
  if (Math.round(h * 60) < 0) return `owes ${formatHours(-h)}`;
  return formatHours(Math.abs(h));
}

/**
 * "Maths balance 3h → 2h". In edit mode the lesson's original deduction is
 * already inside `balanceNow` (when it was on the same subject), so it is added
 * back before the new billed time is taken off.
 */
export function balancePreview(args: {
  subjectName: string;
  /** Current balance of the selected subject. */
  balanceNow: number;
  billedMinutes: number;
  subjectId?: string | null;
  original?: { subjectId: string | null; billedMinutes: number } | null;
}): { before: number; after: number; owes: boolean; text: string } {
  const before = args.balanceNow;
  const refund =
    args.original && args.original.subjectId === (args.subjectId ?? null) ? args.original.billedMinutes / 60 : 0;
  const after = Math.round((before + refund - args.billedMinutes / 60) * 1e6) / 1e6;
  return {
    before,
    after,
    owes: after < -EPS,
    text: `${args.subjectName} balance ${balanceText(before)} → ${balanceText(after)}`,
  };
}

/**
 * Parent travel preview. Recording: "Travel R 120.00 added to travel owed".
 * Editing with km and mode unchanged: the snapshot stands ("… on travel owed");
 * changed: re-priced at the student's CURRENT rate ("… (was R 90.00)").
 * null when nothing is charged.
 */
export function travelPreview(args: {
  lessonMode: LessonMode;
  km: number | null;
  parentTravelMode: ParentTravelMode;
  flatFee: number;
  perKm: number;
  snapshot?: { fee: number | null; km: number | null; mode: LessonMode } | null;
}): { amount: number; text: string } | null {
  const snap = args.snapshot;
  if (snap && snap.mode === args.lessonMode && (args.lessonMode === 'online' || (snap.km ?? null) === (args.km ?? null))) {
    const fee = snap.fee ?? 0;
    return fee > 0 ? { amount: fee, text: `Travel ${formatRand(fee)} on travel owed` } : null;
  }
  const amount = parentTravelCharge({
    lessonMode: args.lessonMode,
    parentTravelMode: args.parentTravelMode,
    flatFee: args.flatFee,
    perKm: args.perKm,
    km: args.km ?? 0,
  });
  if (amount <= 0) {
    return snap && (snap.fee ?? 0) > 0 ? { amount: 0, text: `No travel charge (was ${formatRand(snap.fee ?? 0)})` } : null;
  }
  const was = snap && (snap.fee ?? 0) > 0 ? ` (was ${formatRand(snap.fee ?? 0)})` : '';
  return { amount, text: `Travel ${formatRand(amount)} added to travel owed${was}` };
}

// ─── Validation / edit patch ─────────────────────────────────────────────────

export type LessonFormErrors = Partial<Record<'start' | 'km' | 'subject' | 'billed', string>>;

export function validateLessonForm(
  v: { start: Date; billedMinutes: number; kmError: string | null; subjectId: string | null },
  now: Date = new Date(),
): LessonFormErrors {
  const e: LessonFormErrors = {};
  if (Number.isNaN(v.start.getTime())) e.start = 'Pick a valid date and time.';
  else if (v.start.getTime() > now.getTime() + 60_000) e.start = 'The lesson must start before now.';
  if (!(v.billedMinutes > 0)) e.billed = 'Bill at least 15 minutes.';
  if (v.kmError) e.km = v.kmError;
  if (!v.subjectId) e.subject = 'Pick a subject.';
  return e;
}

export function hasFormErrors(e: LessonFormErrors): boolean {
  return Object.values(e).some(Boolean);
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Only the fields the tutor changed (empty = nothing to save). */
export function buildEditPatch(original: LessonFormValues, next: LessonFormValues): EditLessonPatch {
  const p: EditLessonPatch = {};
  if (next.subjectId && next.subjectId !== original.subjectId) p.subjectId = next.subjectId;
  if (next.start.getTime() !== original.start.getTime()) p.startedAt = next.start.toISOString();
  // Billed time only; the actual taught length (timer lessons) is kept.
  if (next.billedMinutes !== original.billedMinutes) p.billedMinutes = next.billedMinutes;
  if (next.mode !== original.mode) p.mode = next.mode;
  if (next.mode === 'in_person' && (next.travelKm ?? null) !== (original.travelKm ?? null)) p.travelKm = next.travelKm;
  if (!sameList(next.topics, original.topics)) p.topics = next.topics;
  const notes = next.notes.trim();
  if (notes !== original.notes.trim()) p.notes = notes ? notes : null;
  return p;
}

export function claimWarning(inClaim: boolean, claimLabel?: string | null): string | null {
  if (!inClaim) return null;
  const which = claimLabel ? `the payout claim for ${claimLabel}` : 'a payout claim';
  return `This lesson is in ${which}. You can still edit it, but the submitted claim won’t change.`;
}

/**
 * Edit confirm for a lesson inside a finalised claim (B4): the claim stays
 * frozen, so say what that means in rand. null when nothing priced changed.
 */
export function claimEditEffect(a: {
  claimLabel: string | null;
  claimTotal: number;
  claimedHours: number;
  claimedMode: 'in_person' | 'online';
  claimedTravel: number;
  rate: number | null;
  newBilledMinutes: number;
  newMode: 'in_person' | 'online';
  formatRand: (n: number) => string;
}): { title: string; message: string } | null {
  const hoursChanged = Math.round(a.claimedHours * 60) !== Math.round(a.newBilledMinutes);
  const modeChanged = a.claimedMode !== a.newMode;
  if (!hoursChanged && !modeChanged) return null;
  const which = a.claimLabel ? `the ${a.claimLabel} claim` : 'a claim';
  const stays = `The claim stays at ${a.formatRand(a.claimTotal)}`;
  let diff = a.rate != null ? Math.round((a.newBilledMinutes / 60 - a.claimedHours) * a.rate * 100) / 100 : null;
  if (diff != null && modeChanged && a.newMode === 'online') diff = Math.round((diff - a.claimedTravel) * 100) / 100;
  const travelUnknown = modeChanged && a.newMode === 'in_person';
  let tail: string;
  if (diff == null || (diff === 0 && travelUnknown)) {
    tail = 'the change is only paid if you void and re-claim.';
  } else if (diff > 0) {
    tail = `the extra ${a.formatRand(diff)}${travelUnknown ? ' (plus travel)' : ''} is only paid if you void and re-claim.`;
  } else if (diff < 0) {
    tail = `it pays ${a.formatRand(-diff)} more than this lesson is now worth until you void and re-claim.`;
  } else {
    tail = 'nothing changes in rand.';
  }
  return { title: 'Already claimed', message: `This lesson is in ${which}. ${stays}; ${tail}` };
}

// ─── Timer review (end-session) ──────────────────────────────────────────────

export type TimerReviewOverrides = { subjectId?: string; travelKm?: number | null };

/** Subject / km the tutor changed on the timer review (only changed fields). */
export function timerReviewOverrides(a: {
  subjectId: string | null;
  bookedSubjectId: string | null;
  mode: LessonMode;
  km: number | null;
  initialKm: number | null;
}): TimerReviewOverrides {
  const o: TimerReviewOverrides = {};
  if (a.subjectId && a.subjectId !== a.bookedSubjectId) o.subjectId = a.subjectId;
  if (a.mode === 'in_person' && a.km !== a.initialKm) o.travelKm = a.km;
  return o;
}

/**
 * Subject change on the lesson form: drop selected topics that come from the old
 * subject's built-in catalog but aren't in the new one (e.g. Calculus on a Science
 * lesson). Topics the tutor typed (not in the old built-in catalog) stay selected.
 */
export function topicsAfterSubjectChange(a: {
  selected: string[];
  /** Built-in (non-custom) catalog topics of the subject being left. */
  oldCatalog: string[];
  /** Full catalog of the new subject. */
  newCatalog: string[];
}): { topics: string[]; selected: string[]; removed: string[] } {
  const removed = a.selected.filter(t => a.oldCatalog.includes(t) && !a.newCatalog.includes(t));
  const selected = a.selected.filter(t => !removed.includes(t));
  const topics = [...a.newCatalog, ...selected.filter(t => !a.newCatalog.includes(t))];
  return { topics, selected, removed };
}

/** Inline note after a subject change removed topics; null when nothing was removed. */
export function topicsUpdatedNote(removed: string[], subjectName: string): string | null {
  return removed.length > 0 ? `Topics updated for ${subjectName}` : null;
}
