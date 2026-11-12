# HourBank

A prepaid-credit tutoring app for a single private tutor in South Africa. Parents pay upfront for hour blocks (credits); the tutor delivers lessons against those credits, and separately pays themselves out of the business account for delivered work. This glossary captures the language of the **tutor payout** side of the domain, which sits next to the existing parent-credit side.

## Language

### Parent-credit side (existing)

**Top-up**:
Money paid *into* the business account by a parent in exchange for credit hours.
_Avoid_: payment, purchase, billing.

**Credit hours**:
The prepaid balance of tutoring time a student holds; the source of truth is the sum of ledger entries, never a stored column.
_Avoid_: balance column.

**Lesson**:
A single delivered tutoring session that has reached `completed` status. The billable unit of work.
_Avoid_: session (when referring to the completed, claimable unit specifically).

### Tutor-payout side (new)

**Claim**:
A tutor payout event — the tutor paying themselves out of the business account for a batch of delivered, not-yet-claimed lessons over a chosen period, plus travel. Money flows *out* of the account. By default a Claim sweeps the entire **Claimable pool**; the tutor may narrow it with an explicit start–end date range and may hold individual lessons back.
_Avoid_: billing cycle (cycles aren't fixed; a Claim simply covers a period), invoice, payout (use **Claim** as the canonical noun).

**Claimable pool**:
The set of `completed` lessons that have not yet been included in any prior **Claim** — i.e. the lessons still available to be paid for. Once a lesson is in a Claim it leaves the pool ("greyed out") and can never be claimed again.

**Void**:
The only way to correct a finalised **Claim**: an append-only reversing record that returns the Claim's lessons to the **Claimable pool** (so their value flows back into **Outstanding payout**). The original Claim is never edited or deleted; the tutor re-claims afresh. Mirrors the credit ledger's append-only correction rule.
_Avoid_: delete, cancel, edit.

**Claim report**:
The itemised statement generated for each **Claim** — lesson-by-lesson hours, **Lesson fees**, **Travel allowance**, and the total — downloadable for audit so the tutor can verify the claim amount.
_Avoid_: receipt (a receipt is the parent-facing top-up/lesson artefact).

**Lesson fee**:
The rand value a single claimed lesson contributes to a **Claim**, computed as billed hours × the tutor's own payout rate. Independent of what the parent paid for the credits consumed. Flat across students for now; per-student rates are a foreseeable future extension.
_Avoid_: revenue, price (price is the parent-facing package figure).

**Travel allowance**:
A separate money line in a **Claim** covering the tutor's fuel/travel for **in-person** lessons only, tracked apart from **Lesson fee** so the tutor knows fuel vs teaching income. Valued per student via a configurable **travel mode**: a flat per-visit fee now, switching to round-trip distance × a per-km rate later. Online lessons are always zero.

**Outstanding payout**:
The total rand value of **completed** lessons sitting in the **Claimable pool** but not yet claimed — i.e. how much the tutor still owes themselves for delivered-but-unpaid work. Derived purely from lessons + rates + travel; the app does **not** track real bank-account cash, because that would require recording every business expense (an accounting tool, out of scope).
_Avoid_: account balance, cash available (the app deliberately does not know these).

## Relationships

- A **Top-up** adds **Credit hours**; a **Lesson** consumes **Credit hours**.
- A **Claim** does NOT touch **Credit hours** — credits are consumed when a **Lesson** completes; claiming is a separate money event.
- A **Claim** covers one or more **Lessons** drawn from the **Claimable pool**.
- A **Claim** total = sum of **Lesson fees** + **Travel allowance**.
- A **Lesson** belongs to at most one **non-voided Claim** (claimed-once invariant).
- **Travel allowance** applies only to **Lessons** whose mode is `in_person`.
- A **Lesson** is eligible for the pool the moment it is `completed`; `scheduled` lessons aren't yet eligible and `cancelled` lessons never are. A completed lesson is claimable even if it drove the student's **Credit hours** negative — the work was delivered.
- A **Claim** **snapshots** its **Lesson fees** and **Travel allowance** at finalisation using the then-current payout rate and travel config; later rate/config changes never alter a past Claim.

## Example dialogue

> **Dev:** "When the tutor runs a **Claim** for May, is the **Lesson fee** based on what the parent paid for those hours?"
> **Tutor:** "No — it's my own rate. What the parent paid for the package is separate; my payout rate is its own number. And in-person lessons add a **Travel allowance** on top, but that's a different line."

## Flagged ambiguities

- "billing cycle" was used for what is actually a tutor **Claim** — resolved: cycles are not fixed; the canonical concept is a Claim over an arbitrary period.
- "claimed" / "paid for" were used interchangeably — resolved: a lesson is **claimed** once it belongs to a non-voided **Claim**; this is the double-count guard.
- **Travel allowance** valuation — resolved: configurable **travel mode**, flat per-visit fee now, round-trip distance × per-km rate later; per student; in-person only.
- Whether a lesson must be parent-**verified** before claimable — resolved: no; `completed` is sufficient. Verification may become an optional filter once that workflow exists.
- How a **Claim** pool is selected — resolved: default is the whole **Claimable pool**, optionally narrowed by an explicit start–end date range, with individual lessons holdable.
- **Lesson fee** basis — resolved: the tutor's **own payout rate**, not what the parent paid; flat across students now, per-student later.
- Tracking real **account cash** (top-ups − claims) — considered and rejected: claims are not the only outflow (rent, equipment, the tutor's own draws, fees), so a truthful cash figure would require recording every expense — an accounting tool, out of scope. The app only ever shows **Outstanding payout** and **Claim history**, both derived from lessons + rates alone.
