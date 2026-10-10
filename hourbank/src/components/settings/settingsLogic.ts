/**
 * Pure helpers for the Settings tab (no React, no DB access) — unit tested.
 */
import type { PackageTier } from '../../db/tutorProfile';
import type { BackupSummary } from '../../utils/backup';
import { BILLING_TOLERANCE_MINUTES } from '../../utils/duration';
import { formatDateLong, parseDecimal } from '../../utils/format';

export const BILLING_ROUND_OPTIONS = [5, 10, 15, 30] as const;
export const RESTORE_CONFIRM_WORD = 'RESTORE';

export const MAX_OWE_EXPLANATION =
  "0 = warn before any owing. We'll always ask before a lesson takes a student past this — it never blocks.";

export function billingRoundingExplanation(roundMinutes: number): string {
  return (
    `If a lesson runs within ${BILLING_TOLERANCE_MINUTES} min of its booked length, the booked length is billed. ` +
    `Otherwise the actual time is rounded to the nearest ${roundMinutes} min. You can always adjust before saving.`
  );
}

// ─── Last backup ─────────────────────────────────────────────────────────────

function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/** "Never" / "Today" / "Yesterday" / "3 days ago" (local calendar days). */
export function lastBackupLabel(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'Never';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'Never';
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

// ─── Amount fields ───────────────────────────────────────────────────────────

export type Validated = { value: number | null; error: string | null };

/** parseDecimal with inline-error copy. Never turns bad input into a silent 0. */
export function validateAmount(text: string, opts: { positive?: boolean } = {}): Validated {
  if (!text || !text.trim()) return { value: null, error: 'Required' };
  const value = parseDecimal(text);
  if (value === null) return { value: null, error: 'Enter a number, e.g. 450 or 450.50' };
  if (value < 0) return { value: null, error: 'Must be 0 or more' };
  if (opts.positive && value <= 0) return { value: null, error: 'Must be more than 0' };
  return { value, error: null };
}

// ─── Package tiers ───────────────────────────────────────────────────────────

/** Editable tier: string fields keep half-typed input ("1,") intact; key is stable across edits/deletes. */
export type TierDraft = { key: string; hours: string; price: string; label: string; sort_order: number };
export type TierErrors = Record<string, { hours?: string; price?: string }>;

export function tierDraftsFromTiers(tiers: PackageTier[], makeKey: () => string): TierDraft[] {
  return [...tiers]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(t => ({
      key: makeKey(),
      hours: String(t.hours),
      price: String(t.price),
      label: t.label ?? '',
      sort_order: t.sort_order,
    }));
}

/** Every tier needs hours > 0 and a price ≥ 0. All-or-nothing: tiers is null when any draft is invalid. */
export function validateTierDrafts(drafts: TierDraft[]): { tiers: PackageTier[] | null; errors: TierErrors } {
  const errors: TierErrors = {};
  const tiers: PackageTier[] = [];
  for (const d of drafts) {
    const hours = validateAmount(d.hours, { positive: true });
    const price = validateAmount(d.price);
    if (hours.error || price.error) {
      errors[d.key] = {
        ...(hours.error ? { hours: hours.error } : {}),
        ...(price.error ? { price: price.error } : {}),
      };
      continue;
    }
    tiers.push({ hours: hours.value!, price: price.value!, label: d.label.trim(), sort_order: d.sort_order });
  }
  if (Object.keys(errors).length > 0) return { tiers: null, errors };
  return { tiers: tiers.sort((a, b) => a.sort_order - b.sort_order), errors };
}

// ─── Backup / restore copy ───────────────────────────────────────────────────

const BACKUP_ERROR_COPY: Record<string, string> = {
  NO_STORAGE: "Your phone doesn't have storage available to read the backup. Free up space and try again.",
  NOT_SQLITE: "That file isn't an HourBank backup. Pick a .db file made with \"Back up now\".",
  CORRUPT: "That backup file is damaged and can't be restored. Try an older backup.",
  MISSING_TABLES: "That file doesn't contain HourBank data. Pick a backup made with \"Back up now\".",
  NEWER_VERSION: 'This backup was made by a newer version of HourBank. Update the app, then try again.',
  RESTORE_FAILED: 'Restore failed — your previous data was kept. Try again or use another backup.',
};

export function backupErrorMessage(e: unknown): string {
  const code = (e as { name?: string; code?: string } | null)?.name === 'BackupError'
    ? (e as { code?: string }).code
    : undefined;
  return (code && BACKUP_ERROR_COPY[code]) || "Couldn't read that file. Try again or pick another backup.";
}

/** Label/value rows for the restore confirmation. */
export function restoreSummaryLines(s: BackupSummary): [string, string][] {
  const lines: [string, string][] = [
    ['Students', `${s.students} (${s.activeStudents} active)`],
    ['Lessons', String(s.sessions)],
    ['Ledger entries', String(s.ledgerRows)],
    ['Last entry', s.lastEntryAt ? formatDateLong(s.lastEntryAt) : 'None'],
  ];
  if (s.exportedAt) lines.push(['Backup created', formatDateLong(s.exportedAt)]);
  return lines;
}
