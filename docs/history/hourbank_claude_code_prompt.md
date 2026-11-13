> Original brief, superseded. The app no longer uses Supabase or NativeWind; see CLAUDE.md for the current rules.

# HourBank — Claude Code Build Prompt

Paste everything below this line into Claude Code.

---

## ROLE & MISSION

You are building **HourBank** — a React Native (Expo) mobile app for a
single private high-school tutor running a prepaid-credits tutoring
business in South Africa. Parents pay upfront for hour blocks. The tutor
runs sessions, deducts hours from the student's balance, and parents
receive a verified receipt after each session.

You will scaffold the full project from scratch, write the Supabase
schema, implement all five MVP screens, and wire up navigation. Work
methodically: scaffold → schema → navigation shell → screens one by one
→ business logic → finishing pass.

---

## TECH STACK — do not deviate

| Layer | Choice | Notes |
|---|---|---|
| Framework | Expo SDK 52 (managed workflow) | `npx create-expo-app` |
| Language | TypeScript strict mode | `tsconfig.json` with `strict: true` |
| Navigation | Expo Router v4 (file-based) | `app/` directory |
| Styling | NativeWind v4 (Tailwind for RN) | className props |
| UI components | Custom only — no component libraries | Build from design tokens |
| Backend | Supabase (Postgres + Auth + Storage) | JS client v2 |
| Fonts | Expo Google Fonts | `useFonts` hook |
| Icons | `@expo/vector-icons` (Feather set) | |
| State | React `useState` / `useReducer` + Supabase realtime | No Redux/Zustand in MVP |
| Notifications | Stub only in MVP | `console.log` the payload |
| Email/receipts | Stub only in MVP | `console.log` the payload |

---

## DESIGN SYSTEM — honour this exactly

### Colours (CSS / NativeWind config)

```js
// tailwind.config.js — extend theme.colors with:
colors: {
  paper:       '#F4EFE6',   // warm cream — primary background
  paperDeep:   '#ECE5D6',   // slightly darker cream — card fills
  paperEdge:   '#D9CFBF',   // hairline borders
  ink:         '#1B1714',   // near-black warm — primary text
  inkSoft:     '#4A413A',   // secondary text
  inkFaint:    '#8A7E72',   // labels, placeholders
  oxblood:     '#7A2530',   // primary accent — CTAs, emphasis
  oxbloodDeep: '#5C1B24',   // pressed state
  moss:        '#3F5641',   // status: good (balance ≥ 3h)
  amber:       '#B8743F',   // status: warning (balance 1–3h)
  crimson:     '#9A2A2A',   // status: low (balance < 1h)
  okFill:      '#E4EAE0',   // moss tint background
  warnFill:    '#F0E0CB',   // amber tint background
  badFill:     '#EFD7D7',   // crimson tint background
  sessionBg:   '#1B1714',   // live session inverted screen
}
```

### Typography

Load these three fonts via `expo-google-fonts`. If a package does not exist
for one, fall back to `@expo-google-fonts/inter` as a temporary placeholder
and note it with a TODO comment.

- **Display:** `Fraunces_300Light_Italic` and `Fraunces_400Regular` —
  used for all screen headlines, student names, balance hero numbers,
  and any italic emphasis. NEVER use bold for emphasis; use italic Fraunces
  instead.
- **Body:** `Geist_400Regular` and `Geist_500Medium` — UI labels, body
  copy, buttons.
- **Numerals:** `GeistMono_400Regular` and `GeistMono_500Medium` — ALL
  balances, durations, timestamps, prices, ledger deltas. This rule is
  absolute. Monospaced numerals are the visual identity of the ledger.

Create a `src/theme/fonts.ts` file that exports font family constants:

```ts
export const F = {
  serif:      'Fraunces_400Regular',
  serifItalic:'Fraunces_300Light_Italic',
  sans:       'Geist_400Regular',
  sansMed:    'Geist_500Medium',
  mono:       'GeistMono_400Regular',
  monoMed:    'GeistMono_500Medium',
} as const;
```

### Design rules (hard constraints)

1. **Hairlines, not shadows.** All card borders are `border border-paperEdge`.
   No `shadow-*` classes on cards within screens. Only use elevation/shadow
   on the outermost phone frame in any marketing view.
2. **Monospaced numerals always.** Every balance figure, hour count, price,
   and timer digit uses `fontFamily: F.mono` or `F.monoMed`.
3. **Italic serif for emphasis.** When highlighting a word or figure, use
   `fontFamily: F.serifItalic color-oxblood`. Never `fontWeight: 'bold'`.
4. **Status by colour only.** Three-tone balance system — moss / amber /
   crimson. No icons needed for status; colour carries it.
5. **Active session screen inverts to dark.** Background `bg-sessionBg`,
   text `text-paper`. All other screens: `bg-paper` text `text-ink`.
6. **Spacing rhythm.** Use Tailwind spacing consistently. Primary screen
   padding: `px-6 pt-4 pb-6`. Card padding: `p-4`. Gap between cards: `gap-3`.

---

## SUPABASE SCHEMA

Create the file `supabase/migrations/001_initial.sql` with the following.

```sql
-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- TABLES
-- ============================================================

create table public.tutor_profile (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users(id) on delete cascade unique not null,
  full_name   text not null,
  email       text not null,
  phone       text,
  currency    text not null default 'ZAR',
  hourly_rate numeric(10,2) not null default 600.00,
  created_at  timestamptz not null default now()
);

create table public.parents (
  id                uuid primary key default uuid_generate_v4(),
  tutor_id          uuid references public.tutor_profile(id) on delete cascade not null,
  full_name         text not null,
  email             text not null,
  phone             text,
  preferred_channel text not null default 'email'
    check (preferred_channel in ('email','sms','whatsapp')),
  created_at        timestamptz not null default now()
);

create table public.students (
  id                  uuid primary key default uuid_generate_v4(),
  tutor_id            uuid references public.tutor_profile(id) on delete cascade not null,
  parent_id           uuid references public.parents(id) on delete set null,
  full_name           text not null,
  grade               smallint check (grade between 1 and 12),
  school              text,
  subject             text not null,
  curriculum          text not null default 'CAPS'
    check (curriculum in ('CAPS','IEB','Cambridge','Other')),
  hourly_rate         numeric(10,2),
  mode_default        text not null default 'in_person'
    check (mode_default in ('in_person','online','hybrid')),
  verification_mode   text not null default 'silent'
    check (verification_mode in ('live_signature','silent')),
  status              text not null default 'active'
    check (status in ('active','paused','archived')),
  notes               text,
  created_at          timestamptz not null default now()
);

create table public.credit_packages (
  id               uuid primary key default uuid_generate_v4(),
  student_id       uuid references public.students(id) on delete cascade not null,
  hours_added      numeric(6,2) not null check (hours_added > 0),
  amount_paid      numeric(10,2) not null check (amount_paid >= 0),
  currency         text not null default 'ZAR',
  payment_method   text not null default 'eft'
    check (payment_method in ('eft','cash','card','other')),
  payment_ref      text,
  proof_image_url  text,
  expiry_date      date,
  notes            text,
  created_at       timestamptz not null default now()
);

create table public.sessions (
  id                  uuid primary key default uuid_generate_v4(),
  student_id          uuid references public.students(id) on delete cascade not null,
  mode                text not null default 'in_person'
    check (mode in ('in_person','online')),
  started_at          timestamptz not null,
  ended_at            timestamptz,
  paused_seconds      integer not null default 0,
  duration_minutes    numeric(6,2),          -- computed on end, stored for easy queries
  topics              text[] not null default '{}',
  session_notes       text,
  homework_assigned   text,
  status              text not null default 'active'
    check (status in ('active','pending_verification','verified','disputed','cancelled')),
  verification_method text
    check (verification_method in ('live_signature','silent','manual')),
  verified_at         timestamptz,
  verified_by         text,
  signature_image_url text,
  manually_entered    boolean not null default false,
  location_lat        numeric(10,7),
  location_lng        numeric(10,7),
  created_at          timestamptz not null default now()
);

-- Append-only ledger — never UPDATE or DELETE rows here
create table public.ledger_entries (
  id              uuid primary key default uuid_generate_v4(),
  student_id      uuid references public.students(id) on delete cascade not null,
  type            text not null
    check (type in ('top_up','session_deduction','adjustment','refund')),
  hours_delta     numeric(6,2) not null,   -- positive = credit, negative = debit
  balance_after   numeric(8,2) not null,   -- snapshot for quick display
  related_session_id  uuid references public.sessions(id) on delete set null,
  related_package_id  uuid references public.credit_packages(id) on delete set null,
  reason          text,                    -- required for adjustment and refund
  created_at      timestamptz not null default now()
);

-- ============================================================
-- VIEWS
-- ============================================================

-- Live balance per student (source of truth)
create or replace view public.student_balances as
  select
    s.id as student_id,
    s.full_name,
    s.subject,
    s.curriculum,
    s.grade,
    s.status,
    coalesce(sum(le.hours_delta), 0) as current_balance,
    count(distinct se.id) filter (where se.status = 'verified') as total_sessions
  from public.students s
  left join public.ledger_entries le on le.student_id = s.id
  left join public.sessions se on se.student_id = s.id
  where s.status != 'archived'
  group by s.id, s.full_name, s.subject, s.curriculum, s.grade, s.status;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.tutor_profile    enable row level security;
alter table public.parents          enable row level security;
alter table public.students         enable row level security;
alter table public.credit_packages  enable row level security;
alter table public.sessions         enable row level security;
alter table public.ledger_entries   enable row level security;

-- Helper: get the tutor_profile.id for the authenticated user
create or replace function public.my_tutor_id()
returns uuid language sql stable
as $$ select id from public.tutor_profile where user_id = auth.uid() $$;

-- tutor_profile: own row only
create policy "tutor: own row" on public.tutor_profile
  for all using (user_id = auth.uid());

-- parents: own students' parents
create policy "tutor: own parents" on public.parents
  for all using (tutor_id = public.my_tutor_id());

-- students: own students
create policy "tutor: own students" on public.students
  for all using (tutor_id = public.my_tutor_id());

-- credit_packages: own students' packages
create policy "tutor: own packages" on public.credit_packages
  for all using (
    student_id in (select id from public.students where tutor_id = public.my_tutor_id())
  );

-- sessions: own students' sessions
create policy "tutor: own sessions" on public.sessions
  for all using (
    student_id in (select id from public.students where tutor_id = public.my_tutor_id())
  );

-- ledger_entries: own students' ledger
create policy "tutor: own ledger" on public.ledger_entries
  for all using (
    student_id in (select id from public.students where tutor_id = public.my_tutor_id())
  );
```

---

## PROJECT STRUCTURE

Scaffold this exact directory layout:

```
hourbank/
├── app/
│   ├── _layout.tsx               # Root layout — font loading, auth gate, Supabase provider
│   ├── (auth)/
│   │   └── sign-in.tsx           # Email + password sign-in
│   ├── (app)/
│   │   ├── _layout.tsx           # Tab bar layout
│   │   ├── index.tsx             # Screen 1: Roster (home tab)
│   │   ├── sessions.tsx          # Tab placeholder (stub in MVP)
│   │   ├── reports.tsx           # Tab placeholder (stub in MVP)
│   │   └── profile.tsx           # Tab placeholder (stub in MVP)
│   └── student/
│       ├── [id].tsx              # Screen 2: Student detail + ledger
│       ├── [id]/session.tsx      # Screen 3: Live session timer
│       ├── [id]/end-session.tsx  # Screen 4: End session review + sign-off
│       └── [id]/top-up.tsx       # Screen 5: Add credit package
├── src/
│   ├── lib/
│   │   └── supabase.ts           # Supabase client singleton
│   ├── theme/
│   │   └── fonts.ts              # Font family constants (F object)
│   ├── types/
│   │   └── database.ts           # Full TypeScript types generated from schema
│   ├── hooks/
│   │   ├── useStudents.ts        # Fetch roster with balances
│   │   ├── useStudent.ts         # Fetch single student + ledger
│   │   └── useActiveSession.ts   # Timer logic, pause/resume
│   ├── components/
│   │   ├── BalanceBadge.tsx      # Colour-coded balance pill
│   │   ├── LedgerRow.tsx         # Single ledger entry row
│   │   ├── StudentCard.tsx       # Roster card
│   │   ├── TopicChip.tsx         # Selectable topic chip
│   │   ├── PackageCard.tsx       # Top-up package tile
│   │   └── ScreenHeader.tsx      # Reusable back + title row
│   └── utils/
│       ├── balance.ts            # computeBalance, balanceStatus helpers
│       ├── format.ts             # formatHours, formatRand, formatDuration
│       └── notifications.ts      # STUB — logs to console in MVP
├── supabase/
│   └── migrations/
│       └── 001_initial.sql
├── tailwind.config.js
├── babel.config.js
├── tsconfig.json
└── .env.local                    # EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY
```

---

## SCREEN SPECIFICATIONS

### Screen 1 — Roster (`app/(app)/index.tsx`)

Layout (top to bottom):
1. **Status bar** (system)
2. **Top row:** brand mark left `HourBank` in serifItalic + `color-oxblood`
   on the `Hour` part; settings icon button right.
3. **Greeting:** tiny mono eyebrow `MONDAY · 04 MAY`, serif display
   `Good morning,` newline italic oxblood `[tutor first name].`
4. **Summary strip:** two stat tiles side by side — `This Week` (hours
   taught this week) and `Active` (count of active students). Tile border
   `border-paperEdge`, background `bg-white/40`, rounded-2xl.
5. **Section label row:** `ROSTER` in mono uppercase left; italic serif
   `All →` in oxblood right.
6. **Scrollable student list:** `StudentCard` per student.
7. **Tab bar** at bottom.

`StudentCard` component:
- Outer: `border border-paperEdge rounded-2xl bg-white/40 p-4` with `flex-row`
- Left: student name in `Fraunces_400Regular` 16px; subject + curriculum in
  11px `Geist_400Regular` `text-inkSoft`.
- Right: `BalanceBadge` — separated by a `border-l border-paperEdge pl-3`.
- If balance < 1h: add a `w-0.5 bg-crimson absolute left-0 top-3.5 bottom-3.5
  rounded` vertical stripe to the card as a visual flag.

`BalanceBadge` component:
- Mono label `BALANCE` in 9px uppercase ink-faint.
- Mono value `X.X` + small `h` suffix.
- Colour: `text-moss` if ≥ 3, `text-amber` if 1–3, `text-crimson` if < 1.

Data: `useStudents` hook queries `student_balances` view, ordered by
`current_balance asc` so lowest-balance students surface first.

---

### Screen 2 — Student Detail (`app/student/[id].tsx`)

Layout:
1. **Nav row:** `← Roster` back link left; `···` menu icon right.
2. **Header block:** mono super `Student · Gr [X] · [curriculum]`;
   serif 32px student full name on two lines; italic `[subject] · [mode]`.
3. **Balance hero card:** `border-[1.5px] border-ink rounded-2xl p-5
   bg-paperDeep` with an inner inset ring `absolute inset-3 border-[0.5px]
   border-ink/20 rounded-xl pointer-events-none` (double-border certificate
   effect). Inside: mono ribbon `★ REMAINING BALANCE`; large serif number
   (56px light) with italic oxblood decimal + `hours` unit in serif italic
   18px; mono footnote with last payment date.
4. **Action row:** two equal buttons — `ghost` button `＋ Top up` links to
   top-up screen; `accent` (oxblood fill) `Begin session ▸` links to session.
   If balance ≤ 0: grey out `Begin session`, show a tooltip `Top up required`.
5. **Section label:** `LEDGER — LAST 5 ENTRIES` with `Full →` action.
6. **Ledger list:** `LedgerRow` per entry (last 5). Each row: date column
   (mono, 2 lines `DD\nMMM`), description with italic sub-label,
   delta right-aligned in mono (green for positive, `text-ink` for negative).

Data: `useStudent(id)` hook fetches student row + last 5 ledger entries
ordered `created_at desc`.

---

### Screen 3 — Live Session (`app/student/[id]/session.tsx`)

**This screen uses the inverted dark palette.**

Background: `bg-sessionBg`. All text: `text-paper`.

Layout:
1. **Nav row:** `✕ Cancel` left (confirm alert before discarding); mode
   toggle right `📍 In-Person / 💻 Online` — tapping cycles the mode.
2. **Session meta:** centred student name in serif 18px; mono sub
   `GR [X] [SUBJECT] · SESSION [N]`.
3. **Timer circle:** 220×220 circle with `border border-paper/20 rounded-full`.
   Inner ring `absolute inset-3 border-[0.5px] border-paper/12 rounded-full`.
   Inside: mono `ELAPSED` label; large serif digits `00:47` with italic
   accent-coloured seconds `23`; mono running indicator with pulsing dot
   `· Live · X.Xh remaining`.

   Timer logic lives in `useActiveSession` hook:
   - On mount: record `startedAt = Date.now()`. Interval every second
     updates `elapsed = Date.now() - startedAt - totalPausedMs`.
   - Pause: record `pauseStart`. Resume: add `Date.now() - pauseStart`
     to `totalPausedMs`.
   - On navigate-away without ending: persist state to Supabase sessions
     row (status `active`, started_at, paused_seconds) so it survives
     app restart.

4. **Topic chips:** wrap row of `TopicChip` — pre-populated with a default
   topic list for the student's subject (see Topic Lists below). Tapped chips
   toggle selected state. A `＋ add` chip opens a small text input inline.
5. **Bottom controls:** `▮▮ Pause` ghost button left; `End Session ▸` oxblood
   button right (wider, 2:1 ratio).

   On `End Session`: validate at least one topic is selected, then navigate to
   `end-session` screen passing `sessionId`, `durationMinutes`, `topics`.

**Topic lists by subject** (seed these in the component or a constants file):

```ts
export const DEFAULT_TOPICS: Record<string, string[]> = {
  'Mathematics':  ['Algebra','Functions','Trigonometry','Geometry','Statistics','Calculus','Sequences & Series','Finance Math'],
  'Physical Sciences': ['Mechanics','Waves & Sound','Electricity','Magnetism','Chemical Bonding','Reactions','Stoichiometry','Organic Chem'],
  'Life Sciences': ['Cell Biology','Genetics','Evolution','Ecology','Human Systems','Plants'],
  'English':      ['Essay writing','Language','Poetry','Novel','Drama','Comprehension'],
  'Accounting':   ['Balance Sheet','Income Statement','Cash Flow','Ratios','VAT','Payroll'],
};
```

---

### Screen 4 — End Session (`app/student/[id]/end-session.tsx`)

Layout (light palette returns):
1. **Nav row:** `← Back` (goes back to session timer; ask to confirm).
2. **Header:** mono super `REVIEW & SIGN OFF`; serif 28px `Session` newline
   italic oxblood `complete.`
3. **Summary receipt rows** (each: `flex-row justify-between py-2.5
   border-b border-paperEdge`): `STUDENT`, `DURATION` (mono formatted as
   `1h 30m`), `MODE`, `BALANCE AFTER`. First row gets `border-t` as well.
4. **Topics field:** `TOPICS COVERED` mono label; wrap row of selected topic
   chips (read from navigation params, editable here). Validation: at least
   one required — show inline error if empty on save.
5. **Notes field:** `NOTES FOR PARENT` mono label; multi-line text input
   styled as `border border-paperEdge rounded-xl p-3 bg-white/40` with
   `fontFamily: F.serifItalic` placeholder text.
6. **Bottom buttons:** `Save draft` ghost left; `Save & send ▸` oxblood right.

On `Save & send`:
1. Validate topics non-empty.
2. Compute `durationMinutes`.
3. `UPDATE sessions SET ended_at, duration_minutes, topics, session_notes,
   status = 'pending_verification', paused_seconds WHERE id = ?`
4. Compute new balance: current balance - durationMinutes/60.
5. `INSERT INTO ledger_entries (type='session_deduction', hours_delta=-(duration/60),
   balance_after, related_session_id)`
6. Call `notifications.sendReceipt(...)` — STUB in MVP, logs to console.
7. Navigate back to student detail screen, passing a `toastMessage` param
   to show `"Receipt sent to parent."` toast.

---

### Screen 5 — Top-Up (`app/student/[id]/top-up.tsx`)

Layout:
1. **Nav row:** `← [Student Name]`
2. **Hero:** mono oxblood `★ ADD CREDITS`; serif 28px `How many` newline
   italic `hours?`
3. **Package grid (2×2):** `PackageCard` for each tier.
   Tiers (hard-coded defaults, tutor can type custom amount):

   | Hours | Price (ZAR) | Note |
   |---|---|---|
   | 5 | R 3,000 | |
   | 10 | R 5,500 | `— save R500` shown in italic moss |
   | 15 | R 8,000 | `— save R1,000` shown in italic moss |
   | Other | Custom | Opens numeric input for hours + amount |

   10h pre-selected (`.selected` state). Selecting a card deselects others.
   Custom tile opens inline inputs for hours and amount.

   `PackageCard`: `border border-paperEdge rounded-2xl p-4 bg-white/40`.
   Selected: `border-[1.5px] border-ink bg-paperDeep`. Checkmark `✓` in
   oxblood top-right when selected.

4. **Form fields:**
   - `PAYMENT METHOD` — segmented control or picker: EFT / Cash / Card / Other.
     Default EFT.
   - `REFERENCE` — text input, mono font. Placeholder `e.g. AN0504`.
   - `PROOF OF PAYMENT` — `＋ Attach image` tap to open image picker,
     upload to Supabase Storage bucket `proofs/[student_id]/[timestamp].jpg`.
     Show thumbnail on attach. Optional field.

5. **CTA:** full-width `Confirm top-up · R X,XXX ▸` oxblood button. Amount
   is reactive to selected package.

On confirm:
1. `INSERT INTO credit_packages (student_id, hours_added, amount_paid,
   payment_method, payment_ref, proof_image_url)`
2. Compute new balance.
3. `INSERT INTO ledger_entries (type='top_up', hours_delta=+hours,
   balance_after, related_package_id)`
4. Call `notifications.sendTopUpConfirmation(...)` — STUB.
5. Navigate back to student detail with toast `"Credits added. Balance is now X.Xh."`.

---

## AUTH FLOW (`app/(auth)/sign-in.tsx`)

- Single screen: brand mark centred, email + password inputs, `Sign in` button.
- Use `supabase.auth.signInWithPassword({ email, password })`.
- On success, Expo Router redirects to `/(app)/`.
- No sign-up screen in MVP — the tutor account is created manually in the
  Supabase dashboard. Note this clearly in a `README.md` section.
- Root `_layout.tsx` checks `supabase.auth.getSession()` on mount and
  redirects accordingly.
- On first authenticated session, check if `tutor_profile` row exists;
  if not, show a one-time setup modal to capture `full_name`, `hourly_rate`.

---

## UTILITY FUNCTIONS

### `src/utils/balance.ts`

```ts
export type BalanceStatus = 'ok' | 'warn' | 'low';

export function balanceStatus(hours: number): BalanceStatus {
  if (hours >= 3) return 'ok';
  if (hours >= 1) return 'warn';
  return 'low';
}

export function balanceColour(status: BalanceStatus) {
  return { ok: '#3F5641', warn: '#B8743F', low: '#9A2A2A' }[status];
}
```

### `src/utils/format.ts`

```ts
export function formatHours(h: number): string {
  // e.g. 1.5 → "1h 30m", 0.5 → "30m", 7 → "7h"
}

export function formatRand(amount: number): string {
  // e.g. 5500 → "R 5,500.00"
  return `R ${amount.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`;
}

export function formatDuration(totalSeconds: number): string {
  // e.g. 4523 → "01:15:23"
}

export function formatLedgerDate(isoDate: string): { day: string; month: string } {
  // returns { day: "02", month: "MAY" }
}
```

---

## SUPABASE CLIENT (`src/lib/supabase.ts`)

```ts
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

const supabaseUrl  = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseKey  = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,  // required for React Native
  },
});
```

---

## BUSINESS RULES — enforce in code, not just comments

1. **Zero-balance guard.** In `useStudent`, expose `canStartSession: balance > 0`.
   The `Begin session ▸` button is visually disabled and shows `Top up required`
   tooltip when `!canStartSession`.

2. **Minimum topic guard.** In the End Session screen, the `Save & send` button
   is disabled until `selectedTopics.length >= 1`. Show inline error text below
   the topic chips if user attempts to save with none selected.

3. **Ledger immutability.** Never expose an edit or delete action on ledger rows
   in the UI. If a correction is needed, it goes through an "Add Adjustment"
   flow (Phase 2 feature) — stub it as a greyed `Request correction` link for now.

4. **Session orphan guard.** In `_layout.tsx`, on app focus event, query for any
   `sessions` row where `status = 'active'` and `student_id` belongs to this
   tutor. If found and the timer is not already visible, show a modal:
   `"You have an unfinished session with [name]. Continue or discard?"`.

5. **Balance computed from ledger.** Never read balance from a `students` column.
   Always read from `student_balances` view or sum `ledger_entries.hours_delta`
   for the student.

6. **No deletes, only archives.** Student delete → set `status = 'archived'`.
   All queries filter `status != 'archived'`.

---

## STUBBED FUNCTIONS (MVP — implement in Phase 2)

Create `src/utils/notifications.ts` with these stubs:

```ts
export async function sendReceipt(payload: {
  studentName: string;
  parentEmail: string;
  durationMinutes: number;
  topics: string[];
  notes: string;
  balanceAfter: number;
}): Promise<void> {
  // TODO Phase 2: send via Resend API / email template
  console.log('[STUB] sendReceipt', JSON.stringify(payload, null, 2));
}

export async function sendTopUpConfirmation(payload: {
  studentName: string;
  parentEmail: string;
  hoursAdded: number;
  amountPaid: number;
  newBalance: number;
}): Promise<void> {
  // TODO Phase 2: send confirmation email
  console.log('[STUB] sendTopUpConfirmation', JSON.stringify(payload, null, 2));
}

export async function sendLowBalanceAlert(payload: {
  studentName: string;
  parentEmail: string;
  currentBalance: number;
}): Promise<void> {
  // TODO Phase 2: fire when balance drops below 2h after any session
  console.log('[STUB] sendLowBalanceAlert', JSON.stringify(payload, null, 2));
}
```

---

## README REQUIREMENTS

Write a `README.md` at the project root covering:

1. **Project overview** — one paragraph.
2. **Setup** — step-by-step:
   - `npx create-expo-app hourbank` with template
   - Install dependencies listed above
   - Create `.env.local` with the two Supabase keys
   - Run `supabase/migrations/001_initial.sql` in the Supabase SQL editor
   - Create the tutor account manually in Supabase Auth dashboard
   - `npx expo start`
3. **Architecture decisions** — ledger immutability, balance-from-view rule,
   stub notifications.
4. **Phase 2 roadmap** — push notifications, parent web portal, dispute flow,
   PDF statements, Yoco payment integration.

---

## EXECUTION ORDER

Work through this sequence. Do not skip ahead.

1. `npx create-expo-app hourbank --template blank-typescript`
2. Install all dependencies in one `npm install` command.
3. Set up `tailwind.config.js`, `babel.config.js` for NativeWind.
4. Create `supabase/migrations/001_initial.sql`.
5. Create `src/lib/supabase.ts`, `src/theme/fonts.ts`, `src/types/database.ts`,
   all utility files, all stub files.
6. Build auth screen + root layout with auth gate.
7. Build Roster screen + StudentCard + BalanceBadge components.
8. Build Student Detail screen + LedgerRow component.
9. Build Live Session screen + `useActiveSession` hook.
10. Build End Session screen with save logic.
11. Build Top-Up screen with save logic.
12. Write `README.md`.
13. Final pass: check every screen obeys the typography rules (monospaced
    numerals, italic serif emphasis), confirm no `fontWeight: 'bold'` anywhere,
    confirm every balance read is via ledger sum or the `student_balances` view.

---

## FINAL CHECKS (run before declaring done)

- [ ] `npx tsc --noEmit` passes with zero errors.
- [ ] No `fontWeight: 'bold'` anywhere in the codebase — grep for it.
- [ ] No hardcoded colour hex strings outside `tailwind.config.js` and
      `src/utils/balance.ts` — grep for `#`.
- [ ] Every numeric display (balance, price, duration, timer) uses `F.mono`
      or `F.monoMed` — grep for `GeistMono`.
- [ ] `sessions` with status `active` older than the current session are
      flagged on app focus.
- [ ] Zero-balance guard prevents session start.
- [ ] Ledger entries are never mutated — no UPDATE/DELETE calls on that table.
