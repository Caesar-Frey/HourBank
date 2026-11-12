# HourBank — Audit Remediation Plan (2026-10-09)

Source: 5 parallel audits (screenshots, WIP, core UX, secondary UX, data layer). Baseline = WIP committed as 6 commits on `main` (55908e6..2a36e90), tsc + jest green (162 tests).

Code root: `/Users/mag/Documents/HourBank/hourbank`. Stack: Expo SDK 54, RN 0.81, React 19, expo-router v6, local SQLite (expo-sqlite) — NOT Supabase/SDK 52 as CLAUDE.md claims. Design rules from CLAUDE.md still apply (Fraunces never bold; all numbers GeistMono; no inline hex outside colors/tailwind/balance.ts; ledger append-only; archive not delete).

## User decisions (2026-10-09)
- Build: bug fixes + **Lesson lifecycle** + **Safety net** + **Parent comms**. Recurring lessons → FUTURE_TODOS.
- Navigation: **consolidate 6 tabs → 4**: HOME · SCHEDULE (calendar + agenda list; replaces Sessions tab) · MONEY (segment In = reports / Out = payouts & claims) · SETTINGS. Nothing removed, only merged.
- Rates: **split** — `parent_hourly_price` (what parents pay; drives top-up "Save R…" badges) vs `hourly_rate` relabelled "Payout rate" (claims).
- Billing default at end of lesson: **booked length if actual is within ±15 min of it; else round actual to nearest 15 min** (min 15). Always adjustable. Only warn when billed differs from actual by >15 min AND the tutor changed it.

## Orchestrator decisions (autonomous)
- **Max hours owed**: nudge, never hard-block (memory: design nudges not binary). 0 = "owing not allowed" → starting a lesson that would make balance negative shows a confirm ("Start anyway"); N>0 = confirm when the lesson would push owing past N. `startSession` accepts `{ allowOverOwe: true }`. Settings copy updated to match.
- **Top-up package**: no pre-selection; CTA disabled until a package is picked; selected card unmistakable (fill + border + check inside card); CTA reads "Add 10h · R 5 500.00". Fixes "paid for 10h got 5h".
- **Money format**: one deterministic `formatRand` → `R 5 500.00` (space thousands, dot decimal); compact variant `R 5 500` for badges. No `toLocaleString`.
- **Hours format**: `formatHours` → `1h 30m`, `45m`, `2h`; signed variant `+1h 30m` / `−30m`. Replace all `toFixed(1)+'h'`.
- **Decimal input**: `parseDecimal` accepts `1,5` and `1.5` → 1.5; `4,500`/`4 500` → 4500 (comma followed by exactly 3 digits = thousands). Show parsed value live.
- **NativeWind className**: root cause = `babel.config.js` lacks the NativeWind preset (removed in 817f93d); only 4 files use `className`. Fix by converting those to inline styles like the rest of the codebase (no babel change).
- Missed lesson actions: **Log as taught** (completes with deduction, prefilled booked duration), **No-show** (cancel_reason `no_show`, optional "charge anyway" toggle → deduction), **Reschedule**, **Cancel**.

## Phase 1 — foundations (parallel, disjoint files)

### WS-1a Session/ledger data layer (owns: src/db/sessions.ts, students.ts, tutorProfile.ts, migrations.ts, schema.ts, src/types/*, src/utils/duration.ts, related tests)
- Migration **007** (single migration owning ALL schema changes this run):
  - fix one-in-flight unique index (expression index on constant `(1)` WHERE status IN ('active','paused'))
  - ledger_entries: BEFORE UPDATE / BEFORE DELETE → RAISE(ABORT); relax deduction-sign trigger so `adjustment` may be ±, requiring non-empty note
  - tutor_profile: `parent_hourly_price` (default = existing hourly_rate), `payment_details` TEXT (bank details for reminders), `billing_round_minutes` default 15
  - students: `parent_name`, `parent_phone` (if absent — check schema), keep existing
  - sessions: `cancel_reason` (if absent) to record `no_show` / `discarded`; nothing that needs a table rebuild
- Migration runner: support non-transactional migrations so `PRAGMA foreign_keys=OFF` actually applies (002 currently nulls `ledger_entries.related_session_id` on upgrade). Regression test: seed v1-shaped DB with linked ledger row → run all → link preserved.
- `startSession`: guard `WHERE status='scheduled'` + changes check, in a transaction; return typed result / throw typed `SessionError{code}` with codes ALREADY_ACTIVE, OVER_OWE_LIMIT (overridable), NOT_STARTABLE. `createAndStartUnscheduled` atomic (no orphan row).
- `discardSession(id)` guarded `status IN ('active','paused')`, sets ended_at + cancel_reason 'discarded'.
- `endSession` while paused: close open pause interval. Pause/resume DB updates guarded by status.
- `logPastSession({studentId, startedAt, minutes, topics, notes, sessionId?})` → completed session + deduction in one txn (used by quick-log and "Log as taught").
- `markNoShow(id, {charge, minutes})`, `rescheduleSession(id, newDate)`, `cancelScheduled(id)`.
- `listAgenda(now)` → { today, overdue (past scheduled not started), upcoming } from LOCAL start of day; include paused/active.
- `createAdjustment({studentId, hoursDelta, reason})` (append-only).
- Archive: cancel future scheduled lessons on archive (return count); `listArchivedStudents`, `restoreStudent`.
- `defaultBilledMinutes(actualMin, bookedMin, round=15)` per user decision.
- `resumeFromDb` elapsed for paused sessions uses paused_at not now.
- Week stats exclude archived students.

### WS-1b Calendar/reports/claims/utils (owns: src/db/calendar.ts, reports.ts, claims.ts, seed.ts, src/utils/format.ts, claim.ts, claimReport.ts, receipt.ts, backup.ts, notifications.ts, + tests)
- calendar.ts: overlap SQL uses julianday() both sides; COALESCE(estimated_duration_minutes,60); COALESCE(ends_at, starts_at); only time_block counts as busy; select estimated_duration for scheduled; place completed lessons at started_at with time range; multi-day events overlap range query; exclude archived students.
- reports.ts: local-midnight month bounds; durations = billed minutes; drop dead 'verified' status logic; per-student breakdown returned.
- claims.ts: rate fallback reads profile default (never R0); claim period end displayed inclusive (store exclusive, display end−1 day) — export a `formatClaimPeriod` helper; void watermark.
- claimReport.ts + receipt.ts: HTML-escape all user text (security finding); VOID watermark; branded receipt (tutor name, topics, time range, notes); receipt upsert not insert-per-tap; `buildLessonReceiptText` / `buildTopUpText` / `buildLowBalanceReminderText` (plain text for WhatsApp); `openWhatsApp(phone, text)` using `whatsapp://send?phone=27…&text=` with Share.share fallback; SA phone normalisation (0XX → 27XX).
- format.ts: formatRand, formatRandCompact, formatHours, formatHoursSigned, parseDecimal, consistent date formats (`Thu 9 Oct`, `09:30`). Tests.
- seed.ts resetDb: delete claim_lines, claims, calendar_events first.
- backup.ts: **restore** — `importBackup(uri)`: copy to temp, open read-only, `PRAGMA integrity_check`, required tables present, migration version ≤ app's; return summary (students, ledger rows, last entry date) for confirmation; then close main DB, replace file (+ remove -wal/-shm), reopen, run migrations. Proof photos: `persistProofImage(cacheUri)` copies to documentDirectory/proofs; backup embeds proofs into a `backup_blobs` table in the exported snapshot (base64) so the single .db file is self-contained; restore extracts them. Only stamp `last_backup_at` when share completes (best effort); clean temp files.

### WS-2 UI foundation (owns: src/components/*, src/theme/*, tailwind.config.js, package.json, app/_layout.tsx provider mounting only)
- Toast host + `useToast()` (success/error/info, optional Undo action), mounted at root. `expo-haptics` light impact on success.
- Keyboard: form wrapper that works with Android edge-to-edge (prefer `react-native-keyboard-controller` KeyboardAwareScrollView if compatible with SDK 54 via `npx expo install`; else KeyboardAvoidingView + scroll-to-focused).
- ScreenHeader: 44pt hit area/hitSlop, paper background + hairline divider, optional right action; shared `TabHeader` for tab roots.
- Convert the 4 `className` users to inline styles (LedgerRow, PackageCard, TopicChip, student/[id]/index.tsx container) — PackageCard selected state unmistakable.
- Tokens: darken `inkFaint` to ≥4.5:1 on paper; add `scrim`, `cardFill` etc. to replace rgba literals; tab label font F.sansMed. One shared event-kind colour map (top-up = moss everywhere; calendar event types must not reuse balance-status colours ambiguously).
- Touch targets ≥44pt on TopicChip, steppers, chips (hitSlop where visual size must stay).

## Phase 2 — screens (parallel after Phase 1, disjoint files)

### WS-3 Live lesson flow (owns: app/_layout.tsx, src/context/SessionTimerContext*, app/student/[id]/session.tsx, end-session.tsx, app/lesson/[sessionId].tsx)
- Don't `endTimer()` before end-session; reset only after endSession commits; elapsed recomputed from DB on focus. Back from end-session returns to a live timer.
- After save: `router.dismissTo` / replace stack so Back never shows stale timer; land on lesson summary with **Send via WhatsApp** (text) + Share PDF.
- Remove broken "Save draft" or make it pause + surface as draft (choose: remove; notes persist via state while screen mounted; fix false copy).
- Billing default per decision; 15-min steppers + tap to type; warning only when tutor deviates.
- Orphan recovery: only on cold start or when context idle but DB has active/paused; exact route regex; Discard uses `discardSession` + context reset + confirm; copy handles paused.
- DB init gate: blocking error screen with retry if migrations fail; font error handled.
- Lesson summary: status badge (cancelled/no-show), no "Session not found" flash, 2×2 tiles, start–end time, back button in not-found state.
- REMAINING shows amber/crimson + "OVER BY"; status bar light on timer; minimise vs discard clarity.

### WS-4 Navigation, Home, Schedule, Money, Settings (owns: app/(app)/** , app/calendar-event/**, app/claim/**)
- Tabs: HOME · SCHEDULE · MONEY · SETTINGS. Move `sessions/` content into Schedule (Agenda segment: Today / Overdue / Upcoming with actions; Start lesson now (unscheduled) entry). Money = segmented In (reports) / Out (payouts, claims). Keep routes working (redirect old paths if referenced).
- Home: Today agenda card with big Start on next lesson; "Needs attention" (overdue lessons, students owing, low balance with lesson booked); live/paused pill with student name; remove duplicate OWES line; "Showing 5 of N" + current sort; empty state CTA; error state.
- Schedule: overdue state on calendar items with Log as taught / No-show / Reschedule / Cancel; filter badge + reset + filter-aware empty copy; exclude-list filter model; Day view colour fill + legend in all views; selected-day for FAB prefill; FAB padding.
- Calendar events: end ≥ start validation (shift end with start), catch errors, focus reload, double-tap guard, optional title for blocks.
- Money/Reports: no fake PENDING, billed durations, rands in cash list, per-student table, local months.
- Payouts/claims: Android date-picker loop fix (mount picker on demand), inclusive period labels, finalise confirm + guard, R0 hint, VOID badge.
- Settings: rate split UI (Parent price / Payout rate), payment details field, billing rounding, max-owe copy per decision, tier validation on blur too, tier delete confirm, stable keys, **Restore from backup** flow with summary + typed confirm, last backup age, export only marks done on share.

### WS-5 Student & money flows (owns: app/student/**, app/transaction/**)
- Student detail: try/catch on pause/archive/reactivate; archive confirm (warn remaining credit; cancels future lessons); Start lesson now; **Log past lesson**; full ledger view ("Full →" works); top-up rows → transaction; adjustment entry ("Correct balance" with reason); parent contact card (call / WhatsApp); **Send top-up reminder** when low/owing; upcoming rows warn "will owe Xh".
- Archived students list + Restore (reachable from Home/Settings).
- New/Edit student: parent name + WhatsApp number; keyboard avoidance; double-tap guard; unify catalogs and inline validation; after create → student page with "Add first top-up" prompt.
- Top-up: ref-based guard; parseDecimal; no pre-selection; review line; persist proof image; success toast + "Send confirmation via WhatsApp"; savings badge from parent_hourly_price.
- Schedule lesson: block past times (offer "Log as past lesson" instead), projected balance includes booked lessons, mono fonts, conflict banner near time, success toast, keyboard.
- Quick-log past lesson screen (`app/student/[id]/log-past.tsx`): date/time, duration (default booked/60), topics, notes → `logPastSession`.
- Transaction detail: show proof image, share confirmation, back in not-found, hide raw UUID.

## Phase 3 — integration verification
- Android dev build on emulator (`npx expo prebuild` if native deps added; `npx expo run:android`), cold boot, then scripted flows: add student → top-up 10h → schedule → start → back from end → end → WhatsApp share fallback → log past lesson → overdue actions → archive/restore → adjustment → export + restore backup → claims period → tab navigation. Fix regressions, then `/qa`-level pass.

## Gates per workstream
TDD for data/logic (jest), `npx tsc --noEmit` 0 errors, `npx jest` green, greps (fontWeight bold, inline hex, console.log debug), hooks-after-early-return check on modified components, commit with conventional message.

---
## Phase 1 API handoff (for Phase 2 screen agents)

### WS-2 UI foundation (branch worktree-agent-a8be60fa0164b581c)
- `useToast().show({ kind:'success'|'error'|'info', message, actionLabel?, onAction?, durationMs? })`, `.hide()` — `src/components/Toast`. Provider mounted in app/_layout.tsx. No-op outside provider. Haptics built in. **Replace success `Alert.alert`s with toasts.**
- `<FormScreen header? footer? edges? contentContainerStyle? dark? scrollRef? testID?>` — keyboard-aware screen root (KeyboardAvoidingView based); also `useKeyboardHeight()`. Use for every form screen.
- `<ScreenHeader backLabel? onBack? title? right? divider? dark? style?>` (render outside ScrollView); `<TabHeader title titleAccent? subtitle? right? divider?>` for tab roots; `<HeaderIconButton icon accessibilityLabel onPress label? color? disabled?>` 44pt.
- PackageCard selected state is now unmistakable; prices via formatRand.
- Tokens (`src/theme/colors.ts`): inkFaint #706458 (5:1), teal/tealFill, oxbloodFill, cardFill, cardFillSoft, scrim, scrimSoft, ink40, inkHairline, paper10/12/20/30/40/60, transparent. **Replace all rgba literals in screens with tokens.**
- `src/theme/eventColors.ts`: `EVENT_KIND_COLORS`, `EVENT_KIND_LEGEND`, `eventKindStyle(kind)` (accepts calendar `session_*` kinds, `paused`), `ledgerDeltaColor(type, delta)`. scheduled=indigo, overdue=oxblood, live=ink, completed=teal, cancelled/no-show=inkFaint strikethrough, top-up=moss, event=plum, time block=inkSoft. **calendar.tsx:127-157 must switch to this.**
- `src/theme/fonts.ts`: `TAB_LABEL_STYLE`, `MIN_TOUCH=44`, `hitSlopFor(size)`.
- Deps added: expo-haptics, expo-document-picker (native → prebuild + rebuild needed). No keyboard-controller.

### WS-1a data layer (branch worktree-agent-ae590a2cd568d0ec4)
- Migration 007 + `ALL_MIGRATIONS` list; runner supports `foreignKeysOff`; `suspendLedgerGuards(fn)`; ledger UPDATE/DELETE blocked; adjustments ± with required reason.
- sessions.ts: `SessionError{code,details}` codes NOT_FOUND, NOT_STARTABLE, ALREADY_ACTIVE(details.activeSessionId), OVER_OWE_LIMIT(details: balanceHours, projectedBalanceHours, maxOweHours, lessonMinutes), INVALID_STATE, INVALID_INPUT; `isSessionError(e, code?)`; `checkOweLimit(studentId, lessonMinutes)`; `startSession(id,{allowOverOwe?})` (txn, scheduled only, idempotent if already active); `createAndStartUnscheduled({studentId, mode, sessionType?, estimatedMinutes?, allowOverOwe?})`; `pauseSession`, `resumeSession`; `discardSession(id)`; `computeElapsedSeconds(session, now?)` (use in resumeFromDb); `endSession(...)` pausedSeconds optional; `logPastSession({studentId, startedAt, minutes, billedMinutes?, topics, notes?, sessionId?, mode?, sessionType?})`; `markNoShow(id,{charge, minutes?})`; `rescheduleSession(id, iso, {estimatedDurationMinutes?})`; `cancelScheduled(id)`; `listAgenda(now?) → {inProgress, overdue, today, upcoming}` (AgendaItem incl student_full_name, student_subject, student_status); `listUpcomingWithProjection(studentId)` → projected_balance_after. Deprecated wrappers: cancelSession, createUnscheduled.
- **UI flow for over-owe**: catch `isSessionError(e,'OVER_OWE_LIMIT')` → confirm "Student will owe Xh — start anyway?" → retry with `{allowOverOwe:true}`. Never hard-block.
- students.ts: create/update accept `parentName?`, `parentPhone?`; `archiveStudent(id) → {cancelledLessons}`; `countScheduledLessons`; `listArchivedStudents()` (with current_balance); `restoreStudent(id)`; `createAdjustment({studentId, hoursDelta, reason})`.
- tutorProfile: `parent_hourly_price`, `payment_details`, `billing_round_minutes`.
- schema: `SessionCancelReason = 'cancelled'|'no_show'|'discarded'|'student_archived'`; Student.parent_name/parent_phone.
- duration.ts: `defaultBilledMinutes(actual, booked, roundTo=15)`, `shouldWarnBilledDeviation(billed, actual, changedByTutor)`, `BILLING_TOLERANCE_MINUTES`.
- Charged no-show = status 'cancelled' + cancel_reason 'no_show' + billed_minutes + deduction → counts as billable in reports & claimable.

### WS-1b calendar/reports/utils (branch worktree-agent-a7c45655c42f4cbe4)
- format.ts: `formatRand` → `R 5 500.00` (neg `−R 250.00`); `formatRandCompact` → `R 5 500`; `formatHours`; `formatHoursSigned` → `+1h 30m`/`−30m`; `formatMinutes`; `parseDecimal(s): number|null` (live-preview it); `formatDayShort`, `formatDateLong`, `formatTime`, `formatTimeRange(start,end)`; `formatClaimPeriod(start,endExclusive)`; `inclusivePeriodEnd`. **Replace every `toFixed(...)+'h'`, `toLocaleString`, ad-hoc `R${}` in screens.**
- html.ts `escapeHtml`; whatsapp.ts `normaliseSaPhone(raw)`, `whatsappUrl`, `openWhatsApp(phone, text) → 'whatsapp'|'share_sheet'|'dismissed'`; parentMessages.ts `buildLessonReceiptText`, `buildTopUpText`, `buildLowBalanceReminderText` (plain params: parentName, paymentDetails, suggestedPackage…); proofImages.ts `persistProofImage(uri)` (call before saving proof_image_uri).
- receipt.ts: `shareSessionReceipt`/`shareTopUpReceipt → {shared, uri}` (upsert); `getLessonReceiptText(sessionId,{parentName})`, `getTopUpReceiptText(packageId,{parentName})`.
- claimReport.ts: VOID watermark; `claimReportFilename`. claims.ts: `DEFAULT_PAYOUT_RATE`, `getDefaultPayoutRate()`, `isClaimVoided(c)`.
- calendar.ts: `findOverlappingCalendarItems(start,end,{excludeSessionId?})` (only time blocks conflict); `session_completed.startedAt`; `session_cancelled.cancelReason/billedMinutes`; `eventEndTime(e)`, `eventOverlapsDay(e, day)` (group multi-day events with this).
- reports.ts: `localMonthBounds`; TopUpRow.amount_paid/payment_method; SessionListRow.started_at/billed_minutes/cancel_reason (duration = billed secs); MonthSummary.totalLessons; perStudent. **reports.tsx: remove 'verified' check; show amount_paid; render perStudent.**
- backup.ts: `exportDatabase() → {uri, proofImages}`; `importBackup(uri, ALL_MIGRATIONS) → {summary, restore, cancel}`; `BackupError{code}`; after `restore()` reset timer context + navigate home (DB swapped). Pick file with expo-document-picker.

---
## Phase 2 route contracts (shared between screen agents)
Main is at 419cce6 (Phase 1 merged, 394 tests green).
- `/start-lesson?studentId=` — ad-hoc lesson starter (WS-4b moves app/(app)/sessions/start-unscheduled.tsx → app/start-lesson.tsx). Others link here.
- `/lesson/[sessionId]` — (WS-3) lesson summary; ALSO the action screen for a scheduled/overdue lesson: Start now · Log as taught · No-show (charge toggle) · Reschedule · Cancel. Home and Schedule link here for any lesson row.
- `/student/[id]/log-past?sessionId=` — (WS-5) quick-log past lesson; with sessionId = "Log as taught" for that booked lesson (prefill date/time/duration).
- `/student/[id]/schedule?sessionId=` — (WS-5) with sessionId = reschedule mode (uses rescheduleSession).
- `/student/[id]/adjust` — (WS-5) balance correction.
- `/student/[id]/ledger` — (WS-5) full ledger.
- `/student/archived` — (WS-5) archived list + restore.
- Tabs (WS-4a owns app/(app)/_layout.tsx): `index` HOME · `schedule` SCHEDULE · `money` MONEY · `profile` SETTINGS (file name kept, title "Settings"). WS-4b creates app/(app)/schedule.tsx and app/(app)/money.tsx and removes calendar.tsx, reports.tsx, payouts.tsx, sessions/ (moving content into src/screens/* or the new files). Any other file left in app/(app) must be hidden via `href: null`.
