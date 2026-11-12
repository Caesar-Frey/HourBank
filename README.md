# HourBank

An offline-first mobile app for a private tutor to run a prepaid-lesson business: parents buy blocks of hours up front, the tutor records lessons against those credits, and the tutor pays themselves out for delivered work with an itemised, auditable claim.

Built with React Native and Expo, with all data stored on the device in SQLite.

## What it does

- **Prepaid credits.** Parents top up hour blocks. Each student's balance is computed from an append-only ledger, never stored, so the audit trail is always the source of truth.
- **Lessons.** Schedule, time and record lessons per subject, with per-subject balances and colour-coded low-balance warnings.
- **Tutor payout claims.** Sweep completed, unclaimed lessons into a claim with lesson fees and a separate travel allowance for in-person lessons. Rates are snapshotted at the time, and mistakes are corrected by voiding, never editing.
- **Reports.** Printable statements and claim reports for parents and for the tutor's own records.

## Tech

- React Native 0.81, Expo SDK 54, Expo Router
- `expo-sqlite` with versioned migrations
- NativeWind (Tailwind) styling
- Jest tests (60+ test files across the data layer, hooks and screens)

## Repository layout

| Path | What's there |
| --- | --- |
| [`hourbank/`](hourbank/) | The Expo app: `app/` routes, `src/` components, database layer, hooks and tests |
| [`docs/adr/`](docs/adr/) | Architecture decision records |
| [`docs/plans/`](docs/plans/) | Feature and remediation plans |
| [`CONTEXT.md`](CONTEXT.md) | Domain glossary (top-ups, credit hours, claims, voids) |
| [`DESIGN_SPEC.md`](DESIGN_SPEC.md) | Screen-by-screen UI and feature reference |
| [`hourbank_mockups.html`](hourbank_mockups.html) | Original design mockups |
| [`scripts/`](scripts/) | Emulator and post-build smoke-test helpers |

## Running it

```bash
cd hourbank
npm install
npx expo start
```

Press `a` to open on an Android device or emulator. No API keys or environment variables are needed.

```bash
npm test
```
