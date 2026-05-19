# HourBank — Future Enhancements

Approved features deferred from current build. Pick up in future sessions.

## Calendar

- Recurring events and blocks (e.g. "unavailable every Tuesday 5-7pm").
- Drag-to-reschedule and resize sessions/events on the calendar.
- Per-event custom colors and emoji.
- Color/legend customization per event kind.
- Better empty-state illustrations and onboarding tour.
- Async `listEventsInRange` + virtualization for very large datasets.
- Tokenize hardcoded RGBA overlay colors in CalendarFilterSheet and FAB picker.

## Scheduling

- Hard conflict blocking (per-block toggle: "prevent scheduling during this window").
- Push notifications / reminders before events and sessions.
- Multi-day events with proper rendering across day cells in month/week view.
- Attendees and multiple students per event (study groups).

## Data

- `tutor_id` scoping across all queries for multi-tutor support.
- Generated TypeScript types from SQLite schema (instead of hand-maintained).
- Migration runner: structured error reporting + applied-at telemetry.

## Reports / analytics

- Filter Reports screen by session_type and calendar event category.
- Export session + financial data to CSV.

---
*Updated by build: 2026-05-17*
