/**
 * claims.ts — Tutor Claims / payout service layer.
 *
 * A Claim is a payout event over delivered (`completed`) lessons. The claimable
 * pool and outstanding payout are DERIVED live (no `claimed` flag on sessions):
 * a session is claimable iff it is `completed` and not referenced by a
 * claim_line of a NON-voided claim. Claims are immutable once finalised — the
 * only writes to an existing claim are voidClaim (one-time void stamp) and
 * setClaimReportPath (write-once metadata). No update/delete API exists.
 *
 * Travel here is the tutor's PAYOUT travel (tutor_profile.travel_mode, per-lesson
 * km) — separate from the PARENT travel charge billed to families (travel.ts).
 *
 * Per-line pricing is single-sourced through src/utils/claim.ts so the live
 * rollup and the frozen finalisation snapshot produce identical numbers.
 */

import { getDb } from './client';
import { Claim, ClaimLine } from './schema';
import { newId } from './uuid';
import { effectiveRate, lessonFee, travelFee, roundCents } from '../utils/claim';

// Claim periods are stored half-open [start, end) with `end` = local midnight
// AFTER the last included day. Always display through formatClaimPeriod.
export { formatClaimPeriod, inclusivePeriodEnd } from '../utils/format';

/**
 * Payout rate used when no tutor_profile row exists yet. Mirrors the default
 * Settings shows (tutorProfile.ts upsert default / schema DEFAULT 600.0) so a
 * fresh install never silently prices lessons at R0.
 */
export const DEFAULT_PAYOUT_RATE = 600;

/**
 * SQL predicate: a session counts as a DELIVERED, billable lesson — completed,
 * or a charged no-show (cancelled + cancel_reason 'no_show' + billed minutes).
 * Shared by claims and reports so both agree on what was delivered.
 */
export function billableSessionSql(alias = 's'): string {
  return `(${alias}.status = 'completed' OR (${alias}.status = 'cancelled' AND ${alias}.cancel_reason = 'no_show' AND COALESCE(${alias}.billed_minutes, 0) > 0))`;
}

/** SQL: the instant a billable lesson is dated by (no-shows may lack ended_at). */
export function billableSessionDateSql(alias = 's'): string {
  return `COALESCE(${alias}.ended_at, ${alias}.started_at, ${alias}.scheduled_for)`;
}

export type ClaimablePoolLine = {
  session_id: string;
  student_id: string;
  student_full_name: string;
  ended_at: string;
  mode: 'in_person' | 'online';
  billed_hours: number;
  lesson_fee: number; // computed live
  travel_fee: number; // computed live
  line_total: number;
};

export type OutstandingPayout = {
  lessonFeeTotal: number;
  travelTotal: number;
  grandTotal: number;
  lessonCount: number;
};

export type ClaimSummary = Claim & { line_count: number };

type ProfileConfig = {
  hourly_rate: number;
  travel_mode: 'flat' | 'distance';
  per_km_rate: number;
};

type RawPoolRow = {
  session_id: string;
  student_id: string;
  student_full_name: string;
  ended_at: string;
  mode: 'in_person' | 'online';
  billed_minutes: number | null;
  duration_minutes: number | null;
  travel_flat_fee: number;
  /** Per-lesson km (sessions.travel_km) falling back to the student default. */
  travel_distance_km: number;
  payout_rate_override: number | null;
  status: string;
  /** 1 = a charged no-show the tutor marked "Include travel" (migration 011). */
  no_show_travel: number | null;
};

type Db = ReturnType<typeof getDb>;

/** Read the single tutor_profile row, falling back to safe defaults. */
function readProfileConfig(db: Db): ProfileConfig {
  const row = db.getFirstSync<ProfileConfig>(
    'SELECT hourly_rate, travel_mode, per_km_rate FROM tutor_profile LIMIT 1'
  );
  return {
    hourly_rate: row?.hourly_rate ?? DEFAULT_PAYOUT_RATE,
    travel_mode: row?.travel_mode ?? 'flat',
    per_km_rate: row?.per_km_rate ?? 0,
  };
}

/**
 * Price a raw pool row into a ClaimablePoolLine using the shared fee helpers.
 * This is the SINGLE per-line pricing path used by every live rollup and by the
 * finalisation snapshot — keeping live and frozen numbers identical.
 */
function priceLine(raw: RawPoolRow, profile: ProfileConfig): ClaimablePoolLine {
  const billedHours = (raw.billed_minutes ?? raw.duration_minutes ?? 0) / 60;
  const rate = effectiveRate(raw.payout_rate_override, profile.hourly_rate);
  const lesson = lessonFee(billedHours, rate);
  // A charged no-show carries a travel allowance only when the tutor switched
  // "Include travel" on for it (owner decision 2026-11-12).
  const noShowWithoutTravel = raw.status === 'cancelled' && !raw.no_show_travel;
  const travel = noShowWithoutTravel ? 0 : travelFee({
    mode: raw.mode,
    travelMode: profile.travel_mode,
    flatFee: raw.travel_flat_fee,
    distanceKm: raw.travel_distance_km,
    perKmRate: profile.per_km_rate,
  });
  return {
    session_id: raw.session_id,
    student_id: raw.student_id,
    student_full_name: raw.student_full_name,
    ended_at: raw.ended_at,
    mode: raw.mode,
    billed_hours: billedHours,
    lesson_fee: lesson,
    travel_fee: travel,
    line_total: roundCents(lesson + travel),
  };
}

/**
 * Derive the claimable pool as priced lines. Optionally filter on a half-open
 * date range [start, end) over sessions.ended_at, and/or restrict to a set of
 * session ids (used by buildClaim preview and finaliseClaim re-check).
 *
 * Claimable = billable (completed, or charged no-show) AND NOT referenced by a claim_line of
 * a non-voided claim (the §2.3 anti-join).
 */
function derivePoolLines(
  db: Db,
  opts: { range?: { start: string; end: string }; sessionIds?: string[] }
): ClaimablePoolLine[] {
  const where: string[] = [billableSessionSql('s')];
  const params: (string | number)[] = [];

  where.push(`NOT EXISTS (
    SELECT 1 FROM claim_lines cl
    JOIN claims c ON c.id = cl.claim_id
    WHERE cl.session_id = s.id AND c.voided_at IS NULL
  )`);

  if (opts.range) {
    where.push(`julianday(${billableSessionDateSql('s')}) >= julianday(?) AND julianday(${billableSessionDateSql('s')}) < julianday(?)`);
    params.push(opts.range.start, opts.range.end);
  }

  if (opts.sessionIds) {
    if (opts.sessionIds.length === 0) return [];
    const placeholders = opts.sessionIds.map(() => '?').join(', ');
    where.push(`s.id IN (${placeholders})`);
    params.push(...opts.sessionIds);
  }

  const rows = db.getAllSync<RawPoolRow>(
    `SELECT s.id AS session_id, s.student_id, st.full_name AS student_full_name,
            ${billableSessionDateSql('s')} AS ended_at, s.mode, s.billed_minutes, s.duration_minutes,
            st.travel_flat_fee, COALESCE(s.travel_km, st.travel_distance_km) AS travel_distance_km, st.payout_rate_override,
            s.status, s.no_show_travel
     FROM sessions s
     JOIN students st ON st.id = s.student_id
     WHERE ${where.join(' AND ')}
     ORDER BY julianday(${billableSessionDateSql('s')}) ASC`,
    params
  );

  const profile = readProfileConfig(db);
  return rows.map(r => priceLine(r, profile));
}

// ── Read functions ───────────────────────────────────────────────────────────

/** The tutor's default payout rate (R/h) used for claims; for "R0" hints in UI. */
export function getDefaultPayoutRate(): number {
  return readProfileConfig(getDb()).hourly_rate;
}

/** True when the claim has been voided (show VOID badge / watermark). */
export function isClaimVoided(claim: Pick<Claim, 'voided_at'>): boolean {
  return claim.voided_at != null;
}

/** All currently-claimable completed sessions, fee-priced live. */
export function listClaimablePool(range?: { start: string; end: string }): ClaimablePoolLine[] {
  return derivePoolLines(getDb(), { range });
}

/** Live outstanding payout aggregate, split into lesson-fee and travel. */
export function getOutstandingPayout(range?: { start: string; end: string }): OutstandingPayout {
  const lines = derivePoolLines(getDb(), { range });
  return aggregate(lines);
}

function aggregate(lines: ClaimablePoolLine[]): OutstandingPayout {
  const lessonFeeTotal = roundCents(lines.reduce((sum, l) => sum + l.lesson_fee, 0));
  const travelTotal = roundCents(lines.reduce((sum, l) => sum + l.travel_fee, 0));
  return {
    lessonFeeTotal,
    travelTotal,
    grandTotal: roundCents(lessonFeeTotal + travelTotal),
    lessonCount: lines.length,
  };
}

/** Claim history, newest first, including voided claims (flagged via voided_at). */
export function listClaims(): ClaimSummary[] {
  const db = getDb();
  return db.getAllSync<ClaimSummary>(
    `SELECT c.*,
            (SELECT COUNT(*) FROM claim_lines cl WHERE cl.claim_id = c.id) AS line_count
     FROM claims c
     ORDER BY c.created_at DESC, c.rowid DESC`
  );
}

export function getClaim(claimId: string): Claim | null {
  const db = getDb();
  return db.getFirstSync<Claim>('SELECT * FROM claims WHERE id = ?', [claimId]) ?? null;
}

export function getClaimLines(claimId: string): ClaimLine[] {
  const db = getDb();
  return db.getAllSync<ClaimLine>(
    'SELECT * FROM claim_lines WHERE claim_id = ? ORDER BY created_at ASC',
    [claimId]
  );
}

// ── Write functions (transactional, immutable) ───────────────────────────────

/**
 * Pure preview: price a candidate selection without writing. Only sessions that
 * are currently claimable are included. Used by the builder confirm screen.
 */
export function buildClaim(input: {
  sessionIds: string[];
  periodStart?: string | null;
  periodEnd?: string | null;
}): { lines: ClaimablePoolLine[]; lessonFeeTotal: number; travelTotal: number; grandTotal: number } {
  const lines = derivePoolLines(getDb(), { sessionIds: input.sessionIds });
  const agg = aggregate(lines);
  return {
    lines,
    lessonFeeTotal: agg.lessonFeeTotal,
    travelTotal: agg.travelTotal,
    grandTotal: agg.grandTotal,
  };
}

/**
 * Atomic finalisation. Re-derives the pool INSIDE the transaction and throws if
 * any requested sessionId is no longer claimable (already in a non-voided claim)
 * or not 'completed'. Freezes all snapshots (§2.5) and inserts the claim + lines.
 */
export function finaliseClaim(input: {
  sessionIds: string[];
  periodStart?: string | null;
  periodEnd?: string | null;
}): { claim: Claim } {
  const db = getDb();
  if (input.sessionIds.length === 0) {
    throw new Error('Cannot finalise a claim with no sessions selected');
  }

  let claimId = '';

  db.withTransactionSync(() => {
    const profile = readProfileConfig(db);

    // Re-derive the pool for exactly the requested sessions, inside the tx.
    const lines = derivePoolLines(db, { sessionIds: input.sessionIds });
    const found = new Set(lines.map(l => l.session_id));

    // Claimed-once re-check: every requested session must still be in the pool.
    for (const sid of input.sessionIds) {
      if (!found.has(sid)) {
        throw new Error(`Session ${sid} is no longer claimable (already claimed or not completed)`);
      }
    }

    const lessonFeeTotal = roundCents(lines.reduce((s, l) => s + l.lesson_fee, 0));
    const travelTotal = roundCents(lines.reduce((s, l) => s + l.travel_fee, 0));
    const grandTotal = roundCents(lessonFeeTotal + travelTotal);

    const id = newId();
    const now = new Date().toISOString();

    db.runSync(
      `INSERT INTO claims
        (id, tutor_id, period_start, period_end, payout_rate, travel_mode, per_km_rate,
         lesson_fee_total, travel_total, grand_total, report_path, voided_at, void_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
      [
        id,
        null,
        input.periodStart ?? null,
        input.periodEnd ?? null,
        profile.hourly_rate,
        profile.travel_mode,
        profile.per_km_rate,
        lessonFeeTotal,
        travelTotal,
        grandTotal,
        now,
      ]
    );

    for (const line of lines) {
      db.runSync(
        `INSERT INTO claim_lines
          (id, claim_id, session_id, billed_hours, mode, lesson_fee, travel_fee, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [newId(), id, line.session_id, line.billed_hours, line.mode, line.lesson_fee, line.travel_fee, now]
      );
    }

    claimId = id;
  });

  const claim = getClaim(claimId);
  if (!claim) throw new Error('Failed to load finalised claim');
  return { claim };
}

/**
 * One-time void: set voided_at (+ optional reason) on a non-voided claim. The
 * claim's lessons return to the pool automatically (derived). Throws if the
 * claim is already voided or does not exist. NEVER deletes rows.
 */
export function voidClaim(input: { claimId: string; reason?: string | null }): void {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.runSync(
    'UPDATE claims SET voided_at = ?, void_reason = ? WHERE id = ? AND voided_at IS NULL',
    [now, input.reason ?? null, input.claimId]
  );
  if (result.changes !== 1) {
    throw new Error('Claim not found or already voided');
  }
}

/** Persist the generated report path onto the claim row (write-once metadata). */
export function setClaimReportPath(claimId: string, path: string): void {
  const db = getDb();
  const result = db.runSync('UPDATE claims SET report_path = ? WHERE id = ?', [path, claimId]);
  if (result.changes !== 1) {
    throw new Error('Claim not found');
  }
}
