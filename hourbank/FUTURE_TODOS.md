# HourBank — Future Enhancements

Approved features deferred from current build. Pick up in future sessions.

## Calendar

- Recurring events and blocks (e.g. "unavailable every Tuesday 5-7pm").
- Drag-to-reschedule and resize sessions/events on the calendar.
- Per-event custom colors and emoji.
- Color/legend customization per event kind.
- Better empty-state illustrations and onboarding tour.
- Async `listEventsInRange` + virtualization for very large datasets.

## Scheduling

- Hard conflict blocking (per-block toggle: "prevent scheduling during this window").
- Push notifications / reminders before events and sessions.
- Multi-day events with proper rendering across day cells in month/week view.
- Attendees and multiple students per event (study groups).

## Recurring lessons

- Recurring weekly lessons: "repeat every week" until a date or for N weeks, skip (and list) clashes with existing lessons/blocks, and edit "this lesson" vs "this and following".

## Home / Settings

- Home Today card: also show lessons already completed today (needs a "completed today" agenda bucket).
- Restore preview: list student names in the backup summary, not just counts.
- Automatic scheduled backups (e.g. weekly to a chosen cloud folder) instead of manual "Back up now".

## Data

- `tutor_id` scoping across all queries for multi-tutor support.
- Generated TypeScript types from SQLite schema (instead of hand-maintained).
- Migration runner: structured error reporting + applied-at telemetry.

## Reports / analytics

- Filter Reports screen by session_type and calendar event category.
- Export session + financial data to CSV.

## Billing / documents

- Charge an item to credit (F1) and invoice template + settings (F2): specified in docs/plans/2026-11-12-polish-handoff.md, waiting for mockups M7, M8 and M9 to be approved.

---
*Updated by build: 2026-11-13 (polish packages A to E)*
