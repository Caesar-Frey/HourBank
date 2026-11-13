# HourBank app

The Expo app for HourBank: a private tutor's prepaid-credits tracker. Parents pay up front for hour blocks, the tutor records lessons against them, and balances update from the ledger.

## Setup

```bash
npm ci --legacy-peer-deps
npx expo start
```

Press `a` to open on a connected Android device or emulator. No environment variables or API keys are needed.

## Checks

```bash
npx tsc --noEmit
npx jest
```

## Architecture

### Data storage
All data lives in a local SQLite database on the device (`expo-sqlite`). Schema changes are versioned, additive migrations in `src/db/migrations.ts`, each with a test. There is no cloud backend and no login. Backups are exported and restored as a `.db` file from Settings.

### Balances
A balance is never stored. Each subject's balance is `SUM(hours_delta)` over `ledger_entries` (view `student_subject_balances`).

### The ledger
Rows are append-only in practice: a trigger blocks DELETE, and the only UPDATE allowed is to a lesson's own deduction when the lesson is edited. Top-ups add `top_up` rows (they can be backdated with "Paid on"), lessons add `session_deduction` rows, and corrections add `adjustment` rows.

### Claims
Completed, unclaimed lessons can be swept into a claim with lesson fees and a travel allowance. A finalised claim is frozen and can only be voided.

### Messages to parents
Receipts, top-up confirmations and reminders are shared through WhatsApp or as PDFs from the device. Nothing is sent from a server.
