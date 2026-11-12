# HourBank — Design & Feature Reference

This file captures all UI/UX decisions, screen-by-screen feature requirements, and design source decisions. It supersedes and refines the original `hourbank_claude_code_prompt.md` where the two conflict. Do not repeat yourself to future Claude instances — read this file instead.

---

## Design Direction

**Primary reference: the mockup screenshots** (the still-frame designs with the warm cream/paper aesthetic).
The prototype screens are a secondary reference — only specific elements are adopted from them (called out below per screen).

Design system (colours, fonts, spacing) remains as specified in `hourbank_claude_code_prompt.md` and `CLAUDE.md`. No changes there.

---

## Screen 1 — Roster (`app/(app)/index.tsx`)

### What changes from the original spec

**Remove:** The "Good morning, [name]." greeting block entirely. It adds no utility.

**Keep from mockup:**
- `HourBank` wordmark top-left (Hour in serif regular, Bank in serif italic oxblood)
- Settings gear icon top-right
- Date eyebrow in mono uppercase: `MONDAY · 04 MAY`
- `THIS WEEK` / `ACTIVE` stat tiles
- `ROSTER` section label + `All →` link
- Student cards: name / grade · subject · curriculum left side, BALANCE right side separated by hairline

**Adopt from prototype (not mockup):**
- Balance display uses full colour-coded treatment: value in `text-moss` / `text-amber` / `text-crimson` (more visually pronounced than mockup's subtle display)
- Each card shows the **next scheduled session** beneath the student's subject line — format: `Next: Thu 8 May · 15:00 · Maths` in mono 10px `text-inkFaint`
- Red left-edge stripe on card when balance < 1h (as in mockup)

### Roster view modes

**Default (limited) view:** Shows only the first N students (3–5), ordered by current sort. `All →` link in section header reveals full list.

**All view:** Full scrollable list with a **search bar** at the top. Search filters by student name, subject, grade, curriculum in real time.

### Sort options

Tapping `ROSTER` label (or a sort icon beside it) opens a bottom sheet or inline toggle with sort options:
- `Balance ↑` (lowest first — default, surfaces students needing top-up)
- `Next session` (soonest first)
- `Name A–Z`
- `Grade`

Persist the selected sort in local state (or AsyncStorage) across sessions.

### Removed from home

The "Begin session" button / shortcut that was on the home screen is **removed**. Session start happens from the Student Ledger screen by tapping a scheduled upcoming session.

---

## Screen 2 — Student Ledger (`app/student/[id].tsx`)

### Header & balance

Keep mockup header exactly:
- Nav row: `← ROSTER` left, `···` menu right
- Meta: `STUDENT · GR [X] · [CURRICULUM]` mono small
- Student name: serif 32px
- Italic subject · mode line: `Mathematics · In-person`

Balance hero card (keep mockup double-border certificate style):
- `★ REMAINING BALANCE` mono ribbon
- Large serif number + italic `hours` unit
- **Remove:** "Last payment date" footnote — not needed
- **Add:** Status tip line using contextual copy:
  - If balance < 1h: `— Top-up due.`
  - If balance 1–3h: `— Running low.`
  - If balance ≥ 3h: omit or show `— Healthy balance.`
- **Add:** Next session tip line (if one exists): `Next: Thu 8 May · 15:00 · In-person` in mono inkFaint

**Do not display session rate / hourly rate anywhere on this screen.**

### Action row

Two buttons beneath balance card:
- `+ Top up` ghost button → top-up screen
- `Schedule lesson` ghost button → lesson schedule screen (new screen — see below)

**Remove:** `Begin session ▸` button from here. Session start is triggered from the upcoming sessions list below.

Zero-balance guard: if balance ≤ 0, show tooltip `Top up required` on Schedule lesson (still tappable, but shows warning — see Lesson Schedule screen logic).

### Ledger + Session History (combined view)

The ledger section merges two sub-views. Section header: `HISTORY` with `Full →` link.

**Upcoming sessions tab / sub-section** (shown first, above past entries):
- Label: `UPCOMING` in mono uppercase
- List of scheduled future sessions, chronological (soonest first)
- Each row: date column (mono DD/MMM), description `[Subject] · [Mode]`, time in mono, status badge `SCHEDULED`
- **Tapping an upcoming session row starts that session** → navigates to Live Session screen (Screen 3) with the scheduled session data pre-populated (student, subject, mode, scheduled topics if any)

**Past sessions / ledger entries** (below upcoming):
- Label: `LEDGER — LAST 5 ENTRIES`
- Each row matches mockup style: date left, description + italic sub-label, delta right in mono
- For session deduction rows, show verification status sub-label in italic inkFaint:
  - `verified by parent` (moss tint)
  - `pending verification` (amber tint) — shown until window expires
  - `disputed` (crimson tint)
- For top-up rows: `+ X.Xh added` in moss, no verification badge
- For adjustment rows: show `adjustment` sub-label

**Verification window logic** (configurable, default 24h):
- After session is saved with `pending_verification`, a timer runs server-side or client-side
- If parent does not dispute within the window, session auto-transitions to `verified`
- Window duration is a tutor setting (stored in `tutor_profile`, e.g. `verification_window_hours integer default 24`)

---

## Screen 3 — Live Session (`app/student/[id]/session.tsx`)

**Use the mockup design entirely.** The prototype layout is discarded.

### Mockup layout (dark palette — `bg-sessionBg`, `text-paper`):

1. Nav row: `× CANCEL` left (confirm alert), `📍 IN-PERSON` / `💻 ONLINE` mode indicator right — tapping cycles mode
2. Student name: serif 18px centred
3. Sub-label: `GR [X] [SUBJECT] · SESSION [N]` mono
4. Timer circle: 220×220, outer `border border-paper/20 rounded-full`, inner ring `inset-3 border-paper/12`
   - `ELAPSED` mono label
   - Large mono digits: `00:47` in paper, seconds `:23` in oxblood italic
   - Running indicator: `• LIVE · X.Xh REMAINING` mono small (remaining = current balance - elapsed so far)
5. `TOPICS COVERED` label + chip wrap row
   - Pre-populated from `DEFAULT_TOPICS[subject]`
   - Chips toggle; `+ add` opens inline text input
6. Bottom controls: `Pause` ghost left, `End Session ▸` oxblood right (2:1 ratio)

### When launched from a scheduled session

If the session was scheduled in advance (tapped from upcoming list), pre-populate:
- Mode (from scheduled session)
- Any pre-selected topics saved during scheduling
- Session number (count of verified sessions + 1)

### When launched ad-hoc (future consideration)

Ad-hoc start is Phase 2. MVP: all sessions start from a scheduled slot.

---

## Screen 4 — End Session / Sign Off (`app/student/[id]/end-session.tsx`)

**Use the mockup design entirely.** Prototype layout discarded.

### Mockup layout:

1. Nav row: `← BACK` (confirm before discarding)
2. Header: `REVIEW & SIGN OFF` mono; `Session` serif + italic oxblood `complete.`
3. Summary receipt rows (each `flex-row justify-between py-2.5 border-b border-paperEdge`):
   - `STUDENT` → student full name
   - `DATE` → formatted date of session (added field — not in original spec)
   - `GRADE` → `Gr [X] · [Curriculum]` (added field)
   - `SUBJECT` → subject string (added field)
   - `DURATION` → `1h 30m` in mono
   - `MODE` → `In-Person` or `Online`
   - `BALANCE AFTER` → `X.Xh remaining` in mono + status colour
4. `TOPICS COVERED` mono label + editable chip row (chips from session screen, still editable here). Inline error if none selected.
5. `NOTES` mono label (renamed from "Notes for parent") — multi-line text input, serifItalic placeholder
6. Buttons: `Save draft` ghost left, `Save & send ▸` oxblood right

Save logic unchanged from original spec.

---

## Screen 5 — Top-Up (`app/student/[id]/top-up.tsx`)

**Use the mockup design entirely.**

**Adopt from prototype:**
- `— Best Value` italic moss banner on the 10h package card (the pre-selected default)

### Mockup layout:

1. Nav: `← [STUDENT NAME]`
2. Hero: `★ ADD CREDITS` mono oxblood; `How many` serif + italic oxblood `hours?`
3. 2×2 package grid:
   - `5hrs / R 3,000` (no discount note)
   - `10hrs / R 5,500 / — save R500` + `— Best Value` moss italic banner (pre-selected, checkmark ✓ oxblood)
   - `15hrs / R 8,000 / — save R1,000`
   - `Other / Custom` → inline inputs for hours + amount
4. `PAYMENT METHOD` → dropdown picker: `EFT — Standard Bank` default (allow configurable bank name in tutor profile)
5. `REFERENCE` → mono text input, placeholder `e.g. AN0504`
6. `PROOF OF PAYMENT` → `Attach image (optional)` row with `+` icon
7. Full-width `Confirm top-up · R X,XXX ▸` oxblood CTA (reactive to selection)

---

## Screen 6 — Lesson Schedule (NEW — `app/student/[id]/schedule.tsx`)

This screen does not exist in the original spec. It is a first-class MVP screen.

### Entry points
- `Schedule lesson` button on Student Ledger (Screen 2)
- Future: from Sessions tab

### Layout

1. Nav: `← [STUDENT NAME]`
2. Header: `SCHEDULE LESSON` mono oxblood; `When are` serif + italic oxblood `you meeting?`
3. **Date & Time picker:**
   - Date: native date picker or custom calendar row — selected date displayed large in serif
   - Time: time picker, 30-min increments preferred
4. **Duration estimate:**
   - Segmented control or stepper: `0.5h · 1h · 1.5h · 2h · Custom`
   - Default: 1h
5. **Mode:**
   - Toggle: `📍 In-Person` / `💻 Online` — defaults to student's `mode_default`
6. **Subject:** pre-filled from student record, read-only label (editable in Phase 2 for multi-subject students)
7. **Topics (optional):** chip row from `DEFAULT_TOPICS[subject]` — pre-select for the lesson. Not mandatory at scheduling time.
8. **Notes (optional):** short text input for session prep notes
9. **Credit check banner** (computed: current balance − estimated duration):
   - Balance will be `X.Xh` after this session → show in moss/amber/crimson
   - If projected balance < 0: show **amber warning card**:
     `"Student will be in deficit after this session (−X.Xh). Remind parent to top up before [date]."`
     The **schedule button remains enabled** — the lesson can still be booked.
   - If balance ≤ 0 right now (before the session): show crimson banner `"No credits remaining. This lesson will run on deficit."`
10. **CTA:** `Confirm lesson ▸` oxblood full-width button

### Data model (`sessions` table additions)

Scheduled sessions use the existing `sessions` table with:
- `status = 'scheduled'` (add to CHECK constraint)
- `scheduled_for timestamptz` (new column — the planned date/time)
- `estimated_duration_minutes numeric(6,2)` (new column)
- `started_at` remains null until session is started from the upcoming list

When the tutor taps a scheduled session row to start it:
- Set `started_at = now()`, `status = 'active'`
- Navigate to Live Session screen

---

## Verification Window — Configuration

Add `verification_window_hours integer not null default 24` to `tutor_profile` table.

Exposed in Profile / Settings screen as a simple stepper or picker: `2h / 6h / 12h / 24h / 48h`.

Auto-verification logic (Phase 2 for server-side cron; MVP: client-side check on app open):
- On app focus, query sessions where `status = 'pending_verification'` and `ended_at < now() - interval '[window] hours'`
- Batch update those to `status = 'verified'`, `verified_at = now()`, `verification_method = 'silent'`

---

## Data Model Changes (delta from original spec)

```sql
-- sessions table: add columns
alter table public.sessions add column scheduled_for timestamptz;
alter table public.sessions add column estimated_duration_minutes numeric(6,2);

-- sessions status: expand CHECK
-- Replace existing check with:
check (status in ('scheduled','active','pending_verification','verified','disputed','cancelled'))

-- tutor_profile: add verification window
alter table public.tutor_profile add column verification_window_hours integer not null default 24;
```

---

## Removed / Deferred Items

| Item | Decision |
|---|---|
| "Good morning" greeting | Removed permanently |
| "Last payment date" on balance card | Removed permanently |
| Session hourly rate display | Removed permanently |
| Ad-hoc session start (no schedule) | Phase 2 |
| Parent-facing dispute UI | Phase 2 |
| Push notifications | Phase 2 (stub only) |
| Email/receipt delivery | Phase 2 (stub only) |

---

## Tab Bar

Four tabs (unchanged from spec): HOME · SESSIONS · REPORTS · PROFILE

`SESSIONS` tab (MVP stub): shows all upcoming sessions across all students, sorted by date. Read-only list. Full functionality Phase 2.

---

## Build Priority (MVP phase 1)

1. Scaffold + Supabase schema (including `scheduled` status + `scheduled_for` column)
2. Auth screen
3. Roster screen (with sort + limited/all view + next-session display)
4. Student Ledger screen (combined upcoming + ledger, verification badges)
5. Lesson Schedule screen (new — required before session start)
6. Live Session screen
7. End Session / Sign-Off screen
8. Top-Up screen
9. Verification auto-update on app focus
