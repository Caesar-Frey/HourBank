/**
 * Charge an item to credit (F1).
 *
 * An item charge is an append-only `adjustment` ledger row with `item_name`
 * set: it takes hours from one subject's credit, shows as its own line in the
 * history, and never counts as a lesson (claims, lesson counts and travel are
 * all session-based, so they never see it). A mistake is undone by appending a
 * reversing `adjustment` (+hours) linked through `related_entry_id`.
 */
import { getDb } from './client';
import { appendEntryInTx } from './ledger';
import { checkOweLimit } from './sessions';
import { getTutorProfile } from './tutorProfile';
import type { LedgerEntry } from './schema';
import { newId } from './uuid';
import { normaliseHours } from '../utils/balance';

export const ITEM_REMOVED_REASON = 'Item charge removed';

export type SaleItem = {
  id: string;
  name: string;
  /** Default price in rand (for the record). */
  price: number | null;
  /** Default credit to take, in hours. */
  hours: number | null;
};

export type ItemErrorCode = 'INVALID' | 'NOT_FOUND' | 'ALREADY_REMOVED' | 'OVER_OWE_LIMIT';

export class ItemError extends Error {
  constructor(public code: ItemErrorCode, message: string, public details?: unknown) {
    super(message);
    this.name = 'ItemError';
  }
}

export function isItemError(e: unknown): e is ItemError {
  return e instanceof ItemError;
}

// ─── Saved items (Settings › Items you sell) ─────────────────────────────────

function positiveOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** Lenient parse of `tutor_profile.sale_items`; bad JSON or rows are dropped. */
export function parseSaleItems(json: string | null | undefined): SaleItem[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json) as unknown;
    if (!Array.isArray(raw)) return [];
    const out: SaleItem[] = [];
    for (const r of raw) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const name = typeof o.name === 'string' ? o.name.trim() : '';
      if (!name) continue;
      out.push({
        id: typeof o.id === 'string' && o.id ? o.id : newId(),
        name,
        price: positiveOrNull(o.price),
        hours: positiveOrNull(o.hours),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function getSaleItems(): SaleItem[] {
  return parseSaleItems(getTutorProfile()?.sale_items ?? '[]');
}

/** Replace the saved list (order is kept). Never touches past charges. */
export function saveSaleItems(items: SaleItem[]): void {
  const clean = items
    .map(i => ({ id: i.id || newId(), name: i.name.trim(), price: positiveOrNull(i.price), hours: positiveOrNull(i.hours) }))
    .filter(i => i.name.length > 0);
  const p = getTutorProfile();
  if (!p) throw new ItemError('NOT_FOUND', 'No tutor profile');
  getDb().runSync('UPDATE tutor_profile SET sale_items = ?, updated_at = ? WHERE id = ?', [
    JSON.stringify(clean), new Date().toISOString(), p.id,
  ]);
}

// ─── Suggest credit from price ───────────────────────────────────────────────

/**
 * Price ÷ parent hourly price, rounded to the nearest lesson-length step
 * (minimum one step). Null when there is no price or no rate.
 */
export function suggestItemHours(priceRand: number | null, parentHourlyPrice: number, stepMinutes: number): number | null {
  if (!priceRand || priceRand <= 0 || !parentHourlyPrice || parentHourlyPrice <= 0) return null;
  const step = stepMinutes > 0 ? stepMinutes : 30;
  const minutes = (priceRand / parentHourlyPrice) * 60;
  const steps = Math.max(1, Math.round(minutes / step));
  return (steps * step) / 60;
}

// ─── Charge / remove ─────────────────────────────────────────────────────────

export type ChargeItemInput = {
  studentId: string;
  subjectId?: string | null;
  itemName: string;
  hours: number;
  priceRand?: number | null;
  /** ISO date-time the item was sold; omitted = now. Clamped to now. */
  chargedAt?: string;
  /** Tutor confirmed after an OVER_OWE_LIMIT nudge. */
  allowOverOwe?: boolean;
};

export function chargeItem(input: ChargeItemInput): LedgerEntry {
  const name = input.itemName.trim();
  if (!name) throw new ItemError('INVALID', 'Item name is required');
  if (!Number.isFinite(input.hours) || input.hours <= 0) throw new ItemError('INVALID', 'Hours must be more than zero');
  const price = input.priceRand != null && Number.isFinite(input.priceRand) && input.priceRand > 0 ? input.priceRand : null;
  const exists = getDb().getFirstSync<{ id: string }>('SELECT id FROM students WHERE id = ?', [input.studentId]);
  if (!exists) throw new ItemError('NOT_FOUND', 'Student not found');

  if (!input.allowOverOwe) {
    const check = checkOweLimit(input.studentId, input.hours * 60, input.subjectId);
    if (check.overLimit) throw new ItemError('OVER_OWE_LIMIT', 'This charge goes past the owing limit', check);
  }

  const now = new Date();
  let createdAt = now.toISOString();
  if (input.chargedAt) {
    const d = new Date(input.chargedAt);
    if (Number.isNaN(d.getTime())) throw new ItemError('INVALID', 'Invalid date');
    createdAt = (d > now ? now : d).toISOString();
  }

  const db = getDb();
  let entry: LedgerEntry | null = null;
  db.withTransactionSync(() => {
    const e = appendEntryInTx({
      studentId: input.studentId,
      type: 'adjustment',
      hoursDelta: -input.hours,
      reason: name,
      subjectId: input.subjectId,
      createdAt,
      itemName: name,
      itemPriceRand: price,
    });
    entry = e;
  });
  return entry!;
}

export type ItemCharge = LedgerEntry & { removed_by: string | null };

export function getItemCharge(entryId: string): ItemCharge | null {
  const row = getDb().getFirstSync<ItemCharge>(
    `SELECT l.*, (SELECT r.id FROM ledger_entries r WHERE r.related_entry_id = l.id LIMIT 1) AS removed_by
       FROM ledger_entries l WHERE l.id = ? AND l.item_name IS NOT NULL`,
    [entryId]
  );
  return row ?? null;
}

/** Append the reversal; the charge itself is never edited. */
export function removeItemCharge(entryId: string): LedgerEntry {
  const charge = getItemCharge(entryId);
  if (!charge) throw new ItemError('NOT_FOUND', 'Item charge not found');
  if (charge.removed_by) throw new ItemError('ALREADY_REMOVED', 'This charge was already removed');
  const db = getDb();
  let entry: LedgerEntry | null = null;
  db.withTransactionSync(() => {
    const e = appendEntryInTx({
      studentId: charge.student_id,
      type: 'adjustment',
      hoursDelta: Math.abs(charge.hours_delta),
      reason: ITEM_REMOVED_REASON,
      subjectId: charge.subject_id ?? null,
      relatedEntryId: charge.id,
    });
    entry = e;
  });
  return entry!;
}

// ─── Totals for Money › From parents ─────────────────────────────────────────

/** Item charges in [from, to) that were not removed: hours taken and rand priced. */
export function itemTotals(fromIso: string, toIso: string): { count: number; hours: number; rand: number } {
  const row = getDb().getFirstSync<{ n: number; hours: number; rand: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(-l.hours_delta), 0) AS hours, COALESCE(SUM(l.item_price_rand), 0) AS rand
       FROM ledger_entries l
      WHERE l.item_name IS NOT NULL AND l.created_at >= ? AND l.created_at < ?
        AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.related_entry_id = l.id)`,
    [fromIso, toIso]
  );
  return { count: row?.n ?? 0, hours: normaliseHours(row?.hours ?? 0), rand: row?.rand ?? 0 };
}
