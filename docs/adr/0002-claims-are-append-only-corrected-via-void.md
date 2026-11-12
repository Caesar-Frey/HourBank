---
Status: accepted
---

# 2. Claims are append-only, corrected via Void

A **Claim** is a tutor payout event covering a batch of delivered Lessons. We decided **Claims are append-only and immutable**: once finalised, a Claim's financial content — its Lessons, snapshotted rates, and totals — is never edited or deleted. The only correction path is to **Void** the Claim, which returns its Lessons to the **Claimable pool** and leaves the original Claim on record marked voided, then create a fresh corrected Claim. This mirrors the credit ledger's append-only rule (ledger entries never `UPDATE`/`DELETE`; corrections go through reversing entries).

The tutor explicitly wanted an auditable payout history. Editable Claims would let a recorded payout total change after the fact, destroying the audit trail. Immutability + Void preserves the complete record — Claim #7, its void, and the replacement Claim #8 all stay visible in **Claim history** and downloadable as **Claim reports**.

**Implementation note.** A Void is a one-time `voided_at` timestamp stamp on the Claim row (plus `void_reason`), not a separate reversing row. Both preserve the audit trail; the stamp is simpler and the user-facing behaviour is identical.

## Considered options

- **Editable Claims** (re-open a finalised Claim and change its Lessons/totals) — rejected: a recorded payout total could change after the fact, breaking the audit trail.
- **Undo-latest-only** (allow reverting just the most recent Claim) — rejected: still mutates history and leaves no record that a correction happened; Void records both the original and the replacement.
