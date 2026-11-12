# HourBank QA Report — 17 May 2026

**Device:** Pixel5_Lean emulator (Android 37, 1080×2340)
**Package:** `com.anonymous.hourbank`
**Duration:** ~60 min
**Scope:** Full app — all 13 routes, input flows, topics, navigation, reports drill-down
**Bug bar:** Everything including cosmetic

---

## Health Score

| Category | Score | Weight | Weighted |
|---|---|---|---|
| Console | 10 | 15% | 1.5 |
| Functional | 55 | 20% | 11.0 |
| UX | 55 | 15% | 8.25 |
| Visual | 75 | 10% | 7.5 |
| Accessibility | 70 | 15% | 10.5 |
| Performance | 85 | 10% | 8.5 |
| Content | 80 | 5% | 4.0 |
| Navigation | 50 | 10% | 5.0 |
| **TOTAL** | | | **56 / 100** |

---

## Top 3 to Fix First

1. **ISSUE-001 — Sessions tab "Edit" starts a live timer** (critical / functional) — wrong action fires, can't edit without accidentally starting a session
2. **ISSUE-002 — Duplicate topic keys, persistent error toast** (critical / console) — React key collision in `session.tsx:465` surfaces on every screen for the rest of the session
3. **ISSUE-008 — Topics have no selected/unselected visual state** (high / UX) — the entire topics feature is unusable because the tutor can't see what's planned or selected

---

## Issues

### ISSUE-001 — Sessions tab "Edit" starts live session instead of opening edit form
- **Severity:** Critical
- **Category:** Functional / Navigation
- **Screen:** `app/(app)/sessions/index.tsx` → context menu "Edit"
- **Repro:**
  1. Go to SESSIONS tab
  2. Tap any scheduled session row → bottom sheet appears (Start now / Edit / Cancel session)
  3. Tap "Edit"
  4. Live session timer launches immediately instead of the reschedule form
- **Evidence:** `screenshots/10-edit-bug-sm.png`
- **Expected:** Opens `student/[id]/schedule.tsx` (reschedule form) — confirmed working when reached via student detail EDIT link
- **Actual:** Opens `student/[id]/session.tsx` (live timer screen) — timer immediately starts running

---

### ISSUE-002 — React key collision in session topics list
- **Severity:** Critical
- **Category:** Console / Functional
- **Screen:** `app/(app)/student/[id]/session.tsx` line 465
- **Repro:**
  1. Any path that opens the live session screen
  2. Immediately triggers: "Encountered two children with the same key, `Cell Biology`. Keys should be unique…"
  3. Error toast persists on EVERY subsequent screen for the rest of the app session
- **Evidence:** `screenshots/15-error-overlay.png` (full stack trace visible)
- **Root cause:** `availableTopics.map(topic => <TopicChip key={topic} …>)` — topic strings are not unique across the catalog. Confirmed duplicate keys: Cell Biology, Genetics, Evolution, Ecology, Drama (at least 5 pairs).
- **Expected:** No console errors; unique keys via topic ID or index
- **Actual:** Persistent red error toast, React deduplication silently dropping or duplicating topic chips

---

### ISSUE-003 — Sessions tab context menu shows ⋮ icon implying separate menu, but whole row opens it
- **Severity:** Medium
- **Category:** UX
- **Screen:** `app/(app)/sessions/index.tsx`
- **Repro:** Open SESSIONS tab, observe ⋮ icon on each row
- **Expected:** ⋮ conventionally means a context menu opens on the ⋮ itself; tapping elsewhere navigates
- **Actual:** The entire row is one tap target that opens the sheet — ⋮ is just decoration; tap anywhere to open the sheet
- **Fix direction:** Replace ⋮ with a chevron (›) or keep ⋮ but make only it open the sheet

---

### ISSUE-004 — Session context menu: DISCARD and KEEP GOING are identical in style
- **Severity:** Low
- **Category:** Visual / UX
- **Screen:** Cancel session confirmation dialog
- **Evidence:** `screenshots/10-edit-bug-sm.png` (dialog visible in background after cancel)
- **Expected:** "DISCARD" styled in crimson to signal destructive action; "KEEP GOING" as primary
- **Actual:** Both options appear in identical teal/green text — no visual hierarchy

---

### ISSUE-005 — Topics in live session screen: all subject topics mixed, no grouping, no subject filter
- **Severity:** High
- **Category:** UX / Functional
- **Screen:** `app/(app)/student/[id]/session.tsx` — TOPICS COVERED section
- **Repro:** Start any live session (even accidentally) → scroll to TOPICS COVERED
- **Evidence:** `screenshots/10-edit-bug-sm.png`
- **What I see:** 50+ topic chips from all subjects (Algebra, Cell Biology, Essay Writing, Macroeconomics, Poetry, World War I…) displayed in a flat wrap with no structure
- **Expected:** Topic chips filtered to the student's subject — Amara Nkosi is Mathematics, so only Maths topics should show
- **Actual:** Every topic from every subject in the catalog dumped into one unsorted cloud

---

### ISSUE-006 — Orphan session starts without user intent (navigation side-effect)
- **Severity:** High
- **Category:** Functional
- **Screen:** Various — observed 3× during QA
- **Repro:** Occurs when navigating via Sessions tab "Edit" (ISSUE-001) or certain back-navigation sequences; session timer starts with no user confirmation
- **Expected:** A session only starts when the user explicitly taps "Start now" and confirms
- **Actual:** Sessions start silently and the error toast + session screen appear unexpectedly; the only recovery is the cancel dialog (which itself requires finding the correct tap target)
- **Note:** The spec's "orphan recovery" modal (from `_layout.tsx`) is the right recovery path — but this bug means it fires too often and for wrong reasons

---

### ISSUE-007 — Gear icon on dashboard is non-functional
- **Severity:** Medium
- **Category:** Functional / Navigation
- **Screen:** `app/(app)/index.tsx`
- **Evidence:** `screenshots/00-dashboard.png` (gear visible top-right)
- **Repro:** Tap gear icon top-right on home screen — nothing happens
- **Accessibility tree:** `click=false` on the ViewGroup containing the gear glyph
- **Expected:** Navigates to Settings/Profile (same destination as PROFILE tab and the backup banner)
- **Actual:** No response. The backup banner separately navigates to Settings — the gear icon should too.

---

### ISSUE-008 — Topics in schedule/reschedule form have no selected vs. unselected visual state
- **Severity:** High
- **Category:** UX / Topics feature
- **Screen:** `app/(app)/student/[id]/schedule.tsx`
- **Evidence:** `screenshots/` (see screenshots/27-edit-from-student.png — edit form showing topics)
- **Repro:**
  1. Tap a student's upcoming session EDIT link
  2. Scroll to TOPICS (OPTIONAL) section
  3. Topics display as plain text (Cell Biology, Ecology, Human Systems, Plants)
  4. No visual difference between "will be covered" and "won't be covered"
- **Expected:** Chip/pill style with filled (selected) vs. outlined (unselected) state — like the Duration and Mode chips above them use
- **Actual:** Plain text list — impossible to know what's planned or how to change it

---

### ISSUE-009 — Upcoming sessions show no topic on student detail and sessions list
- **Severity:** High
- **Category:** Topics feature / Content
- **Screen:** `app/(app)/student/[id]/index.tsx` and `app/(app)/sessions/index.tsx`
- **Repro:** Open any student detail → UPCOMING section; or SESSIONS tab list
- **Expected:** "Sat 23 May · 16:00 · In-person · Cell Biology" (topic inline)
- **Actual:** "Sat 23 May · 16:00 · In-person" — no topic shown even if one is scheduled
- **Note:** Topics DO show correctly in past session ledger ("Session — Comprehension") and in the lesson detail screen — only upcoming sessions are missing them

---

### ISSUE-010 — Back navigation always shows "← ROSTER" regardless of origin
- **Severity:** Medium
- **Category:** Navigation
- **Screen:** `app/(app)/student/[id]/index.tsx` and `app/(app)/student/[id]/lesson/[sessionId].tsx`
- **Repro:**
  1. Reach a student detail from Reports (tap a CASH transaction row) → back says "← ROSTER"
  2. Reach from Sessions tab → back says "← ROSTER"
  3. All paths show "ROSTER" — never reflects the true origin
- **Expected:** "← REPORTS", "← SESSIONS", "← ROSTER" depending on where you came from
- **Actual:** Always "← ROSTER"

---

### ISSUE-011 — Reports CASH drill-down navigates to student profile, not transaction detail
- **Severity:** Medium
- **Category:** UX / Navigation / Reports
- **Screen:** `app/(app)/reports.tsx`
- **Evidence:** `screenshots/14-reports-sm.png`
- **Repro:** REPORTS tab → tap a CASH transaction row → lands on student detail page
- **Expected:** A transaction receipt/detail view (date, amount, hours, reference, maybe a link to the receipt PDF)
- **Actual:** Student detail page — no affordance explains this will happen; no row indicator (arrow/chevron) suggests navigation
- **Note:** The student detail is useful from there, but the journey is confusing

---

### ISSUE-012 — Reports SESSIONS toggle not fully tested (navigation interference)
- **Severity:** Unknown — needs re-test once ISSUE-001/006 are fixed
- **Category:** Functional
- **Screen:** `app/(app)/reports.tsx` — SESSIONS tab within reports
- **Note:** Every attempt to navigate back to Reports after other actions triggered orphan session screens; the SESSIONS view in Reports was not testable in this pass.

---

### ISSUE-013 — DEV TOOLS section exposed in app (Reset database, Load demo data)
- **Severity:** High
- **Category:** Functional / Data safety
- **Screen:** `app/(app)/profile.tsx` — bottom of Settings scroll
- **Evidence:** `screenshots/05-devtools-sm.png`
- **Repro:** PROFILE tab → scroll to bottom → "DEV TOOLS" section with two buttons
- **Expected:** DEV TOOLS should be hidden in release/production builds (behind `__DEV__` guard or a debug menu), or at minimum "Reset database" requires a typed confirmation
- **Actual:** "Reset database" is one tap away from erasing all student data with no confirmation dialog observed. "Load demo data" is similarly exposed.

---

### ISSUE-014 — Top-up screen: ✓ checkmark on "10 hours" misleads as selection indicator
- **Severity:** Medium
- **Category:** Visual / UX
- **Screen:** `app/(app)/student/[id]/top-up.tsx`
- **Evidence:** `screenshots/30-topup-sm.png`
- **Repro:** Student detail → + Top up → observe tier selection grid
- **Expected:** ✓ checkmark indicates a tier IS selected; confirm button price matches
- **Actual:** ✓ appears on "10 hours" tier but confirm button shows R 3,000 (5-hour tier price) — the ✓ is likely a "popular/recommended" badge, but it's visually indistinguishable from a selection state
- **Fix:** Use a distinct icon for "recommended" (e.g. ⭐) and use the filled chip style only for the actually-selected tier

---

### ISSUE-015 — Validation uses native Android alert dialogs (out of design system)
- **Severity:** Medium
- **Category:** Visual
- **Screen:** `app/(app)/student/new.tsx`
- **Evidence:** `screenshots/` (validation alert dialog)
- **Repro:** Tap "Add student ▸" without filling required fields
- **Expected:** Inline error message under the empty field, or an in-app styled toast using the design system palette
- **Actual:** Native Android `Alert.alert()` dialog — plain white, system font, teal "OK" button — completely breaks the visual design

---

### ISSUE-016 — Receipt PDF filename is a UUID
- **Severity:** Low
- **Category:** Content / UX
- **Screen:** `app/(app)/student/[id]/lesson/[sessionId].tsx` — Send Receipt
- **Repro:** Tap "Send Receipt" → share sheet shows file `b902c21b-7f66-41a0-a177-56b406e3fa9f.pdf`
- **Expected:** `Receipt_EthanFourie_14May2026.pdf` or similar human-readable name
- **Actual:** UUID filename — not identifiable in Files app, email attachments, or Downloads

---

### ISSUE-017 — "TOTAL CRED" label truncated on dashboard stats row
- **Severity:** Cosmetic
- **Category:** Visual / Content
- **Screen:** `app/(app)/index.tsx`
- **Evidence:** `screenshots/00-dashboard-sm.png`
- **Repro:** Open app → observe the three stat cards at top
- **Expected:** "TOTAL CREDIT" or "CREDIT BALANCE" or "HOURS BANKED"
- **Actual:** "TOTAL CRED" — truncated label, reads awkwardly

---

### ISSUE-018 — "0 lessons" dashboard stat is ambiguous
- **Severity:** Low
- **Category:** Content
- **Screen:** `app/(app)/index.tsx`
- **Repro:** Open dashboard — stat row shows "0 lessons"
- **Expected:** Clear timeframe label: "0 lessons TODAY" or "0 lessons THIS WEEK"
- **Actual:** "0 lessons" with no timeframe — unclear if it means today, all-time, or something else. With 8 sessions scheduled in UPCOMING this is confusing.

---

### ISSUE-019 — Tutor name empty in Settings (may affect receipts)
- **Severity:** Medium
- **Category:** Content / Functional
- **Screen:** `app/(app)/profile.tsx`
- **Evidence:** `screenshots/02-settings.png`
- **Repro:** PROFILE tab → NAME field shows placeholder "Your full name" — no value set
- **Expected:** Receipts would show tutor name; the field is empty in demo data
- **Note:** If receipts embed the tutor name, they'll render a blank. Needs verification against the receipt PDF template.

---

### ISSUE-020 — Export database button lacks button affordance
- **Severity:** Cosmetic
- **Category:** Visual / UX
- **Screen:** `app/(app)/profile.tsx` — BACKUP section
- **Repro:** PROFILE → scroll to BACKUP section
- **Expected:** "Export database" looks like a button (border, arrow, color contrast from background)
- **Actual:** Centered text on a card with nearly identical background color — looks like a label, not a tappable action

---

### ISSUE-021 — Session detail screen has excessive blank space below Send Receipt
- **Severity:** Cosmetic
- **Category:** Visual
- **Screen:** `app/(app)/student/[id]/lesson/[sessionId].tsx`
- **Evidence:** `screenshots/22-session-detail-drill-small.png`
- **Repro:** Tap any ledger session entry → observe bottom half of screen
- **Expected:** Content fills the screen or a tasteful spacing
- **Actual:** Large blank area below "Send Receipt" — makes the screen feel unfinished

---

### ISSUE-022 — Add student form has no contact info field
- **Severity:** Low
- **Category:** Functional / Content
- **Screen:** `app/(app)/student/new.tsx`
- **Note:** No phone, email, or parent name field. Receipts are shared but there's no stored contact info. Intentional for MVP? Needs decision: where does the tutor send the receipt if no contact is stored?

---

## What Worked Well

- **Session detail page (lesson/[sessionId].tsx):** Clean layout, topics displayed correctly as chips, stats (DURATION / CREDITS USED / BALANCE AFTER) are clear and accurate, Send Receipt generates a real PDF with native share sheet
- **Ledger history on student detail:** Topics visible inline ("Session — Comprehension", "Session — Literature") — exactly what's needed
- **Balance colour-coding:** Dashboard balance values correctly use crimson (<1h), amber (1-3h), moss (≥3h)
- **Deficit warning on reschedule form:** "Student will be in deficit after this session (1h over). Remind parent to top up before Sat, 23 May." — excellent contextual nudge
- **Top-up tier system:** Package selection (5/10/15 hr tiers) with price and savings clearly shown, payment method chips, reference field, proof of payment attachment
- **Tab navigation state:** Active tab (REPORTS in crimson, underlined) is clearly indicated
- **Cancel session dialog:** "This session will be discarded" confirmation with KEEP GOING / DISCARD — correct guard against accidental loss
- **RESCHEDULE form copy:** "New time, *same student.*" — great tone
- **Receipts:** Actually work (not just stubs) — generates and shares a PDF immediately
- **SA formatting:** `R 3 000,00` currency format correct for ZAR, South African student name examples ("Amahle Dlamini")

---

## Not Tested in This Pass

- Reports → SESSIONS toggle (navigation interference from orphan session bug — re-test after ISSUE-001 is fixed)
- SESSIONS tab → "Start now" happy path (only tested via "Edit" which triggered ISSUE-001)
- Student edit flow (`student/[id]/edit.tsx`)
- `start-unscheduled.tsx` (ad-hoc session entry)
- End-session summary (`student/[id]/end-session.tsx`)
- Month navigation in Reports (only May 2026 checked)
- Orphan session recovery modal on fresh app launch

---

## Baseline

```json
{
  "date": "2026-05-17",
  "device": "Pixel5_Lean",
  "package": "com.anonymous.hourbank",
  "healthScore": 56,
  "issues": [
    {"id": "ISSUE-001", "title": "Sessions Edit starts live timer", "severity": "critical", "category": "functional"},
    {"id": "ISSUE-002", "title": "Duplicate topic keys, persistent error toast", "severity": "critical", "category": "console"},
    {"id": "ISSUE-003", "title": "⋮ icon misleads as separate menu", "severity": "medium", "category": "ux"},
    {"id": "ISSUE-004", "title": "DISCARD/KEEP GOING identical styling", "severity": "low", "category": "visual"},
    {"id": "ISSUE-005", "title": "All topics shown unfiltered in live session", "severity": "high", "category": "ux"},
    {"id": "ISSUE-006", "title": "Orphan sessions start without user intent", "severity": "high", "category": "functional"},
    {"id": "ISSUE-007", "title": "Gear icon non-functional", "severity": "medium", "category": "navigation"},
    {"id": "ISSUE-008", "title": "Topics no selected/unselected state in schedule form", "severity": "high", "category": "ux"},
    {"id": "ISSUE-009", "title": "Upcoming sessions show no topic", "severity": "high", "category": "content"},
    {"id": "ISSUE-010", "title": "Back nav always ROSTER regardless of origin", "severity": "medium", "category": "navigation"},
    {"id": "ISSUE-011", "title": "Reports CASH drill-down lands on student profile", "severity": "medium", "category": "ux"},
    {"id": "ISSUE-013", "title": "DEV TOOLS exposed in production", "severity": "high", "category": "functional"},
    {"id": "ISSUE-014", "title": "Top-up tier checkmark misleads as selected state", "severity": "medium", "category": "visual"},
    {"id": "ISSUE-015", "title": "Validation uses native alert dialogs", "severity": "medium", "category": "visual"},
    {"id": "ISSUE-016", "title": "Receipt PDF has UUID filename", "severity": "low", "category": "content"},
    {"id": "ISSUE-017", "title": "TOTAL CRED truncated", "severity": "cosmetic", "category": "visual"},
    {"id": "ISSUE-018", "title": "0 lessons stat ambiguous", "severity": "low", "category": "content"},
    {"id": "ISSUE-019", "title": "Tutor name empty", "severity": "medium", "category": "content"},
    {"id": "ISSUE-020", "title": "Export button lacks affordance", "severity": "cosmetic", "category": "visual"},
    {"id": "ISSUE-021", "title": "Session detail excessive blank space", "severity": "cosmetic", "category": "visual"},
    {"id": "ISSUE-022", "title": "No contact info on new student form", "severity": "low", "category": "functional"}
  ]
}
```
