/**
 * Shared colour mapping for lessons, money events and calendar items.
 * Calendar, agenda, ledger and transaction screens must all read from here so
 * the same kind of thing is always the same colour.
 *
 * Rules:
 *   - Top-up (money in) is MOSS everywhere.
 *   - Lesson states / event types use indigo, teal, plum, oxblood and neutrals —
 *     never amber/crimson, which mean balance health.
 *   - Cancelled / no-show are neutral + struck through (`strike: true`), not red.
 */
import { COLORS } from './colors';

export type EventKindKey =
  | 'scheduled'   // upcoming lesson
  | 'overdue'     // scheduled in the past, never started → needs action
  | 'active'      // live or paused lesson
  | 'completed'   // taught + deducted
  | 'cancelled'
  | 'no_show'
  | 'top_up'      // money in
  | 'event'       // personal calendar event
  | 'time_block'; // busy / unavailable block

export interface EventKindStyle {
  /** Dot, stripe, icon and label text colour. */
  fg: string;
  /** Pill / block background. */
  fill: string;
  /** Human label for legends and filters. */
  label: string;
  /** Render title with line-through (cancelled-type states). */
  strike: boolean;
}

export const EVENT_KIND_COLORS: Record<EventKindKey, EventKindStyle> = {
  scheduled:  { fg: COLORS.indigo,   fill: COLORS.indigoFill,  label: 'Scheduled', strike: false },
  overdue:    { fg: COLORS.oxblood,  fill: COLORS.oxbloodFill, label: 'Overdue',   strike: false },
  active:     { fg: COLORS.ink,      fill: COLORS.paperDeep,   label: 'Live',      strike: false },
  completed:  { fg: COLORS.teal,     fill: COLORS.tealFill,    label: 'Completed', strike: false },
  cancelled:  { fg: COLORS.inkFaint, fill: COLORS.paperDeep,   label: 'Cancelled', strike: true },
  no_show:    { fg: COLORS.inkFaint, fill: COLORS.paperDeep,   label: 'No-show',   strike: true },
  top_up:     { fg: COLORS.moss,     fill: COLORS.okFill,      label: 'Top-up',    strike: false },
  event:      { fg: COLORS.plum,     fill: COLORS.plumFill,    label: 'Event',     strike: false },
  time_block: { fg: COLORS.inkSoft,  fill: COLORS.paperEdge,   label: 'Blocked',   strike: false },
};

/** Legend order for calendar / agenda keys. */
export const EVENT_KIND_LEGEND: EventKindKey[] = [
  'scheduled', 'overdue', 'completed', 'cancelled', 'top_up', 'event', 'time_block',
];

/**
 * Resolve any kind string used across the app to a style.
 * Accepts calendar kinds (`session_scheduled`, `session_completed`, …),
 * session statuses (`scheduled`, `active`, `paused`, `completed`, `cancelled`)
 * and ledger types (`top_up`). Unknown → scheduled style.
 */
export function eventKindStyle(kind: string): EventKindStyle {
  const k = kind.startsWith('session_') ? kind.slice('session_'.length) : kind;
  if (k === 'paused') return EVENT_KIND_COLORS.active;
  if (k in EVENT_KIND_COLORS) return EVENT_KIND_COLORS[k as EventKindKey];
  return EVENT_KIND_COLORS.scheduled;
}

export type LedgerKind = 'top_up' | 'session_deduction' | 'adjustment' | 'refund';

/**
 * Colour for a ledger hours delta. Money/hours in = moss; lesson deductions
 * are neutral ink (normal business, not an alarm); refunds out = crimson;
 * adjustments follow their sign.
 */
export function ledgerDeltaColor(type: LedgerKind | string, hoursDelta: number): string {
  if (type === 'top_up') return COLORS.moss;
  if (type === 'refund') return COLORS.crimson;
  if (type === 'session_deduction') return COLORS.ink;
  return hoursDelta >= 0 ? COLORS.moss : COLORS.ink;
}
