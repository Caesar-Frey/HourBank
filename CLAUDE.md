# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

**HourBank** is an offline-first React Native (Expo) app for a single private tutor running a prepaid-credits tutoring business in South Africa. Parents pay up front for blocks of hours (top-ups), the tutor records lessons against those credits, and the tutor pays themselves out with itemised claims.

The app lives in `hourbank/`. The domain glossary in `CONTEXT.md` is canonical. `DESIGN_SPEC.md` is the screen reference. `docs/history/` holds the original brief, which is superseded.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Expo SDK 54, React Native 0.81, React 19 |
| Language | TypeScript, strict mode |
| Navigation | expo-router 6 (file-based, `hourbank/app/`) |
| Data | Local SQLite via `expo-sqlite` (`src/db/*`), versioned migrations. No backend, no auth. |
| Styling | Inline styles with `COLORS` (`src/theme/colors.ts`) and `F` (`src/theme/fonts.ts`). No `className`. |
| Icons | `@expo/vector-icons` Feather |
| Tests | Jest (`jest-expo`), TZ pinned by `jest.globalSetup.js` |

## Commands (run in `hourbank/`)

```bash
npm ci --legacy-peer-deps
npx expo start
npx tsc --noEmit        # must be clean before any commit
npx jest                # must be green before any commit
```

CI runs both on every push (`.github/workflows/ci.yml`).

## Architecture rules

- **Balance is ledger-derived.** A balance is `SUM(ledger_entries.hours_delta)` per subject (view `student_subject_balances`). Never store or read a balance column. Snap sums with `normaliseHours` at every read boundary.
- **Ledger.** DELETE is blocked by a trigger. UPDATE is allowed only on a `session_deduction` row's `hours_delta`/`subject_id` through `editLesson`. Do not widen that. Corrections otherwise go through `adjustment` rows. The running balance is ordered by `(created_at, rowid)` because top-ups can be backdated.
- **Claims.** A lesson can be claimed once. A finalised claim is frozen (rates and travel are snapshotted on its lines) and can only be voided. A lesson in a claim stays editable with a nudge, never a block.
- **Archive, never delete.** Students are archived (`status = 'archived'`). Live lists filter them out; read-only views use `getStudent(id, { includeArchived: true })`.
- **Nudge, never hard-block** the tutor, except where data would become wrong.
- **Migrations.** The app is in real use with real data. Every schema change is a new, additive, transactional, idempotent migration in `src/db/migrations.ts`, with a test. Never edit an existing migration.
- **Glossary in UI copy:** Claim, Top-up, Lesson, Void. Do not use "payout", "session" or "invoice" in UI text.

## Design rules

- **Fonts.** `F.serif` / `F.serifItalic` (Fraunces) for headlines, names and hero numbers. Never bold: use italic for emphasis. `F.sans` / `F.sansMed` (Geist) for UI text and buttons. `F.mono` / `F.monoMed` (GeistMono) for every balance, duration, timestamp and price, including numbers inside sentences (use `<Mixed>` / `<Num>` from `src/components/Num.tsx`).
- **Colours.** No hex or rgba literals outside `src/theme/colors.ts`, `tailwind.config.js` and `src/utils/balance.ts`. Balance states: ok (moss, 3h or more), warn (amber, 1 to 3h), low (crimson, under 1h), owes (oxblood). Use `amberText` for amber text and numbers; `amber` is for fills, borders and icons.
- **Primary action** is an oxblood fill with a Geist medium label. Minimum text size 12, minimum touch target 44 (`MIN_TOUCH`). Screen gutters are 24.
- **Dark screen exception:** the live timer screen (`app/student/[id]/session.tsx`) uses `sessionBg` with paper text.

## Never commit

- `android/app/*.keystore` or `android/keystore.properties`.
- Any business or personal details: names, phone numbers, bank details, logos or real amounts. The repo is public.

## Pre-commit checks

```bash
npx tsc --noEmit
npx jest
grep -rn "fontWeight.*bold" src app                                   # must return nothing
grep -rnE "['\"]#[0-9a-fA-F]|rgba\(" src app | grep -v -e src/theme/colors.ts -e src/utils/balance.ts   # must return nothing
```
