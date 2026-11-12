# HourBank — Polish & Accuracy Handoff (2026-11-12)

Audience: the implementing agent (Opus). Source: a five-track audit on `main` @ 8e05691 (money/ledger data layer, lesson lifecycle, all other screens, June screenshots + May QA report, build/tests). Every item below was confirmed by reading the code, and the money items by throwaway tests. File:line references are relative to `hourbank/`.

Mockups for the six design changes: https://claude.ai/artifact/DTWjwifgDBXnzbincJqvxH (boards 1 to 6, referenced below as **M1..M6**). **Design items are marked `[DESIGN — needs owner approval]`; do not build those until the owner has approved the mockups.** Everything else is ready to build.

## 0. Ground rules (read first)

**CLAUDE.md is stale. These facts override it:**
- Backend is local SQLite via `expo-sqlite` (`src/db/*`), not Supabase. No auth. Expo SDK 54, RN 0.81, React 19, expo-router 6.
- Styling is inline styles with `COLORS` (`src/theme/colors.ts`) and `F` (`src/theme/fonts.ts`). No `className`.
- Jest is configured (63 suites, 876 tests). `npm ci` needs `--legacy-peer-deps`.
- Balance comes from `SUM(ledger_entries.hours_delta)` (view `student_subject_balances`), never a stored column.
- Ledger: DELETE is blocked by trigger. UPDATE is allowed only on a `session_deduction` row's `hours_delta`/`subject_id` through `editLesson` (owner decision 2026-10-12, "audit not needed for now"). Do not widen that, and do not re-litigate it.
- A lesson in a non-voided claim stays editable with a nudge (owner decision 2026-10-12). Do not turn it into a block.
- Four balance states: ok (moss), warn (amber), low (crimson), owes (oxblood).
- Glossary in `CONTEXT.md` is canonical: **Claim**, **Top-up**, **Lesson**, **Void**. Do not introduce "payout", "invoice", "session" in UI copy.

**Still-valid design rules:** Fraunces never bold (italic for emphasis); Geist for UI; GeistMono for every balance, duration, timestamp, price; no hex/rgba outside `src/theme/colors.ts`, `tailwind.config.js`, `src/utils/balance.ts`; archive, never delete; nudge, never hard-block.

**The app is in real use with real data.** Every schema change is a new additive migration (next is `011`), transactional, idempotent, with a migration test like `migration009.test.ts`. Never edit an existing migration (exception: item B8, which only affects pre-002 databases).

**Never commit** `android/app/*.keystore` or `android/keystore.properties`.

**Gates for every work package:** `npx tsc --noEmit` clean; `TZ=Africa/Johannesburg npx jest` green; the CLAUDE.md pre-commit greps clean. Money/hours fixes are test-first: write the failing test from the scenario given, then fix. One PR per work package (A, B, C, D, E), in that order.

**Leave alone (audited, sound):** timer source of truth (persisted timestamps, survives kill/sleep/midnight); one-in-flight-lesson guard; double-submit guards on top-up/adjust/travel/claim; claimed-once invariant and void; restore safety (magic bytes, integrity check, safety copy, typed RESTORE); migration runner; calendar-event screens; FormScreen; Toast; SegmentedControl; Home needs-attention card; dev tools (`__DEV__` gated); `formatRand`/`formatHours`/`parseDecimal`.

---

## A. Work package A — wrong money or hours (do first)

### A1. Timer mode toggle is thrown away; online lessons get charged travel
- `app/student/[id]/session.tsx:54,440` keeps `mode` in local state only. `end-session.tsx:179` reads `session?.mode` (the DB row) so the `mode` URL param is dead. `endSession` (`src/db/sessions.ts:514-521`) never writes mode.
- Scenario: scheduled in-person lesson, tutor taps the toggle to ONLINE, ends. Review shows In-person with km; saving writes `parent_travel_fee`. Expected: online, no travel.
- Fix: add `setInFlightMode(sessionId, mode)` (guarded `WHERE status IN ('active','paused')`), call it on toggle (optimistic UI, revert + toast on error). Make mode editable on the review (segmented control, see **M2**) and have `endSession` accept `mode` and price travel from it. Tests: toggle persists across `resumeFromDb`; ending as online gives `parent_travel_fee` 0/null and `travel_km` null.

### A2. A forgotten timer bills the whole span and the real duration can never be fixed `[DESIGN — needs owner approval: M1, M2]`
- `end-session.tsx:94-100` feeds raw elapsed minutes to `defaultBilledMinutes` (`src/utils/duration.ts:11-25`), which has no ceiling; `shouldWarnBilledDeviation` only fires when the tutor changed the value. Orphan prompt (`app/_layout.tsx:178-225`) is a native Alert offering only Continue / Discard. `editLesson` never changes `duration_minutes`; `ended_at` stays wrong, and claims date lessons by `ended_at` (`src/db/claims.ts:45`).
- Scenario: start 1h timer at 15:00, app killed, reopen next day 13:14, Continue, End. Review says "Save lesson · deduct 22h" with no warning.
- Build:
  1. **Runaway rule** (pure function in `src/utils/duration.ts`, tested): a timer is *runaway* when elapsed > max(booked × 2, booked + 60 min), or > 4h when unbooked.
  2. **Orphan sheet (M1)** replaces the Alert in `_layout.tsx` with an in-app bottom sheet (reuse the ActionSheet/scrim pattern; not dismissible by Back). Title "Did this lesson already end?", started time + elapsed in mono. If runaway: an "IT ENDED AT" date + time pair defaulting to booked end (start + booked minutes; start + 1h when unbooked), live "Taught time" readout, primary "Yes, review and save it" → end-session review with `endedAt` = chosen time; secondary "No, I am still teaching" → resume timer; tertiary crimson "Discard this lesson…" → existing confirm. If not runaway: same sheet without the end-time block, primary "Continue lesson", secondary "End and review".
  3. **Review (M2)**: add STARTED and ENDED rows; ENDED is a tappable date/time (`DateTimeField` exists). Validation: ended > started, ended ≤ now. TAUGHT and the default BILLED recompute from it. When the timer is runaway, default ENDED to booked end and show the amber-fill notice from M2. Paused seconds are subtracted only if the pause intervals fall before the chosen end (simplest correct rule: if the tutor overrides the end time, taught = chosen end − start − min(paused_seconds, that span)).
  4. `editLesson` accepts `durationMinutes`; the edit form's start time + billed edits recompute `ended_at = start + duration` consistently (also fixes the inconsistent `ended_at` between the 'end' and 'record' review paths, lesson audit item 7).
- Tests: runaway rule table; review default for the 22h scenario bills 1h; `ended_at` lands on the lesson day so the claim date range picks it up.

### A3. Timer-ended lessons never snapshot the parent travel terms
- `endSession` UPDATE (`sessions.ts:516`) sets `parent_travel_fee` but not `parent_travel_mode_snapshot`, `parent_travel_flat_snapshot`, `parent_travel_per_km_snapshot`. `recordLesson` does (`:640-650`). `editLesson` then falls back to the student's current terms (`:807-811`).
- Scenario: student at R5/km, 10 km, timer lesson = R50. Raise rate to R9/km, edit km to 20 → R180. Expected R100.
- Fix: write the three snapshot columns in `endSession` exactly as `recordLesson` does. Migration 011 backfill: for completed lessons with non-null `parent_travel_fee` and null snapshots, there is no way to know the old rate, so leave null (documented) — no backfill. Test: the scenario above.

### A4. Float drift shows a zero balance as "OWES 0m"
- `ledger.ts:37-50` stores `-(billed/60)` floats; `students.ts:22-26` returns raw `SUM`; `balance.ts:4` is `hours < 0`. 5h top-up then six 50-minute lessons gives −2.2e-16 → "OWES 0m", oxblood stripe, wrong sort.
- Fix (no schema change): normalise at the read boundary to whole minutes — one helper `normaliseHours(h) = Math.round(h * 60) / 60` applied in `students.ts` row mapping, `ledger.ts currentBalance`, `subjects.ts` (replace `round6`), and inside `balanceStatus`. `formatHours` must never print "−0m"/"-0". Tests: the 6×50 min and 15×20 min cases give exactly 0 and status `low`.

### A5. Placeholder rates and missing bank details go out silently `[DESIGN — needs owner approval: M3 setup card]`
- `tutorProfile.ts:103-114` seeds blank name, R600 payout rate, R600 parent price, three sample package tiers, null payment details. Nothing prompts for them. A claim finalises at R600/h; `parentMessages.ts:195-199` drops the payment details *and* the reference line when details are empty; receipts print "HourBank" / "Tutor" as the tutor name.
- Build:
  1. Migration 011: `tutor_profile.rates_confirmed_at TEXT NULL`. Backfill to now for any profile where name is non-empty OR any claim/package exists (existing users are not nagged about rates); else null. Set it when the tutor saves either rate in Settings.
  2. **Setup card on Home (M3)**, above the Today card, shown while any of: name empty, `rates_confirmed_at` null, payment details empty. Three rows, done rows struck through with a moss tick, each open row deep-links to that field in Settings (scroll + focus). Card disappears when all three are done. Not dismissible, but it is small.
  3. Guards (nudges, not blocks): "Send reminder"/top-up message with empty payment details → confirm sheet "Parents won't know how to pay you. Add bank details / Send anyway". Finalise claim with `rates_confirmed_at` null → confirm "This claim uses the starter rate of R 600.00/h. Confirm rate / Finalise anyway".
  4. `parentMessages.ts`: always include the Reference line; with empty tutor name sign off without a dangling "Thank you!" line break issue (keep "Thank you!").

### A6. Duplicate lessons cannot be prevented or removed
- `recordLesson` has no overlap check (only `schedule.tsx:149-155` warns). There is no way to remove a completed lesson; billed minimum is 15. A duplicate also sits in the claimable pool and inflates the next claim.
- Build:
  1. On Record (form validate step): if the student already has a completed lesson overlapping the same time window, confirm "Amahle already has a lesson recorded Thu 5 Nov 15:00–16:00. Record another?".
  2. **Remove lesson** in the lesson summary ··· menu (completed lessons and charged no-shows): confirm explains "The lesson is struck from history and 1h goes back to Amahle's Maths credit." Implementation: migration 011 adds `sessions.removed_at TEXT NULL`; in one transaction append a ledger `adjustment` entry of +billed hours, same subject, reason "Lesson removed" linked to the session, set `removed_at`, zero `parent_travel_fee`. Removed lessons are excluded from `billableSessionSql` (claims), reports and travel owed, and render struck-through like cancelled. If the lesson is in a non-voided claim: block with "This lesson is in a claim. Void the claim first." (blocking is right here because the claim snapshot would otherwise pay for a lesson that no longer exists; a void is one tap away).
- Tests: remove restores the subject balance exactly; removed lesson leaves the pool and month reports; blocked while claimed.

### A7. Charged no-show pays the tutor a travel allowance `[OWNER DECISION PENDING]`
- `claims.ts:40,112-118`: a charged no-show keeps `mode='in_person'` and gets a tutor travel fee, while parent travel excludes it (`travel.ts:73`) and the code comment at `sessions.ts:769` says nobody travelled.
- Recommended: zero tutor travel for no-shows (`status='cancelled'`). Wait for the owner's answer; if they did travel to the no-show they may want both sides charged instead.

### A8. Test suite is time-dependent
- 12 tests fail unless `TZ=Africa/Johannesburg`; 2 in `src/db/__tests__/travel.test.ts` (`:171`, `:196`) fail in any zone because they create top-ups "now" and query October 2026.
- Fix: set `process.env.TZ = 'Africa/Johannesburg'` in a jest `globalSetup`; give those two tests fixed clocks (`jest.useFakeTimers().setSystemTime`) or pass explicit dates. Add `.npmrc` with `legacy-peer-deps=true` so `npm ci` works. Add a GitHub Actions workflow running tsc + jest on PRs (the repo is a public portfolio piece; a green badge matters).

---

## B. Work package B — accuracy and trust, second tier

- **B1. Top-up has no payment date.** `packages.ts:35` hard-codes now. Add a "Paid on" date field to `top-up.tsx` (default today, no future dates), stored on the package and its ledger entry date, so Money > Cash and the receipt land in the right month.
- **B2. Top-up saved screen `[DESIGN — needs owner approval: M5]`.** Replace the 8-second toast (`top-up.tsx:218-230`) with the confirmation screen in M5: summary rows, credit before → after, "Send confirmation on WhatsApp", "Share PDF receipt", "Done". `router.replace` so Back returns to the student page. Wrap `createPackage` + `settleTravel` in one transaction (`top-up.tsx:182-215`).
- **B3. Back from the lesson summary bounces.** After saving a timer lesson started from Home the stack is [(app), session, summary]; Back re-enters session, which redirects to the summary without `justSaved` (`lessonNav.ts:84-110`, `session.tsx:163-167`). Fix: dismiss the session route before replacing (reset the stack to [(app), summary]). Update `lessonNav.test.ts:92-98`.
- **B4. Edited-after-claim lessons diverge silently.** Keep the nudge (owner decision) but make it honest: in the edit confirm, state the rand effect ("This lesson is in the October claim. The claim stays at R 300.00; the extra R 300.00 is only paid if you void and re-claim."). On claim detail, show "1 lesson edited since this claim" with the lesson linked.
- **B5. Claim report is not auditable.** `claimReport.ts:83-121`: add claim number (short id), created date, period, lesson count, total hours, and the rate used per line (add `rate` to `claim_lines` in migration 011; backfill from header rate / student override where derivable, else null and print "—"). Header shows "Payout rate" only when all lines share it. Replace `rgba(200,0,0,.14)`/named colours at `:68-71` with token values.
- **B6. Archived students vanish from what is owed and dead-end.** `travel.ts:195-199` and `MoneyInView.tsx:107` drop archived students with non-zero owed hours/travel: include them, tagged ARCHIVED. `getStudent` (`students.ts:189`) filters archived, so links from transactions, Money rows and calendar events show "Student not found": load archived students read-only (banner "Archived · Restore", action buttons hidden).
- **B7. Backup.** Export filename → `HourBank-backup-2026-11-12-1743.db` (`backup.ts:134`). Stream proof photos one row at a time in `embedProofImages`/`extractProofImages` (`:106`, `:383-385`). `last_backup_at` is stamped even when the share sheet is dismissed (`:153-158`): relabel the Settings line "Last backup exported" and add the hint "Check it reached Drive or WhatsApp". Restore modal gets a "Back up first" button. Make Restore visually secondary to Back up now (`profile.tsx:647-662`).
- **B8. Migration 002 column list** (`migrations.ts:112-116`) omits `billed_minutes`, `paused_at`, `cancel_reason`, `session_type`; add them (guarded by column-exists checks). Only matters when restoring a pre-002 backup.
- **B9. Legacy lessons with NULL travel fee get priced on edit** (`sessions.ts:803-815`). When `parent_travel_fee` is NULL and the lesson predates migration 009, keep it NULL unless the tutor explicitly changes km or mode, and then show the resulting charge in the edit preview before save.
- **B10. Receipts.** `receipt.ts:357-368`: multi-subject receipts show the lesson's subject balance, not the student total (label it "Maths credit"). PDF filenames collide for two documents on one day (`:36-43`): append `-HHmm`. Top-up message labels the package amount "Lessons:" when travel is included (`parentMessages.ts:118`): use "Top-up:".

---

## C. Work package C — the tutor's daily tasks `[DESIGN — needs owner approval: M3, M4, M6]`

**One vocabulary everywhere:** "Record lesson" (enter a lesson that happened; the main path), "Start timer" (live), "Book lesson" (future), "Top up". Remove "Log past lesson", "Start lesson now", "New lesson — record or time one".

- **C1. Student page (M4).** `app/student/[id]/index.tsx`. Action block becomes: primary oxblood "Record lesson" (full width) then a three-column row of outlined buttons "Start timer", "Book", "Top up". Same block for single- and multi-subject students (multi-subject keeps the per-subject cards' shortcuts). Balance card: caption "CREDIT LEFT", a text status chip next to it (LOW · TOP-UP DUE / RUNNING LOW / OWES) so status is never colour-only, and a footer row "Last reminded Tue 3 Nov · Send reminder →" (store `last_reminded_at` per student in migration 011; offer the reminder whenever status is warn/low/owes, not only under 1h, `flowLogic.ts:31`). If no phone is saved, say so before opening WhatsApp (`recipient.ts:48`). Back label: pass `from` from every caller (HOME / SCHEDULE / MONEY), default HOME.
- **C2. Home (M3).** `TodayCard.tsx:203-213`: replace the text link with two equal outlined buttons under the card, "Record a lesson" and "Book a lesson" (both open the student picker first). Roster rows: caption above the number is the status word (OWES / LOW / LEFT), never truncated (`RosterStudentCard.tsx:105` cuts at 18 chars). Section label states the sort ("STUDENTS · LOWEST FIRST") and the link shows the count ("All 14 →"). Needs-attention "low" should not require a booked lesson (`homeLogic.ts:154-156`).
- **C3. Money (M6).** `app/(app)/money.tsx:14-22`: segments "From parents" / "My claims". My claims hero: eyebrow NOT YET CLAIMED, amount, one plain sentence, lesson fees + travel split, primary oxblood "Start a claim", and the explainer "A claim records what you pay yourself and makes a report. HourBank does not move money; do the transfer in your banking app." Voided claims stay listed, struck through. "Download report" → "Share report". On From parents, the outstanding card shows travel owed in rand next to hours owed. Column headers "Stdnts"/"Lsns" → "Students"/"Lessons" (`MoneyInView.tsx:318-319`).
- **C4. First-run dead ends.** Schedule "New lesson" and the student picker with no students show a text line only (`start-lesson.tsx:345`, `StudentPickerSheet.tsx:106`): add an "Add a student" button.
- **C5. Student form.** Grades 1–7 are hidden unless a Settings toggle is on (`StudentForm.tsx:30,119`): show all grades in the picker (R–12), drop the toggle.
- **C6. Topics optional when ending a timer** (`session.tsx:263-266`, `end-session.tsx:331-333`), matching the Record form.

---

## D. Work package D — robustness

- **D1.** `session.tsx:410-412` keyboard handling under edge-to-edge: reuse FormScreen's padding + scroll-into-view so the "+ add" topic input is never hidden.
- **D2.** Virtualise `claim/new.tsx:265-303` (FlatList, memoised rows, totals from a Set without rebuilding all rows) and `AgendaView.tsx:239-300` (SectionList; cap overdue to the last 60 days with "Show older").
- **D3.** Ref guards: void claim (`claim/[id].tsx:84-97`), Pause (`session.tsx:189`), no-show confirm (`lesson/[sessionId].tsx:318-331`).
- **D4.** Reschedule is two writes (`schedule.tsx:222-232`): one transaction.
- **D5.** A DB error on the lesson summary shows "Lesson not found" (`lesson/[sessionId].tsx:133-136`): distinguish error (retry) from not found. `saveLiveTopics` failures: toast once.
- **D6.** Settings name/payment details save only on blur (`profile.tsx:350,463`): also save on tab blur/unmount. Payment-reference preview student reloads on focus (`:120-143`).
- **D7.** Unsaved-changes guard (`useUnsavedChangesGuard`) on LessonFormScreen and schedule.

## E. Work package E — finish and consistency

- **E1. Contrast.** `amber` #B8743F is 3.3:1 on paper. Add `amberText` #96592A (4.9:1) for text and numbers; keep `amber` for fills, stripes and icons. Minimum text size 12 (9–11px at `index.tsx:79`, `MoneyInView.tsx:48`, `RosterStudentCard.tsx:99`, `PackageCard.tsx:61`, `MoneyOutView.tsx:149`).
- **E2. Touch targets ≥ 44:** `claim/[id].tsx:269,276`, `MoneyOutView.tsx:30`, `ContactsCard.tsx:100`. `ActionSheet` rows get `accessibilityRole="button"`.
- **E3. One primary button.** Oxblood fill, Geist medium label, everywhere. Odd ones out (ink): `MoneyOutView.tsx:114`, `claim/new.tsx:169`, `calendar-event/new` footer.
- **E4. One header pattern.** Back label = where you came from, mono caps; gutters 24 on every tab (Money is 20, Schedule 16); tab dividers consistent; one loading pattern (the "Loading…" block from `ui.tsx:223`; `claim/[id].tsx:101` renders blank).
- **E5. Numbers in mono inside mixed strings.** Ledger descriptions (`flowLogic.ts:365` → `StudentLedgerRow.tsx:41`), CTA labels with hours/rand (`ui.tsx:108`), toasts (`Toast.tsx:211-227`), `MoneyOutView.tsx:94`: render the numeric run in `F.mono` via nested `<Text>`. Add a small `<Num>` helper.
- **E6. Formatting.** `PackageCard.tsx:116` "hrs" → `formatHours`; `formatHours` negative sign → "−" (`format.ts:33`); pluralise screen-reader labels (`MoneyInView.tsx:326,355`); one date formatter (drop the duplicates at `index.tsx:56-61`, `claim/[id].tsx:22-29`).
- **E7. Dead code.** Delete unused `components/LedgerRow.tsx`, `StudentCard.tsx`, `BalanceBadge.tsx`, `VERIFICATION_WINDOW_HOURS` in `src/config.ts`, the deprecated `roundToBilledMinutes`. Replace rgba literals in `useDarkTabBar.ts:6-7` with `COLORS.paper12`/`paper40`.
- **E8. Docs (public repo).** Rewrite `CLAUDE.md` from section 0 above. Fix `README.md`, `hourbank/README.md` (remove Supabase, verification, NativeWind claims; describe SQLite, the ledger rules as they are, tests). Move `hourbank_claude_code_prompt.md` to `docs/history/` with a one-line "original brief, superseded" header. `scripts/README.md` has absolute `/Users/...` paths: make them relative. Update `FUTURE_TODOS.md`.

## Checked and already fixed (no work)
All 19 June screenshot items are fixed in current code except two that need a phone to confirm (keyboard covering the Topics input on the schedule form; native dialog button styling). 13 of the 22 May QA issues are fixed and 4 are obsolete; the remainder are covered by C1 (back label) and A5 (tutor name).

## Open owner decisions
1. Approve mockups M1–M6 (or mark changes).
2. A7: should a charged no-show pay tutor travel? Recommended: no.
