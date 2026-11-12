# HourBank — Subjects, lesson recording, editable lessons, travel billing (2026-10-12)

Base: main @ cab1d7b (backup fix + migration 008 contacts/reference + icon merged). Prior plan & APIs: 2026-10-09-audit-remediation.md.

## User decisions (2026-10-12)
1. **Multiple subjects per student, SEPARATE balance per subject.** Same parent price / payout rate / package tiers for all subjects. Top-ups, lessons, adjustments are per subject.
2. **Edit past lessons in place** (billed minutes, date/time, subject, topics, notes, km). The lesson's session_deduction ledger row is UPDATED (audit not needed for now) — relax migration-007 ledger UPDATE trigger to allow updates only to session_deduction rows' hours_delta (and subject) via the edit path; DELETE stays blocked. Lesson shows "Edited <date>" (sessions.edited_at). If lesson is in a non-void claim: warn, allow (nudge, not block); the claim snapshot does not change.
3. **Timer no longer required.** Primary flow: schedule → after the lesson **Record lesson** (billed duration, subject, topics, notes, km, mode) → completed + deduction. Unscheduled: Record a lesson directly (existing log-past flow becomes the main path). Timer kept as optional "Start timer" secondary action; its end flow lands on the same Record form.
4. **Travel billed to parents in arrears** (rand amount, separate from hours): each completed in-person lesson accrues travel = flat fee or km × per-km rate (same tutor travel config as payout claims; lesson km defaults from student profile, editable when booking AND when recording/editing). Student has **travel owed (R)** = accrued − settled. Top-up screen shows "Travel owed R X from N lessons — settle with this payment" (records a travel settlement). Reminders include travel owed. Payout claims use per-lesson km.
5. Backup functionality: leave as is (no further work).
6. Invoice PDF: still future (FUTURE_TODOS).
7. **Parent travel rate is PER STUDENT** (legacy agreements) and can change over time: students get `parent_travel_mode` ('flat'|'per_km'|'none'), `parent_travel_flat_fee`, `parent_travel_per_km` (seeded from the tutor's travel config so existing behaviour is preserved). Because rates change, the parent travel charge is SNAPSHOTTED on the lesson when recorded (`sessions.parent_travel_fee`) and recomputed on edit only when km/mode change (student's CURRENT rate at edit time). Travel owed = Σ snapshotted charges of completed in-person lessons − settlements. Rate changes never reprice past lessons. Tutor payout claims keep the tutor's own travel config — "parent travel charge" vs "payout travel" are distinct concepts. (Supersedes "parent travel rate = tutor's rate" assumption below.)
8. **Travel settled WITH a top-up (usual) or ON ITS OWN**: `settleTravel({studentId, amount, packageId?: string|null, method?, note?})` works standalone, supports partial payments, can't take owed below 0 (validated). Settlements appear in the student's history as a separate rand list (not the hours ledger) and in Money In cash received.

## Assumptions (stated to user)
- Parent travel rate = tutor's configured travel rate (flat/per km).
- Existing students: their current `subject` becomes their first student_subject; all existing ledger rows/sessions/packages backfilled to it.

## Phase A — data layer (one agent, TDD)
Migration 009 (append to ALL_MIGRATIONS; upgrade test from 008 with real data):
- `student_subjects(id, student_id FK, subject TEXT, grade?, curriculum?, status active|archived, sort_order, created_at)`; backfill one per student from students.subject (+grade/curriculum if those are on students).
- `subject_id` on sessions, credit_packages, ledger_entries (backfill). Balance views per subject: `student_subject_balances` (student_id, subject_id, balance_hours); student total balance = sum (still exposed for lists).
- sessions: `travel_km REAL NULL` (override; null = student default), `edited_at TEXT NULL`.
- `travel_settlements(id, student_id, amount REAL, settled_through TEXT (iso), package_id NULL, created_at, note)`; travel accrued computed from completed in-person sessions (status completed, mode in-person) — function `getTravelOwed(studentId) → {amount, lessons:[...], since}`.
- Ledger trigger: replace `ledger_no_update` with one that only allows UPDATE of hours_delta/subject_id on type='session_deduction' (and updated_at if exists); DELETE still blocked.
APIs: subjects CRUD (`listStudentSubjects`, `addStudentSubject`, `renameStudentSubject`, `archiveStudentSubject`), `getSubjectBalances(studentId)`, createPackage/createAdjustment/logPastSession/startSession/createScheduled/markNoShow all take `subjectId`; `recordLesson({sessionId?, studentId, subjectId, startedAt, billedMinutes, topics, notes, mode, travelKm})` (completes scheduled or creates new); `editLesson(sessionId, patch)` updates session + deduction in a txn, sets edited_at, returns `{inClaim}`; `rescheduleSession` / `createScheduled` accept `travelKm`; `getTravelOwed`, `settleTravel({studentId, amount, packageId?})`; claims + reports use per-lesson km and per-subject data; over-owe checks per subject; listAgenda/needs-attention items carry subject.

## Phase B — screens (parallel, ≤3 agents)
- B1 Lesson flow: Record lesson screen (from log-past + end-session merged; subject picker, billed stepper/typing, topics per subject catalog, km field when in-person), lesson summary Edit button → edit form (same component) with claim warning, overdue/Agenda/Home actions primary = "Record lesson", timer demoted to secondary "Start timer", schedule form subject picker + km override.
- B2 Multi-subject UI: student form (subjects list add/remove, each with grade/curriculum if relevant), student detail (per-subject balance cards, ledger filter by subject, top-up per subject), Home roster (student card shows subject balances / lowest balance status), needs-attention per subject, top-up subject picker, adjust per subject, money/reports per-subject breakdown, calendar/agenda show subject.
- B3 Travel billing UI: top-up "Travel owed" section + settle, student detail travel owed line + list of unsettled lessons, reminder text includes travel owed (and reference), Money In shows travel invoiced/owed, transaction detail shows settlement.
Then merge, prebuild (no --clean) so icon appears, emulator QA.


## Phase A API handoff (data layer — main @ c49f2fc)

Gates: `npx tsc --noEmit` 0 errors; jest 54 suites / 745 tests green. All pre-existing exports still compile; omitted `subjectId` = the student's **primary subject** (first active by sort_order). UI agents should start passing `subjectId` explicitly.

### Migration 009 (`009_subjects_travel`, last in `ALL_MIGRATIONS`)
- `student_subjects(id, student_id FK, subject, grade NULL, curriculum NULL, status 'active'|'archived', sort_order, created_at)`; unique active name per student (NOCASE). Backfill: one row per student, id `ss-<studentId>`, from `students.subject`; grade/curriculum NULL = inherit from student.
- `subject_id` on sessions, credit_packages, ledger_entries (backfilled to the primary subject). NULL subject_id on any row = primary subject (so per-subject balances always sum to the total).
- View `student_subject_balances(student_id, subject_id, subject, status, sort_order, balance_hours)`.
- sessions: `travel_km REAL NULL` (NULL = student default), `parent_travel_fee REAL NULL` (snapshot; NULL on historic lessons = never owed), `edited_at TEXT NULL`.
- students: `parent_travel_mode` ('flat'|'per_km'|'none', seeded: tutor distance→per_km else flat), `parent_travel_flat_fee` (seeded = students.travel_flat_fee), `parent_travel_per_km` (seeded = tutor per_km_rate).
- `travel_settlements(id, student_id, amount>0, payment_method eft|cash|card|other, package_id NULL, note, created_at)`.
- Ledger guard: `ledger_no_update` → `ledger_update_guard`: UPDATE allowed only on `session_deduction` rows, only hours_delta (must stay < 0) / subject_id / updated_at. DELETE still blocked (`ledger_no_delete`). `suspendLedgerGuards` restores the 009 generation. seed `resetDb` wipes the new tables.
- Restore of older backups (V1/May/Oct/007/008) migrates through 009 (tested).

### New: `src/db/subjects.ts`
- `listStudentSubjects(studentId, {includeArchived?}) → StudentSubject[]`
- `addStudentSubject({studentId, subject, grade?, curriculum?}) → StudentSubject` (re-adding an archived name reactivates it with its balance)
- `updateStudentSubject(id, {subject?, grade?, curriculum?})`, `renameStudentSubject(id, name)` (renaming the primary keeps `students.subject` in sync)
- `archiveStudentSubject(id) → {balanceHours}` (throws LAST_ACTIVE for the only active subject)
- `getSubjectBalances(studentId) → SubjectBalance[]` (active + archived with non-zero balance), `getSubjectBalance(studentId, subjectId)`, `getPrimarySubjectId(studentId)`, `getStudentSubject(id)`
- Errors: `SubjectError{code: NOT_FOUND|DUPLICATE|INVALID_INPUT|LAST_ACTIVE|WRONG_STUDENT}`, `isSubjectError(e, code?)` — thrown by every write that takes a foreign/unknown `subjectId` (UI should catch alongside `isSessionError`).
- Types in schema.ts: `StudentSubject`, `ParentTravelMode`, `TravelSettlement`; optional `subject_id` on Session/CreditPackage/LedgerEntry; `travel_km`, `parent_travel_fee`, `edited_at` on Session; parent travel fields on Student.

### New: `src/db/travel.ts` (PARENT travel, rand, in arrears)
- `getTravelOwed(studentId) → {amount (≥0), charged, settled, credit, lessons: TravelOwedLesson[] (unpaid, oldest first: session_id, subject_id, subject_name, date, travel_km, parent_travel_fee, unpaid), lessonCount, since}` — settlements applied FIFO.
- `settleTravel({studentId, amount, packageId?: string|null, method?, note?, now?}) → TravelSettlement` — standalone or with a top-up (method defaults to the package's); partial OK; `TravelError` EXCEEDS_OWED (details.owed) / INVALID_INPUT / NOT_FOUND; `isTravelError`.
- `listTravelSettlements(studentId)` (newest first), `getTravelSettlement(id)`, `listTravelSettlementsForPackage(packageId)`, `listTravelOwedByStudent()`.
- Pure helper `src/utils/travel.ts parentTravelCharge({lessonMode, parentTravelMode, flatFee, perKm, km})`.

### sessions.ts (new + changed)
- **`recordLesson({sessionId?, studentId, subjectId?, startedAt, billedMinutes, minutes?, topics, notes?, mode?, sessionType?, travelKm?, now?}) → {session, entry}`** — completes a scheduled OR running/paused timer lesson, or inserts a new completed one; deduction on the lesson subject; snapshots travel_km (explicit → booked → student default; online = null) + parent_travel_fee. Not owe-limited.
- **`editLesson(sessionId, {billedMinutes?, startedAt?, minutes?, subjectId?, topics?, notes?: string|null, travelKm?: number|null, mode?, sessionType?, now?}) → {session, inClaim}`** — completed lessons only (INVALID_STATE otherwise); txn updates session + its deduction row in place, stamps edited_at; recomputes parent travel only if km/mode changed; claim snapshot untouched. `isSessionInClaim(sessionId)`.
- `createScheduled({…, subjectId?, travelKm?})`, `updateScheduled(id, {…, subjectId?, travelKm?})` (undefined = keep), `rescheduleSession(id, iso, {estimatedDurationMinutes?, travelKm?})` (null = back to default), `createAndStartUnscheduled({…, subjectId?, travelKm?})`.
- `checkOweLimit(studentId, minutes, subjectId?)` → per-subject balance; OweCheck gains `subjectId`. `startSession` checks the lesson's subject.
- `logPastSession({…, subjectId?, travelKm?})` — now a deprecated wrapper over recordLesson (also accepts a running lesson id).
- `endSession` snapshots travel + books the deduction on the lesson subject. `markNoShow` charges the lesson subject.
- `listUpcomingWithProjection` projects per subject. `listAgenda` / `listAllUpcoming` items: `subject_id`, `subject_name`; `student_subject` is now the LESSON's subject name. `listForStudent(studentId, limit?, subjectId?)`. `getSessionWithStudent().subject` = lesson subject.

### students / packages / ledger
- `createStudent({…, additionalSubjects?, parentTravelMode?, parentTravelFlatFee?, parentTravelPerKm?})` — creates subject rows in the same txn. `updateStudent({…, parentTravelMode?, parentTravelFlatFee?, parentTravelPerKm?})`; a changed `subject` renames the primary subject (legacy single-subject form).
- `listActiveStudents()` / `listPausedStudents()` → `StudentListRow` with `subject_balances: {subject_id, subject, balance_hours}[]` (active, display order).
- `createAdjustment({…, subjectId?})`, `createPackage({…, subjectId?})` (pkg.subject_id).
- `appendEntryInTx({…, subjectId?})`; **`balance_after` = running balance of the row's subject**. Reads recompute it live: `listLedger(studentId, {subjectId?, limit?}) → LedgerRow[]` (adds `subject_name`), `lastNEntries(studentId, n, subjectId?)`, `getSessionDeduction(sessionId)`, `getLedgerEntryById` (+subject_id/subject_name).

### claims / reports / calendar
- Payout claims price travel from `COALESCE(sessions.travel_km, students.travel_distance_km)` with the TUTOR's travel config (unchanged otherwise).
- reports: `SessionListRow` + `subject_id, subject_name, travel_km, parent_travel_fee`; `TopUpRow` + `subject_id, subject_name`; `MonthSummary` + `perSubject: SubjectMonthRow[]`, `travelCashRand` (included in `totalCashRand` and perStudent `cashRand`); `listTravelSettlementsForMonth(year, monthIdx)`.
- calendar session events carry optional `subjectName`.

### Deviations from the plan
- `travel_settlements` has `payment_method` instead of `settled_through`; unpaid lessons are derived by FIFO allocation of payment amounts (fits partial/standalone payments, decision 8).
- Travel owed uses the per-lesson snapshot (decision 7), not live student/tutor rates; historic (pre-009) lessons owe nothing.
- `student_subjects.grade/curriculum` backfilled NULL (= inherit from the student) rather than copied, so editing the student's grade doesn't leave stale copies.
- Ledger `balance_after` stored value is an insert-time per-subject snapshot (the guard keeps it immutable); all ledger read APIs return a live-recomputed value. **Phase B: `app/lesson/[sessionId].tsx` reads ledger_entries with raw SQL — switch to `getSessionDeduction`** so balances stay right after edits. `receipt.ts` balance lines still show the student's TOTAL balance.
- `logPastSession` delegates to `recordLesson`, so it also accepts an active/paused lesson id.
- Test harness: `students.test.ts` / `smoke.test.ts` now use the migrated DB (app code needs 009 tables).

## Phase B file ownership (parallel agents, base c49f2fc)
- **B1 Lesson flow** owns: app/lesson/**, app/student/[id]/session.tsx, end-session.tsx, log-past.tsx (becomes the Record lesson screen; keep route `/student/[id]/log-past` working or add `/student/[id]/record` + redirect), app/student/[id]/schedule.tsx (subject picker + km override), app/start-lesson.tsx, src/screens/schedule/**, src/components/home/TodayCard*, src/components/home/NeedsAttention*, src/hooks/useStartLesson.ts, SessionTimerContext*.
- **B2 Multi-subject** owns: src/components/student/StudentForm.tsx (+ subjects editor + per-student parent travel terms fields), app/student/new.tsx, app/student/[id]/edit.tsx, app/student/[id]/index.tsx (detail), app/student/[id]/ledger.tsx, app/student/[id]/adjust.tsx, app/student/archived.tsx, app/(app)/index.tsx + src/components/home/RosterStudentCard* + homeLogic (non-agenda parts), src/components/student/* except TravelOwedCard.
- **B3 Travel + money** owns: app/student/[id]/top-up.tsx (subject picker + travel owed settle), NEW app/student/[id]/travel.tsx (travel owed detail, unsettled lessons, standalone settle, settlement history), NEW src/components/student/TravelOwedCard.tsx (props `{ studentId: string; onChanged?: () => void }` — B2 renders it on the detail page), app/transaction/**, src/utils/parentMessages.ts + notifications.ts + receipt.ts (reminder includes travel owed + per-subject balance wording), app/(app)/money.tsx + src/screens/money/**, app/claim/**, app/(app)/profile.tsx (tutor payout travel vs parent travel defaults copy).
Shared rule: don't edit files you don't own; if you need something from another lane, code to the contract and note it.
