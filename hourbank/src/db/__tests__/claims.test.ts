/**
 * claims.test.ts — service-layer tests for the Tutor Claims / payout feature.
 *
 * Uses the in-memory harness (createTestDb) and runs the full migration chain
 * (002 → 006) so the claims/claim_lines tables and the new travel columns exist,
 * exactly as the app has them at boot.
 */

import { createTestDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import { runMigrations } from '../migrations';
import { createStudent } from '../students';
import { upsertTutorProfile } from '../tutorProfile';
import {
  listClaimablePool,
  getOutstandingPayout,
  listClaims,
  getClaim,
  getClaimLines,
  buildClaim,
  finaliseClaim,
  voidClaim,
  setClaimReportPath,
} from '../claims';

function allMigrations() {
  return require('../migrations').ALL_MIGRATIONS;
}

describe('claims service', () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb();
    runMigrations(allMigrations());
    // Default tutor config: R600/h, flat travel.
    upsertTutorProfile({ hourly_rate: 600, travel_mode: 'flat', per_km_rate: 0 });
  });

  afterEach(() => {
    resetDbSingleton();
  });

  // ── helpers ────────────────────────────────────────────────────────────────

  function makeStudent(opts?: {
    id?: string;
    name?: string;
    travelFlatFee?: number;
    travelDistanceKm?: number;
    payoutRateOverride?: number | null;
  }): string {
    const s = createStudent({
      fullName: opts?.name ?? 'Test Student',
      grade: 10,
      subject: 'Mathematics',
      curriculum: 'CAPS',
      travelFlatFee: opts?.travelFlatFee ?? 0,
      travelDistanceKm: opts?.travelDistanceKm ?? 0,
      payoutRateOverride: opts?.payoutRateOverride ?? null,
    });
    return s.id;
  }

  let seq = 0;
  function insertSession(
    studentId: string,
    opts: {
      status?: string;
      mode?: 'in_person' | 'online';
      billedMinutes?: number;
      endedAt?: string;
    }
  ): string {
    const id = `sess-${++seq}`;
    const status = opts.status ?? 'completed';
    const mode = opts.mode ?? 'in_person';
    const billed = opts.billedMinutes ?? 60;
    const ended = opts.endedAt ?? '2026-03-15T10:00:00.000Z';
    db.runSync(
      `INSERT INTO sessions
        (id, student_id, mode, started_at, ended_at, billed_minutes, duration_minutes, topics, status, session_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, 'general', ?)`,
      [id, studentId, mode, ended, ended, billed, billed, status, ended]
    );
    return id;
  }

  // ── 1. pool excludes non-completed ──────────────────────────────────────────

  it('listClaimablePool returns only completed sessions, excluding scheduled/cancelled/active', () => {
    const st = makeStudent();
    const done = insertSession(st, { status: 'completed' });
    insertSession(st, { status: 'scheduled' });
    insertSession(st, { status: 'cancelled' });
    insertSession(st, { status: 'active' });

    const pool = listClaimablePool();
    expect(pool.map(l => l.session_id)).toEqual([done]);
  });

  // ── 2. negative-balance completed still in pool ─────────────────────────────

  it('keeps a completed session in the pool even when the student balance is negative', () => {
    const st = makeStudent();
    // Drive the ledger negative — pool membership must NOT depend on balance.
    db.runSync(
      `INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, created_at)
       VALUES (?, ?, 'session_deduction', -5, -5, ?)`,
      ['le-1', st, '2026-03-15T10:00:00.000Z']
    );
    const done = insertSession(st, { status: 'completed' });

    const pool = listClaimablePool();
    expect(pool.map(l => l.session_id)).toContain(done);
  });

  // ── 3. finalise removes sessions from pool ──────────────────────────────────

  it('removes finalised sessions from the pool while leaving others', () => {
    const st = makeStudent();
    const a = insertSession(st, { status: 'completed' });
    const b = insertSession(st, { status: 'completed' });

    finaliseClaim({ sessionIds: [a] });

    const pool = listClaimablePool();
    expect(pool.map(l => l.session_id)).toEqual([b]);
  });

  // ── 4. finalise re-check throws on already-claimed ──────────────────────────

  it('throws when finalising a session that is already in a non-voided claim', () => {
    const st = makeStudent();
    const a = insertSession(st, { status: 'completed' });
    finaliseClaim({ sessionIds: [a] });

    expect(() => finaliseClaim({ sessionIds: [a] })).toThrow(/no longer claimable/);
  });

  it('throws when finalising a non-completed session id', () => {
    const st = makeStudent();
    const scheduled = insertSession(st, { status: 'scheduled' });
    expect(() => finaliseClaim({ sessionIds: [scheduled] })).toThrow(/no longer claimable/);
  });

  // ── 5. date-range boundaries (half-open [start, end)) ───────────────────────

  it('filters by ended_at using a half-open [start, end) range', () => {
    const st = makeStudent();
    const start = '2026-03-01T00:00:00.000Z';
    const end = '2026-04-01T00:00:00.000Z';

    const atStart = insertSession(st, { endedAt: start });           // included
    const mid = insertSession(st, { endedAt: '2026-03-15T00:00:00.000Z' }); // included
    insertSession(st, { endedAt: end });                              // excluded (== end)
    insertSession(st, { endedAt: '2026-02-28T23:59:59.000Z' });       // excluded (before start)

    const pool = listClaimablePool({ start, end });
    expect(pool.map(l => l.session_id).sort()).toEqual([atStart, mid].sort());
  });

  // ── 6. snapshot immutability ────────────────────────────────────────────────

  it('freezes line fees so later rate/travel changes never alter a finalised claim', () => {
    const st = makeStudent({ travelFlatFee: 100 });
    const a = insertSession(st, { mode: 'in_person', billedMinutes: 60 });

    const { claim } = finaliseClaim({ sessionIds: [a] });
    expect(claim.lesson_fee_total).toBe(600);
    expect(claim.travel_total).toBe(100);
    expect(claim.grand_total).toBe(700);
    expect(claim.payout_rate).toBe(600);
    expect(claim.travel_mode).toBe('flat');

    // Change config AFTER finalisation.
    upsertTutorProfile({ hourly_rate: 999, travel_mode: 'distance', per_km_rate: 50 });
    db.runSync('UPDATE students SET travel_flat_fee = 500, travel_distance_km = 20 WHERE id = ?', [st]);

    const lines = getClaimLines(claim.id);
    expect(lines).toHaveLength(1);
    expect(lines[0].lesson_fee).toBe(600);
    expect(lines[0].travel_fee).toBe(100);
    expect(lines[0].billed_hours).toBe(1);

    const reloaded = getClaim(claim.id)!;
    expect(reloaded.grand_total).toBe(700);
  });

  // ── 7. void returns lessons to pool + leaves record; second void throws ──────

  it('voidClaim returns lessons to the pool, keeps the record, and rejects a second void', () => {
    const st = makeStudent({ travelFlatFee: 50 });
    const a = insertSession(st, { mode: 'in_person', billedMinutes: 60 });
    const { claim } = finaliseClaim({ sessionIds: [a] });

    // Out of the pool once claimed.
    expect(listClaimablePool().map(l => l.session_id)).toEqual([]);

    voidClaim({ claimId: claim.id, reason: 'mistake' });

    // Lesson returns to the pool.
    expect(listClaimablePool().map(l => l.session_id)).toEqual([a]);

    // Record + lines remain on file, flagged as voided.
    const reloaded = getClaim(claim.id)!;
    expect(reloaded.voided_at).not.toBeNull();
    expect(reloaded.void_reason).toBe('mistake');
    expect(getClaimLines(claim.id)).toHaveLength(1);

    // Second void throws.
    expect(() => voidClaim({ claimId: claim.id })).toThrow();
  });

  it('voidClaim accepts a blank/absent reason', () => {
    const st = makeStudent();
    const a = insertSession(st, {});
    const { claim } = finaliseClaim({ sessionIds: [a] });
    expect(() => voidClaim({ claimId: claim.id })).not.toThrow();
    expect(getClaim(claim.id)!.void_reason).toBeNull();
  });

  it('a voided session can be re-claimed into a new claim', () => {
    const st = makeStudent();
    const a = insertSession(st, {});
    const first = finaliseClaim({ sessionIds: [a] });
    voidClaim({ claimId: first.claim.id });

    const second = finaliseClaim({ sessionIds: [a] });
    expect(second.claim.id).not.toBe(first.claim.id);
    expect(getClaimLines(second.claim.id)).toHaveLength(1);
    // Both claims keep their lines on record.
    expect(listClaims()).toHaveLength(2);
  });

  // ── 8. getOutstandingPayout split math ──────────────────────────────────────

  it('splits outstanding payout into lesson fees and travel (online ⇒ R0 travel, flat mode)', () => {
    const st = makeStudent({ travelFlatFee: 100 });
    insertSession(st, { mode: 'in_person', billedMinutes: 60 }); // lesson 600, travel 100
    insertSession(st, { mode: 'online', billedMinutes: 30 });    // lesson 300, travel 0

    const out = getOutstandingPayout();
    expect(out.lessonFeeTotal).toBe(900);
    expect(out.travelTotal).toBe(100);
    expect(out.grandTotal).toBe(1000);
    expect(out.lessonCount).toBe(2);

    // Equals the sum of pool line totals.
    const pool = listClaimablePool();
    const sum = pool.reduce((acc, l) => acc + l.line_total, 0);
    expect(out.grandTotal).toBe(sum);
  });

  it('prices travel by distance × per-km rate in distance mode', () => {
    upsertTutorProfile({ hourly_rate: 600, travel_mode: 'distance', per_km_rate: 7.5 });
    const st = makeStudent({ travelDistanceKm: 12 });
    insertSession(st, { mode: 'in_person', billedMinutes: 60 }); // lesson 600, travel 90

    const out = getOutstandingPayout();
    expect(out.lessonFeeTotal).toBe(600);
    expect(out.travelTotal).toBe(90);
    expect(out.grandTotal).toBe(690);
  });

  it('applies the per-student payout_rate_override (COALESCE) in live pricing', () => {
    const st = makeStudent({ payoutRateOverride: 800 });
    insertSession(st, { mode: 'online', billedMinutes: 60 }); // 800, no travel

    const out = getOutstandingPayout();
    expect(out.lessonFeeTotal).toBe(800);
    expect(out.travelTotal).toBe(0);
  });

  // ── buildClaim preview (no write) ───────────────────────────────────────────

  it('buildClaim previews totals without writing a claim', () => {
    const st = makeStudent({ travelFlatFee: 100 });
    const a = insertSession(st, { mode: 'in_person', billedMinutes: 60 });

    const preview = buildClaim({ sessionIds: [a] });
    expect(preview.grandTotal).toBe(700);
    expect(preview.lines).toHaveLength(1);
    expect(listClaims()).toHaveLength(0); // nothing persisted
    expect(listClaimablePool().map(l => l.session_id)).toEqual([a]); // still in pool
  });

  it('finalising with no sessions throws', () => {
    expect(() => finaliseClaim({ sessionIds: [] })).toThrow();
  });

  // ── setClaimReportPath ──────────────────────────────────────────────────────

  it('setClaimReportPath persists the report path on the claim', () => {
    const st = makeStudent();
    const a = insertSession(st, {});
    const { claim } = finaliseClaim({ sessionIds: [a] });

    setClaimReportPath(claim.id, 'file:///tmp/claim.pdf');
    expect(getClaim(claim.id)!.report_path).toBe('file:///tmp/claim.pdf');
  });

  // ── listClaims ordering + voided flag ───────────────────────────────────────

  it('listClaims returns newest first with line_count and includes voided claims', () => {
    const st = makeStudent();
    const a = insertSession(st, { endedAt: '2026-03-01T00:00:00.000Z' });
    const b = insertSession(st, { endedAt: '2026-03-02T00:00:00.000Z' });

    const first = finaliseClaim({ sessionIds: [a] });
    const second = finaliseClaim({ sessionIds: [b] });
    voidClaim({ claimId: first.claim.id });

    const claims = listClaims();
    expect(claims).toHaveLength(2);
    expect(claims[0].id).toBe(second.claim.id); // newest first
    expect(claims.every(c => c.line_count === 1)).toBe(true);
    expect(claims.find(c => c.id === first.claim.id)!.voided_at).not.toBeNull();
  });
});
