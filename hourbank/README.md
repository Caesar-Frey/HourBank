# HourBank

A React Native (Expo) app for a private tutor to manage prepaid tutoring credits. Parents pay upfront for hour blocks, the tutor logs sessions, and balances update automatically.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the dev server:
   ```bash
   npx expo start
   ```

3. Run on Android:
   - Press `a` in the Expo dev server to open on a connected device or emulator
   - Or scan the QR code with the Expo Go app

No environment variables or API keys are needed. All data is stored locally in SQLite on the device.

## Architecture

### Data storage
All data persists in a local SQLite database (`hourbank.db`) using `expo-sqlite`. No cloud backend or authentication is required for MVP.

### Balance calculation
Student balances are never stored as a column. They are always computed as `SUM(hours_delta)` from the `ledger_entries` table. This makes the ledger the single source of truth and ensures the audit trail is always correct.

### Ledger immutability
`ledger_entries` rows are append-only. No UPDATE or DELETE is ever issued against this table. Credits are added via `top_up` entries; sessions are deducted via `session_deduction` entries. Corrections go through `adjustment` entries (Phase 2).

### Session verification
After a session ends, it enters `pending_verification` status. After a configurable window (default: 24 hours, set via `VERIFICATION_WINDOW_HOURS` in `src/config.ts`), it is automatically verified on the next app launch or when the app returns to the foreground.

### Notifications
Email and SMS sending is stubbed in `src/utils/notifications.ts`. All functions log to console in MVP. Real sending via Resend API is a Phase 2 feature.

## Phase 2 Roadmap

- Supabase cloud sync + authentication
- Parent-facing web portal / dispute flow
- Email receipts via Resend API
- PDF statements
- Push notifications for low balance alerts
- Yoco payment integration
- Reports and analytics
