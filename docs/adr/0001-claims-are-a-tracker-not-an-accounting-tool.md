---
Status: accepted
---

# 1. Claims are a tracker, not an accounting tool

The Claim feature lets the single tutor pay themselves out of the business account for delivered Lessons. We decided it is a **claim tracker, not an accounting tool**. Two linked choices follow.

**Payout rate is decoupled from parent revenue.** A claimed Lesson's **Lesson fee** = billed hours × the tutor's *own* payout rate (the existing `tutor_profile.hourly_rate`), not what the parent paid in Top-ups for the credits consumed. Flat across students now; a nullable `students.payout_rate_override` ships now (unused) so per-student rates need no later migration.

**The app does not track real Account cash.** It only surfaces **Outstanding payout** (value of completed-but-unclaimed Lessons) and Claim history. Both are pure live derivations from Lessons + rates + travel, so they cannot drift from a stored figure.

## Considered options

- **Show "cash available = total Top-ups − total Claims" with an over-claim warning.** Rejected: Claims are not the only cash outflow (rent, equipment, the tutor's own draws, bank fees). A truthful cash figure would require recording every business expense — i.e. building a full accounting tool, which is out of scope.
- **Base the Lesson fee on parent revenue (what was paid for the credits consumed).** Rejected: the tutor's payout rate is its own number, independent of package pricing; coupling them conflates two unrelated money sides.

## Consequences

The app never claims to know the bank balance — a future dev tempted to add an Account-cash figure must first commit to full expense tracking.
