# Implementation Plan — Tutor Claims / Payout Tracking

> Status: PLAN ONLY (no code in this document). Feature decisions are settled; this plan sequences the build.
> Code root: `/Users/mag/Documents/HourBank/hourbank/`. All paths below are relative to that root unless absolute.
> Domain vocabulary is canonical per `CONTEXT.md`: **Claim**, **Claimable pool**, **Lesson fee**, **Travel allowance**, **Outstanding payout**, **Void**, **Claim report**.

---

## 1. Summary

A **Claim** is a tutor payout event covering delivered (`completed`) lessons. We add two new tables (`claims`, `claim_lines`) plus snapshot/config columns on `tutor_profile` and `students`, all behind migration `006`. A new `src/db/claims.ts` service derives the **Claimable pool** and **Outstanding payout** live (no `claimed` flag on sessions), builds/finalises immutable Claims with frozen fee snapshots, and voids via a one-time `voided_at`. A new **Payouts** UI area (claim-builder, claim detail, history) plus settings additions surfaces it. Each Claim emits a downloadable itemised **Claim report** reusing the existing `expo-print` + `expo-sharing` receipt infra. No account-cash balance, no over-claim warnings — deliberately not an accounting tool.

Workstreams are independently committable in the order: **data model → db/service layer → UI → report → rollups/integration**.

---

## 2. Data model & migration

### 2.1 New migration — `MIGRATION_006_CLAIMS`

Add to `src/db/migrations.ts` following the existing `Migration` shape (use the `run: (db) => {...}` form, guarded with `hasTable`/`hasColumn` exactly like `MIGRATION_003`/`004`). Register it in the migration list that `runMigrations([...])` receives at app boot (same place `MIGRATION_002`–`005` are wired) **and** append it to the test harness migration arrays.

Version string: `'006_claims'`.

#### New table `claims`
```
CREATE TABLE IF NOT EXISTS claims (
  id              TEXT PRIMARY KEY,
  tutor_id        TEXT,                       -- mirrors sessions.tutor_id (nullable, single-tutor MVP)
  period_start    TEXT,                       -- nullable; ISO; null ⇒ whole-pool claim
  period_end      TEXT,                       -- nullable; ISO
  payout_rate     REAL NOT NULL,              -- SNAPSHOT of effective tutor payout rate at finalisation
  travel_mode     TEXT NOT NULL DEFAULT 'flat' CHECK (travel_mode IN ('flat','distance')),  -- SNAPSHOT
  per_km_rate     REAL,                       -- SNAPSHOT, nullable (only meaningful when travel_mode='distance')
  lesson_fee_total REAL NOT NULL,
  travel_total    REAL NOT NULL,
  grand_total     REAL NOT NULL,
  report_path     TEXT,                       -- nullable; filesystem path of generated Claim report
  voided_at       TEXT,                       -- nullable; set ONCE on void
  void_reason     TEXT,                       -- nullable
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

#### New table `claim_lines`
```
CREATE TABLE IF NOT EXISTS claim_lines (
  id           TEXT PRIMARY KEY,
  claim_id     TEXT NOT NULL REFERENCES claims(id) ON DELETE RESTRICT,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  billed_hours REAL NOT NULL,                 -- SNAPSHOT (= sessions.billed_minutes/60 at finalisation)
  mode         TEXT NOT NULL CHECK (mode IN ('in_person','online')),  -- SNAPSHOT
  lesson_fee   REAL NOT NULL,                 -- FROZEN
  travel_fee   REAL NOT NULL,                 -- FROZEN (0 for online)
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```
`ON DELETE RESTRICT` reinforces append-only intent (sessions are never deleted anyway — archive-not-delete).

#### New columns
```
ALTER TABLE tutor_profile ADD COLUMN travel_mode TEXT NOT NULL DEFAULT 'flat'
    CHECK (travel_mode IN ('flat','distance'));
ALTER TABLE tutor_profile ADD COLUMN per_km_rate REAL NOT NULL DEFAULT 0;

ALTER TABLE students ADD COLUMN travel_flat_fee      REAL NOT NULL DEFAULT 0;
ALTER TABLE students ADD COLUMN travel_distance_km   REAL NOT NULL DEFAULT 0;
ALTER TABLE students ADD COLUMN payout_rate_override REAL;          -- nullable; NULL ⇒ fall back to tutor_profile.hourly_rate
```
Each `ADD COLUMN` guarded by `if (!hasColumn(db, ...))` per the established `MIGRATION_003` pattern. SQLite `CHECK` on `ALTER ... ADD COLUMN` is allowed for new columns with constant defaults.

> **Note:** `tutor_profile.hourly_rate` is **repurposed** as the tutor payout rate (it is currently unused). No new "payout rate" column — the existing field IS the flat payout rate. `students.payout_rate_override` ships now but stays unused (always NULL) until per-student rates land.

#### Indexes
```
CREATE INDEX IF NOT EXISTS idx_claim_lines_session ON claim_lines(session_id);
CREATE INDEX IF NOT EXISTS idx_claim_lines_claim   ON claim_lines(claim_id);
CREATE INDEX IF NOT EXISTS idx_claims_voided       ON claims(voided_at);
```
`idx_claim_lines_session` is the hot path for the pool's `NOT EXISTS` anti-join.

### 2.2 TypeScript types

Add `Claim` and `ClaimLine` row types to `src/db/schema.ts` next to `Session`/`LedgerEntry` (matching the existing `type X = {...}` export style; SQLite booleans as `0|1`, nullables as `string | null` / `number | null`). Extend the `TutorProfile` type in `src/db/tutorProfile.ts` with `travel_mode: 'flat' | 'distance'` and `per_km_rate: number`, and the `Student` type in `src/db/schema.ts` with `travel_flat_fee`, `travel_distance_km`, `payout_rate_override: number | null`.

### 2.3 Claimed-once invariant (no `claimed` flag)

Pool membership is **derived**, never stored. A session is in the pool iff it is `completed` and not referenced by a `claim_line` belonging to a **non-voided** Claim:

```sql
-- Claimable pool
SELECT s.*
FROM sessions s
WHERE s.status = 'completed'
  AND NOT EXISTS (
    SELECT 1
    FROM claim_lines cl
    JOIN claims c ON c.id = cl.claim_id
    WHERE cl.session_id = s.id
      AND c.voided_at IS NULL
  )
ORDER BY s.ended_at ASC;
```

We deliberately do **not** add a SQLite `UNIQUE` constraint on `claim_lines(session_id)`: a voided Claim keeps its lines on record, so the same session legitimately appears in one voided Claim **and** one new Claim. The "at most one non-voided Claim per session" rule is therefore enforced in the **application layer at finalisation** by re-deriving the pool inside the same write transaction and aborting if any selected session is no longer claimable (see §3.2). This mirrors the ledger's append-only correction discipline.

### 2.4 Outstanding-payout query (live, derived)

Outstanding payout = the value of every pool session, split into lesson-fee and travel components, using **current** config (not snapshots — snapshots only exist once a Claim is finalised). Effective rate per line = `COALESCE(students.payout_rate_override, tutor_profile.hourly_rate)`. Travel per line: `0` if `mode='online'`; else, when `tutor_profile.travel_mode='flat'` → `students.travel_flat_fee`, when `'distance'` → `students.travel_distance_km * tutor_profile.per_km_rate`.

Computed by joining pool sessions to `students` and the single `tutor_profile` row. Implemented as a SQL aggregate returning `{ lessonFeeTotal, travelTotal, grandTotal, lessonCount }`, with the per-line fee expression centralised in a shared helper (see §3.3) so the live rollup and the finalise snapshot use identical math.

### 2.5 Snapshot rules (frozen at finalisation)

On `finaliseClaim`:
- `claims.payout_rate` = the tutor payout rate at that instant (flat: `tutor_profile.hourly_rate`; per line the override is applied, but the claim-level `payout_rate` records the tutor default for the report header).
- `claims.travel_mode`, `claims.per_km_rate` = copied from `tutor_profile`.
- Per `claim_lines`: `billed_hours`, `mode`, `lesson_fee`, `travel_fee` all frozen from the values computed at finalisation.
- `claims.lesson_fee_total` / `travel_total` / `grand_total` = sums of the frozen lines.

After finalisation, changing any rate/travel config or any `students` travel field **never** alters a past Claim — every figure a Claim displays reads from its own snapshot columns, never recomputed.

---

## 3. DB / service layer

New file: **`src/db/claims.ts`** (mirrors the style of `src/db/reports.ts` / `src/db/sessions.ts`: top-level `getDb()`, exported typed functions, `withTransactionSync` for multi-statement writes, `newId()` from `./uuid`). Add a matching test file `src/db/__tests__/claims.test.ts`.

### 3.1 Read functions

```ts
export type ClaimablePoolLine = {
  session_id: string;
  student_id: string;
  student_full_name: string;
  ended_at: string;
  mode: 'in_person' | 'online';
  billed_hours: number;
  lesson_fee: number;   // computed live
  travel_fee: number;   // computed live
  line_total: number;
};

// All currently-claimable completed sessions, fee-priced live. Optional date range on sessions.ended_at.
export function listClaimablePool(range?: { start: string; end: string }): ClaimablePoolLine[];

export type OutstandingPayout = {
  lessonFeeTotal: number;
  travelTotal: number;
  grandTotal: number;
  lessonCount: number;
};
export function getOutstandingPayout(range?: { start: string; end: string }): OutstandingPayout;

export type ClaimSummary = Claim & { line_count: number };
export function listClaims(): ClaimSummary[];          // history, newest first, includes voided (flagged)
export function getClaim(claimId: string): Claim | null;
export function getClaimLines(claimId: string): ClaimLine[];
```

### 3.2 Write functions (transactional, immutable)

```ts
// Pure preview: price a candidate selection without writing. Used by the builder confirm screen.
export function buildClaim(input: {
  sessionIds: string[];
  periodStart?: string | null;
  periodEnd?: string | null;
}): { lines: ClaimablePoolLine[]; lessonFeeTotal: number; travelTotal: number; grandTotal: number };

// Atomic finalisation. Re-derives pool INSIDE the transaction; throws if any sessionId is no longer
// claimable (already in a non-voided claim) or not 'completed'. Freezes all snapshots. Returns new claim id.
export function finaliseClaim(input: {
  sessionIds: string[];
  periodStart?: string | null;
  periodEnd?: string | null;
}): { claim: Claim };

// One-time void: set voided_at (+ optional void_reason) on a non-voided claim; lessons return to pool
// automatically (derived). Throws if claim already voided. NEVER deletes rows. No edit path exists.
export function voidClaim(input: { claimId: string; reason?: string | null }): void;

// Persist the generated report path back onto the claim row (called by the report generator).
export function setClaimReportPath(claimId: string, path: string): void;
```

**Immutability rules baked into the layer:**
- No `updateClaim` / `deleteClaim` / `updateClaimLine` functions exist — there is no API surface to mutate a finalised Claim except `voidClaim` (single field) and `setClaimReportPath` (write-once metadata).
- `finaliseClaim` wraps insert-claim + insert-lines + pool re-check in one `db.withTransactionSync(() => {...})`, so a concurrent finalise cannot double-claim a session.
- `voidClaim` guards `voided_at IS NULL` and uses `runSync(... WHERE id=? AND voided_at IS NULL)`, asserting `changes === 1` (same defensive pattern as `archiveStudent` / `reactivateStudent`).

### 3.3 Shared fee helper

Add `src/utils/claim.ts` exporting pure functions used by both live rollups and finalisation so the math is single-sourced:
```ts
export function lessonFee(billedHours: number, effectiveRate: number): number;
export function travelFee(args: {
  mode: 'in_person' | 'online';
  travelMode: 'flat' | 'distance';
  flatFee: number; distanceKm: number; perKmRate: number;
}): number;
export function effectiveRate(override: number | null, tutorRate: number): number; // COALESCE semantics
```
Round to 2 decimals (cents) at the helper boundary to keep snapshots and live totals byte-identical.

### 3.4 Profile / student layer additions

- `src/db/tutorProfile.ts`: extend the `TutorProfile` type and the `upsertTutorProfile` UPDATE/INSERT column lists with `travel_mode`, `per_km_rate` (it already accepts `Partial<TutorProfile>`, so no signature change — just the SQL column lists and the `row[...]` param array).
- `src/db/students.ts`: extend `createStudent` / `updateStudent` input objects (or accept them as optional with `0`/`null` defaults so existing call sites compile unchanged) and the INSERT/UPDATE column lists with `travel_flat_fee`, `travel_distance_km`, `payout_rate_override`.

### 3.5 Tests to write (`src/db/__tests__/claims.test.ts`)

Use the existing harness: `createTestDb()` + `resetDbSingleton()` from `./testDb`, and `runMigrations([...])` in `beforeEach` including `MIGRATION_006_CLAIMS` (plus all prior migrations the schema needs). Cover:
1. `listClaimablePool` returns only `completed` sessions; excludes `scheduled`/`cancelled`/`active`.
2. A completed session whose student balance went negative is still in the pool.
3. After `finaliseClaim`, its sessions leave the pool; remaining completed sessions stay.
4. `finaliseClaim` re-check throws when a sessionId is already claimed (non-voided).
5. Date-range filter on `ended_at` includes boundary start, excludes range end (match `listSessionsForMonth`'s half-open `[start, end)` convention).
6. Snapshot immutability: finalise a Claim, then change `tutor_profile.hourly_rate` and a student's `travel_flat_fee` → `getClaimLines` totals unchanged.
7. `voidClaim` sets `voided_at`/`void_reason`, returns the sessions to the pool, leaves the original Claim + lines on record; second void throws.
8. `getOutstandingPayout` equals sum of pool line totals and splits lesson vs travel correctly (online → R0 travel; in-person flat vs distance).
9. `effectiveRate`/`lessonFee`/`travelFee` unit tests in `src/utils/__tests__/claim.test.ts` (rounding, override fallback, online R0).

Add a migration assertion in `src/db/__tests__/migrations.test.ts`: tables/columns exist after `006`, and `006` is idempotent (re-run is a no-op).

---

## 4. UI

### 4.1 Navigation placement — RECOMMENDATION

**Add a 6th bottom tab "PAYOUTS"** in `app/(app)/_layout.tsx` (Feather icon `dollar-sign` or `briefcase`), rather than nesting under Reports.

Rationale: Reports is parent-facing/business-activity (cash in, sessions delivered); a Claim is a distinct money-**out** event the tutor acts on regularly (build claim, void, download statement). It deserves a first-class destination and a home for the **Outstanding payout** hero number. Six tabs is the practical ceiling; if the user prefers five, the fallback is a "Payouts" card/row inside `reports.tsx` linking to `app/payouts/index.tsx`. (Listed as an open question in §8.)

### 4.2 New screens (file-based routes)

```
app/(app)/payouts.tsx              -- Payouts home: Outstanding payout hero + Claim history list + "New Claim" CTA
app/claim/new.tsx                  -- Claim-builder flow (date filter + hold-back + confirm)
app/claim/[id].tsx                 -- Claim detail / report view (+ Void, + Download report)
app/claim/_layout.tsx              -- Stack layout for the claim/* group (mirrors app/student/_layout.tsx)
```

All screens follow the established shell: `SafeAreaView` (`edges={['top']}`, `backgroundColor: COLORS.paper`), `ScrollView`, `useFocusEffect` to reload on focus, `F`/`COLORS` from `src/theme`. Numeric displays (all rand amounts, hours, counts, dates) use `F.mono`/`F.monoMed`; headings/names use `F.serif`/`F.serifItalic`; labels/buttons `F.sans`/`F.sansMed`. **No `fontWeight:'bold'`, no inline hex** — colours come from `COLORS` (`src/theme/colors.ts`).

#### `app/(app)/payouts.tsx` — Payouts home
- **Outstanding payout hero**: big `F.mono` rand figure (`formatRand`) from `getOutstandingPayout()`, with a fees vs travel split line (`Lesson fees R… · Travel R…`) and lesson count. Reuse the home-card hero treatment.
- **"New Claim" button** → `router.push('/claim/new')`. Disabled (with helper text) when pool is empty.
- **Claim history**: `listClaims()` rendered like the reports session list — each row: created date (`formatLedgerDate`), period label (range or "All"), `grand_total` (`F.mono`), and a muted **VOID** chip (use `COLORS.crimson`/`oxblood`) when `voided_at` set. Tap → `app/claim/[id]`.

#### `app/claim/new.tsx` — Claim builder
Three-step single screen (no wizard routes needed):
1. **Scope / date filter**: default "Whole pool"; a toggle reveals start/end date pickers filtering on `ended_at`. Changing it re-runs `listClaimablePool(range)`.
2. **Hold-back selection**: list of pool lines (student name `F.serif`, date + mode + billed hours + line total in `F.mono`). Each row has a checkbox; all selected by default; deselect to hold a lesson back. Running selected total updates live via `buildClaim(...)` (pure preview, no write).
3. **Confirm**: summary tiles (lesson-fee total, travel total, grand total — `F.monoMed`) + a primary "Finalise Claim" button. On confirm → `finaliseClaim({ sessionIds, periodStart, periodEnd })`, then `router.replace('/claim/' + claim.id)`. Empty selection disables confirm.

Catch the finalise re-check error (a session became unclaimable mid-flow) with an `Alert` + pool refresh, consistent with existing error handling.

#### `app/claim/[id].tsx` — Claim detail / report view
- Header: grand total (`F.mono` hero), period label, created date, **VOID** banner if voided (`void_reason` shown in `F.sans`).
- Itemised lines from `getClaimLines`: per session — date, student name, mode, billed hours, lesson fee, travel fee, line total (all amounts `F.mono`). These read the **frozen snapshot** columns.
- Totals footer: lesson-fee total · travel total · grand total.
- Actions: **Download report** (→ §5, calls the generator, then opens the OS share sheet) and, for non-voided Claims, **Void** (confirmation modal with an **optional** reason field — blank allowed; reuse the reset-confirm modal pattern from `profile.tsx`; calls `voidClaim`). No edit/delete affordance anywhere.
- Bottom: claim `id` in tiny `F.mono`, matching `transaction/[id].tsx`.

### 4.3 Settings additions — `app/(app)/profile.tsx`
In the TUTOR section, add a **Payout** subsection:
- "Payout rate (per hour)" — bind to existing `hourly_rate` (relabel its meaning; numeric `TextInput`, `F.mono`, `onBlur` → `saveProfile`, same pattern as tier fields).
- "Travel mode" — segmented toggle `Flat | Distance` → `travel_mode`.
- "Per-km rate" — numeric field bound to `per_km_rate`, shown only when `travel_mode='distance'`.
All persisted through the existing `upsertTutorProfile` save flow.

### 4.4 Student-edit additions — `app/student/[id]/edit.tsx` (and `app/student/new.tsx`)
Add a **Travel** subsection:
- "Flat travel fee" → `travel_flat_fee` (shown when tutor `travel_mode='flat'`).
- "Distance (km)" → `travel_distance_km` (shown when tutor `travel_mode='distance'`).
- `payout_rate_override` field is **built but hidden/disabled** this phase (ships dormant; NULL).
Wire through the extended `updateStudent`/`createStudent` inputs. Numeric inputs `F.mono`.

---

## 5. Report generation

Extend the existing receipt infrastructure rather than introducing a new dependency. Add **`src/utils/claimReport.ts`** modelled on `src/utils/receipt.ts`:
- Build an HTML statement string (header: tutor name, period, payout rate, travel mode; a table of lines — date, student, mode, billed hours, lesson fee, travel fee, line total; footer totals).
- `const { uri } = await Print.printToFileAsync({ html })` → produces a PDF.
- Persist via `setClaimReportPath(claimId, uri)` so `claims.report_path` records it, then `await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share Claim Report' })` — identical to `shareSessionReceipt`.
- Filename helper mirroring `receiptFilename`: `Claim_<DDMonYYYY-start>_<DDMonYYYY-end>.pdf` (or `Claim_All_<created>.pdf` for whole-pool).
- All numeric cells in the HTML use a monospace font-family to stay visually consistent with in-app rules (the GeistMono rule is enforced for RN `Text`; HTML is a print artifact, but keep monospace for numbers for parity).

Reports are generated **from the frozen snapshot** (`getClaim` + `getClaimLines`), never recomputed — so a downloaded report always matches the Claim as finalised. `report_path` is nullable: generation is on-demand from the detail screen; regenerating overwrites the path (write-once-per-need, not edit of financial data).

Decision deferred to §8: PDF (via `expo-print`, reuses infra) vs CSV (lighter for spreadsheet import). Recommendation: **PDF now** (matches receipts, zero new deps); CSV export is a trivial future add.

---

## 6. Build sequence & verification

Each phase = one committable workstream. Gate every commit on: `npx tsc --noEmit` (zero errors), the `CLAUDE.md` pre-commit greps (`fontWeight.*bold` → none; inline hex `"#[0-9a-fA-F]` → none in `src`/`app`; numeric displays appear under `GeistMono`/`F.mono`), and `npm test` (jest) green.

**Phase 0 — Test surface check (step zero).** Confirm the jest harness runs and a dev build is installable (memory: Expo Go won't work — use prebuild + `run:android`). No code.

**Phase 1 — Data model & migration.**
- Add `MIGRATION_006_CLAIMS`, register it in the boot migration list + test arrays, extend `schema.ts`/`TutorProfile`/`Student` types.
- Verify: `tsc`; `migrations.test.ts` asserts new tables/columns + idempotency; full jest suite still green.

**Phase 2 — DB/service layer + helpers.**
- `src/utils/claim.ts`, `src/db/claims.ts`, profile/student column wiring.
- Write `claims.test.ts` + `claim.test.ts` **first (TDD)**, implement to green.
- Verify: `tsc`; new + existing jest green; grep clean.

**Phase 3 — Settings & student-edit fields.**
- Profile Payout subsection + student Travel subsection.
- Verify: `tsc`; greps (watch for inline hex / bold in new JSX); device smoke — edit payout rate, travel mode, a student's travel fee; confirm persistence by reopening.

**Phase 4 — Payouts UI (home, builder, detail) + nav tab.**
- Add the PAYOUTS tab and the three `app/claim/*` + `app/(app)/payouts.tsx` screens.
- React-hooks check on every new `.tsx` (no hooks after early returns — recurring regression per memory).
- Verify: `tsc`; greps; device smoke — build a claim (whole pool, then date-filtered, then with hold-backs), finalise, see it leave Outstanding payout, void it, see lessons return.

**Phase 5 — Claim report generation.**
- `src/utils/claimReport.ts` + Download action on detail screen; persist `report_path`.
- Verify: `tsc`; device smoke — generate report on a finalised Claim, share sheet opens, PDF lists lines + totals matching the screen.

**Phase 6 — Integration verifier (cold-boot).**
- Fresh DB (or reset) → run migration → seed students with travel fees → complete sessions (in-person + online, one driving balance negative) → confirm Outstanding payout math → build/finalise/void/re-claim end-to-end on device.
- Confirm snapshots: change `hourly_rate` + a travel fee after finalise → past Claim + its report unchanged; new pool prices at new rate.
- Final `tsc` + full jest + greps. Summarise changed-vs-requested.

---

## 7. Future-ready notes

- **Per-student payout rate:** `students.payout_rate_override` ships now (nullable, dormant). `effectiveRate(override, tutorRate)` already applies `COALESCE` semantics, and `claims.payout_rate` snapshots the tutor default while each `claim_lines.lesson_fee` is frozen per line. Activating the feature = unhide the student-edit field; **no migration, no service change**.
- **Distance-based travel:** columns (`tutor_profile.travel_mode`/`per_km_rate`, `students.travel_distance_km`) and the `travelFee` branch already exist; Claims snapshot `travel_mode`/`per_km_rate`. Switching modes = flip the profile toggle; in-flight pool reprices live, past Claims stay frozen. **No migration.**
- **CSV export / multi-tutor:** `tutor_id` is carried on `claims`; a CSV generator is an additive sibling of `claimReport.ts`. No schema impact.

---

## 8. Decisions (RESOLVED)

1. **Nav placement** — ✅ Dedicated 6th **PAYOUTS** tab (per §4.1).
2. **Report format** — ✅ **PDF** via `expo-print`/`expo-sharing` (reuses receipt infra). CSV deferred as a future additive sibling.
3. **Void reason** — ✅ **Optional/blank allowed.** `voidClaim` accepts an empty/absent reason; the void confirmation modal does not require text. `void_reason` stays nullable.
