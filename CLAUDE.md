# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**HourBank** — React Native (Expo) app for a single private tutor managing a prepaid-credits tutoring business in South Africa. Parents pay upfront for hour blocks; the tutor logs sessions, deducts hours, and sends receipts.

The full spec lives in `hourbank_claude_code_prompt.md`. Read it before making architectural decisions.

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Expo SDK 52, managed workflow |
| Language | TypeScript strict mode |
| Navigation | Expo Router v4 (file-based, `app/` dir) |
| Styling | NativeWind v4 (Tailwind class names) |
| Backend | Supabase (Postgres + Auth + Storage), JS client v2 |
| Fonts | Expo Google Fonts (`useFonts` hook) |
| Icons | `@expo/vector-icons` Feather set |
| State | `useState`/`useReducer` + Supabase realtime — no Redux/Zustand |

## Commands

```bash
npx expo start          # dev server
npx expo start --android
npx tsc --noEmit        # type-check (must pass with zero errors before any commit)
```

No test runner is configured in MVP. TypeScript is the primary correctness gate.

## Architecture

### Balance is always ledger-derived
Never store or read balance from a `students` column. The source of truth is `sum(ledger_entries.hours_delta)` per student, surfaced via the `student_balances` Supabase view. The `useStudent` and `useStudents` hooks must always query through this view.

### Ledger immutability
`ledger_entries` rows are append-only. Never issue `UPDATE` or `DELETE` against that table — not even in admin flows. Corrections go through an `adjustment` entry (Phase 2). The UI must never expose edit/delete on ledger rows.

### Archive, never delete
Students are soft-deleted: `status = 'archived'`. All queries must filter `status != 'archived'`.

### Session orphan recovery
On app focus, `_layout.tsx` queries for any `sessions` row with `status = 'active'` belonging to this tutor. If found and the timer screen is not active, show a modal to continue or discard.

### Font usage — hard rules
Three font families, each with a strict domain:
- `F.serif` / `F.serifItalic` (Fraunces) — headlines, student names, balance hero numbers, italic emphasis. **Never use `fontWeight: 'bold'`** — use italic Fraunces instead.
- `F.sans` / `F.sansMed` (Geist) — UI labels, body, buttons.
- `F.mono` / `F.monoMed` (GeistMono) — **all** balances, durations, timestamps, prices, timer digits. This is absolute.

Font constants live in `src/theme/fonts.ts` as the `F` object.

### Colour system
Design tokens are in `tailwind.config.js`. No hardcoded hex strings anywhere except `tailwind.config.js` and `src/utils/balance.ts`. Balance status uses three colours only: `moss` (≥3h), `amber` (1–3h), `crimson` (<1h).

### Dark screen exception
The Live Session screen (`app/student/[id]/session.tsx`) inverts to `bg-sessionBg` with `text-paper`. All other screens use `bg-paper` / `text-ink`.

## Key Files

- `src/lib/supabase.ts` — singleton Supabase client with `Database` generic
- `src/theme/fonts.ts` — `F` font constants
- `src/types/database.ts` — TypeScript types matching the Supabase schema
- `src/utils/balance.ts` — `balanceStatus()`, `balanceColour()` helpers
- `src/utils/format.ts` — `formatHours()`, `formatRand()`, `formatDuration()`, `formatLedgerDate()`
- `src/utils/notifications.ts` — **stubs only in MVP**; all functions `console.log` and return
- `supabase/migrations/001_initial.sql` — full schema including RLS policies

## Stubbed for Phase 2

`sendReceipt`, `sendTopUpConfirmation`, `sendLowBalanceAlert` in `src/utils/notifications.ts` are intentional stubs. Do not implement real email/SMS logic until Phase 2.

## Pre-commit Checklist

```bash
npx tsc --noEmit                    # zero errors required
grep -r "fontWeight.*bold" src app  # must return nothing
grep -rE '"#[0-9a-fA-F]' src app   # must return nothing (no inline hex)
grep -r "GeistMono" src app         # every numeric display must appear here
```
