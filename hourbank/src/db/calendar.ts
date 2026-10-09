import { getDb } from './client';
import type { CalendarEventRow } from './schema';

/** SQL: ISO-8601 text → integer epoch seconds. */
const epoch = (expr: string) => `CAST(strftime('%s', ${expr}) AS INTEGER)`;

/** Assumed length of a scheduled lesson with no estimated duration. */
export const DEFAULT_LESSON_MINUTES = 60;

// ─── Types ───────────────────────────────────────────────────────────────────

export type CalendarEvent =
  | {
      kind: 'session_scheduled';
      id: string;
      studentId: string;
      studentName: string;
      scheduledFor: string;
      durationMin: number;
      sessionType: string;
      mode: string;
    }
  | {
      kind: 'session_completed';
      id: string;
      studentId: string;
      studentName: string;
      /** Placement time: when the lesson started (falls back to ended_at for legacy rows). */
      startedAt: string;
      endedAt: string;
      durationMin: number;
      sessionType: string;
      mode: string;
    }
  | {
      kind: 'session_cancelled';
      id: string;
      studentId: string;
      studentName: string;
      scheduledFor: string;
      sessionType: string;
    }
  | {
      kind: 'top_up';
      ledgerEntryId: string;
      studentId: string;
      studentName: string;
      createdAt: string;
      hours: number;
      paymentMethod?: string;
    }
  | {
      kind: 'event';
      id: string;
      studentId?: string;
      studentName?: string;
      startsAt: string;
      endsAt?: string;
      allDay: boolean;
      title: string;
      category?: 'test' | 'exam' | 'homework' | 'other';
      notes?: string;
    }
  | {
      kind: 'time_block';
      id: string;
      startsAt: string;
      endsAt: string;
      allDay: boolean;
      title: string;
      notes?: string;
    };

export type EventKind = 'scheduled' | 'completed' | 'cancelled' | 'top_up' | 'event' | 'time_block';
export type SessionTypeFilter = 'general' | 'review' | 'test_prep' | 'exam_prep';

export interface CalendarFilters {
  studentIds: string[] | null; // null = all students
  eventKinds: Set<EventKind>;
  sessionTypes: Set<SessionTypeFilter>;
}

export function defaultFilters(): CalendarFilters {
  return {
    studentIds: null,
    eventKinds: new Set(['scheduled', 'completed', 'cancelled', 'top_up', 'event', 'time_block']),
    sessionTypes: new Set(['general', 'review', 'test_prep', 'exam_prep']),
  };
}

// ─── Query ───────────────────────────────────────────────────────────────────

type RawSession = {
  id: string;
  student_id: string;
  student_name: string;
  status: string;
  scheduled_for: string | null;
  started_at: string | null;
  ended_at: string | null;
  estimated_duration_minutes: number | null;
  duration_minutes: number | null;
  billed_minutes: number | null;
  session_type: string;
  mode: string;
};

type RawTopUp = {
  ledger_entry_id: string;
  student_id: string;
  student_name: string;
  created_at: string;
  hours_delta: number;
  payment_method: string | null;
};

export function listEventsInRange(
  startISO: string,
  endISO: string,
  filters: CalendarFilters,
): CalendarEvent[] {
  const db = getDb();

  const events: CalendarEvent[] = [];

  // ── Sessions ──────────────────────────────────────────────────────────────
  const wantScheduled = filters.eventKinds.has('scheduled');
  const wantCompleted = filters.eventKinds.has('completed');
  const wantCancelled = filters.eventKinds.has('cancelled');

  if (wantScheduled || wantCompleted || wantCancelled) {
    // Build status IN clause
    const statuses: string[] = [];
    if (wantScheduled) statuses.push("'scheduled'");
    if (wantCompleted) statuses.push("'completed'");
    if (wantCancelled) statuses.push("'cancelled'");

    // Build session_type IN clause
    const stArr = Array.from(filters.sessionTypes);
    const stClause =
      stArr.length === 4
        ? '' // all types — no filter needed
        : stArr.length === 0
          ? 'AND 1=0'
          : `AND s.session_type IN (${stArr.map(() => '?').join(',')})`;

    // Build student filter
    const stuClause =
      filters.studentIds && filters.studentIds.length > 0
        ? `AND s.student_id IN (${filters.studentIds.map(() => '?').join(',')})`
        : '';

    // Completed lessons are placed at started_at (legacy rows: ended_at).
    const sql = `
      SELECT s.id, s.student_id, st.full_name AS student_name,
             s.status, s.scheduled_for, s.started_at, s.ended_at,
             s.estimated_duration_minutes, s.duration_minutes, s.billed_minutes,
             s.session_type, s.mode
      FROM sessions s
      JOIN students st ON s.student_id = st.id
      WHERE s.status IN (${statuses.join(',')})
        AND st.status != 'archived'
        AND (
          (s.status IN ('scheduled','cancelled')
            AND julianday(s.scheduled_for) >= julianday(?) AND julianday(s.scheduled_for) < julianday(?))
          OR
          (s.status = 'completed'
            AND julianday(COALESCE(s.started_at, s.ended_at)) >= julianday(?)
            AND julianday(COALESCE(s.started_at, s.ended_at)) < julianday(?))
        )
        ${stClause}
        ${stuClause}
      ORDER BY COALESCE(s.scheduled_for, s.started_at, s.ended_at) ASC
    `;

    const params: (string | number)[] = [
      startISO, endISO,
      startISO, endISO,
      ...(stArr.length > 0 && stArr.length < 4 ? stArr : []),
      ...(filters.studentIds ?? []),
    ];

    const rows = db.getAllSync<RawSession>(sql, params);

    for (const row of rows) {
      if (row.status === 'scheduled' && row.scheduled_for) {
        events.push({
          kind: 'session_scheduled',
          id: row.id,
          studentId: row.student_id,
          studentName: row.student_name,
          scheduledFor: row.scheduled_for,
          durationMin: row.estimated_duration_minutes ?? DEFAULT_LESSON_MINUTES,
          sessionType: row.session_type,
          mode: row.mode,
        });
      } else if (row.status === 'completed' && row.ended_at) {
        events.push({
          kind: 'session_completed',
          id: row.id,
          studentId: row.student_id,
          studentName: row.student_name,
          startedAt: row.started_at ?? row.ended_at,
          endedAt: row.ended_at,
          durationMin: row.billed_minutes ?? row.duration_minutes ?? 0,
          sessionType: row.session_type,
          mode: row.mode,
        });
      } else if (row.status === 'cancelled' && row.scheduled_for) {
        events.push({
          kind: 'session_cancelled',
          id: row.id,
          studentId: row.student_id,
          studentName: row.student_name,
          scheduledFor: row.scheduled_for,
          sessionType: row.session_type,
        });
      }
    }
  }

  // ── Top-ups ───────────────────────────────────────────────────────────────
  if (filters.eventKinds.has('top_up')) {
    const stuClause =
      filters.studentIds && filters.studentIds.length > 0
        ? `AND le.student_id IN (${filters.studentIds.map(() => '?').join(',')})`
        : '';

    const sql = `
      SELECT le.id AS ledger_entry_id, le.student_id, st.full_name AS student_name,
             le.created_at, le.hours_delta,
             cp.payment_method
      FROM ledger_entries le
      JOIN students st ON le.student_id = st.id
      LEFT JOIN credit_packages cp ON le.related_package_id = cp.id
      WHERE le.type = 'top_up'
        AND st.status != 'archived'
        AND julianday(le.created_at) >= julianday(?) AND julianday(le.created_at) < julianday(?)
        ${stuClause}
      ORDER BY le.created_at ASC
    `;

    const params: (string | number)[] = [
      startISO, endISO,
      ...(filters.studentIds ?? []),
    ];

    const rows = db.getAllSync<RawTopUp>(sql, params);

    for (const row of rows) {
      events.push({
        kind: 'top_up',
        ledgerEntryId: row.ledger_entry_id,
        studentId: row.student_id,
        studentName: row.student_name,
        createdAt: row.created_at,
        hours: row.hours_delta,
        paymentMethod: row.payment_method ?? undefined,
      });
    }
  }

  // ── Calendar events + time blocks ────────────────────────────────────────
  // Range-overlap (not start-in-range) so multi-day events appear on every day
  // they span. Point events (no end) match when their start is in range.
  const ceKinds = (['event', 'time_block'] as const).filter(k => filters.eventKinds.has(k));
  if (ceKinds.length > 0) {
    const kindPlaceholders = ceKinds.map(() => '?').join(',');
    const studentFilter = filters.studentIds
      ? `AND (ce.student_id IN (${filters.studentIds.map(() => '?').join(',')}) OR ce.student_id IS NULL)`
      : '';
    const params: (string | number)[] = [
      endISO, startISO, startISO,
      ...ceKinds,
      ...(filters.studentIds ?? []),
    ];
    const ceRows = db.getAllSync<CalendarEventRow & { student_name?: string }>(
      `SELECT ce.*, s.full_name as student_name
       FROM calendar_events ce
       LEFT JOIN students s ON s.id = ce.student_id
       WHERE julianday(ce.starts_at) < julianday(?)
         AND (
           julianday(COALESCE(ce.ends_at, ce.starts_at)) > julianday(?)
           OR julianday(ce.starts_at) >= julianday(?)
         )
         AND ce.kind IN (${kindPlaceholders})
         AND (ce.student_id IS NULL OR s.status IS NULL OR s.status != 'archived')
         ${studentFilter}`,
      params
    );
    for (const r of ceRows) {
      if (r.kind === 'event') {
        events.push({ kind: 'event', id: r.id,
          studentId: r.student_id ?? undefined,
          studentName: r.student_name ?? undefined,
          startsAt: r.starts_at, endsAt: r.ends_at ?? undefined, allDay: r.all_day === 1,
          title: r.title, category: r.category ?? undefined, notes: r.notes ?? undefined });
      } else {
        events.push({ kind: 'time_block', id: r.id,
          startsAt: r.starts_at, endsAt: r.ends_at ?? r.starts_at, allDay: r.all_day === 1,
          title: r.title, notes: r.notes ?? undefined });
      }
    }
  }

  // Sort combined by event time ascending
  events.sort((a, b) => {
    const timeA = Date.parse(eventTime(a));
    const timeB = Date.parse(eventTime(b));
    return timeA - timeB;
  });

  return events;
}

/** Placement (start) time of an item. Completed lessons sit at their start. */
export function eventTime(e: CalendarEvent): string {
  switch (e.kind) {
    case 'session_scheduled': return e.scheduledFor;
    case 'session_completed': return e.startedAt;
    case 'session_cancelled': return e.scheduledFor;
    case 'top_up':            return e.createdAt;
    case 'event':             return e.startsAt;
    case 'time_block':        return e.startsAt;
  }
}

/** End time of an item (start + duration for lessons; start for point items). */
export function eventEndTime(e: CalendarEvent): string {
  switch (e.kind) {
    case 'session_scheduled':
      return new Date(Date.parse(e.scheduledFor) + e.durationMin * 60_000).toISOString();
    case 'session_completed': return e.endedAt;
    case 'session_cancelled': return e.scheduledFor;
    case 'top_up':            return e.createdAt;
    case 'event':             return e.endsAt ?? e.startsAt;
    case 'time_block':        return e.endsAt;
  }
}

/**
 * True when the item touches the LOCAL calendar day containing `day`. Use this
 * (not the start day) to place multi-day events on every day they span.
 */
export function eventOverlapsDay(e: CalendarEvent, day: Date): boolean {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  const start = Date.parse(eventTime(e));
  const end = Date.parse(eventEndTime(e));
  if (end <= start) return start >= dayStart && start < dayEnd;
  return start < dayEnd && end > dayStart;
}

/**
 * Busy-time conflicts for a proposed [startsAt, endsAt) slot.
 * - Scheduled lessons of non-archived students; null length = 60 min.
 * - Only time blocks count as busy (events such as exams are informational).
 *   A block without an end is a point in time; an all-day block without an end
 *   covers its whole day.
 * All comparisons use integer epoch seconds (strftime('%s')) on both sides, so
 * stored ISO strings and duration arithmetic compare exactly — never string vs
 * datetime() output, which silently never matched.
 */
export function findOverlappingCalendarItems(
  startsAt: string,
  endsAt: string,
  opts: { excludeSessionId?: string } = {},
): {
  sessions: Array<{ id: string; studentName: string; scheduledFor: string }>;
  calendarItems: Array<{ id: string; title: string; kind: 'event' | 'time_block'; startsAt: string }>;
} {
  const db = getDb();

  const sessionRows = db.getAllSync<{ id: string; student_name: string; scheduled_for: string }>(
    `SELECT s.id, st.full_name as student_name, s.scheduled_for
     FROM sessions s
     JOIN students st ON st.id = s.student_id
     WHERE s.status = 'scheduled'
       AND st.status != 'archived'
       AND s.id != ?
       AND ${epoch('s.scheduled_for')} < ${epoch('?')}
       AND ${epoch('s.scheduled_for')} + CAST(ROUND(COALESCE(s.estimated_duration_minutes, ${DEFAULT_LESSON_MINUTES}) * 60) AS INTEGER) > ${epoch('?')}
     ORDER BY s.scheduled_for ASC`,
    [opts.excludeSessionId ?? '', endsAt, startsAt]
  );

  const ceRows = db.getAllSync<{ id: string; title: string; kind: string; starts_at: string }>(
    `SELECT id, title, kind, starts_at FROM calendar_events
     WHERE kind = 'time_block'
       AND ${epoch('starts_at')} < ${epoch('?')}
       AND CASE
             WHEN ends_at IS NOT NULL THEN ${epoch('ends_at')}
             WHEN all_day = 1 THEN ${epoch('starts_at')} + 86400
             ELSE ${epoch('starts_at')}
           END > ${epoch('?')}
     ORDER BY starts_at ASC`,
    [endsAt, startsAt]
  );

  return {
    sessions: sessionRows.map(r => ({ id: r.id, studentName: r.student_name, scheduledFor: r.scheduled_for })),
    calendarItems: ceRows.map(r => ({ id: r.id, title: r.title, kind: r.kind as 'event' | 'time_block', startsAt: r.starts_at })),
  };
}

