import { getDb } from './client';
import type { CalendarEventRow } from './schema';

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
  ended_at: string | null;
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

    const sql = `
      SELECT s.id, s.student_id, st.full_name AS student_name,
             s.status, s.scheduled_for, s.ended_at,
             s.duration_minutes, s.billed_minutes,
             s.session_type, s.mode
      FROM sessions s
      JOIN students st ON s.student_id = st.id
      WHERE s.status IN (${statuses.join(',')})
        AND (
          (s.status IN ('scheduled','cancelled') AND s.scheduled_for >= ? AND s.scheduled_for < ?)
          OR
          (s.status = 'completed' AND s.ended_at >= ? AND s.ended_at < ?)
        )
        ${stClause}
        ${stuClause}
      ORDER BY COALESCE(s.scheduled_for, s.ended_at) ASC
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
          durationMin: row.billed_minutes ?? row.duration_minutes ?? 0,
          sessionType: row.session_type,
          mode: row.mode,
        });
      } else if (row.status === 'completed' && row.ended_at) {
        events.push({
          kind: 'session_completed',
          id: row.id,
          studentId: row.student_id,
          studentName: row.student_name,
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
        AND le.created_at >= ? AND le.created_at < ?
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
  const ceKinds = (['event', 'time_block'] as const).filter(k => filters.eventKinds.has(k));
  if (ceKinds.length > 0) {
    const kindPlaceholders = ceKinds.map(() => '?').join(',');
    const studentFilter = filters.studentIds
      ? `AND (ce.student_id IN (${filters.studentIds.map(() => '?').join(',')}) OR ce.student_id IS NULL)`
      : '';
    const params: (string | number)[] = [
      startISO, endISO,
      ...ceKinds,
      ...(filters.studentIds ?? []),
    ];
    const ceRows = db.getAllSync<CalendarEventRow & { student_name?: string }>(
      `SELECT ce.*, s.full_name as student_name
       FROM calendar_events ce
       LEFT JOIN students s ON s.id = ce.student_id
       WHERE ce.starts_at >= ? AND ce.starts_at < ?
         AND ce.kind IN (${kindPlaceholders})
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
    const timeA = eventTime(a);
    const timeB = eventTime(b);
    return timeA < timeB ? -1 : timeA > timeB ? 1 : 0;
  });

  return events;
}

export function eventTime(e: CalendarEvent): string {
  switch (e.kind) {
    case 'session_scheduled': return e.scheduledFor;
    case 'session_completed': return e.endedAt;
    case 'session_cancelled': return e.scheduledFor;
    case 'top_up':            return e.createdAt;
    case 'event':             return e.startsAt;
    case 'time_block':        return e.startsAt;
  }
}

export function findOverlappingCalendarItems(startsAt: string, endsAt: string): {
  sessions: Array<{ id: string; studentName: string; scheduledFor: string }>;
  calendarItems: Array<{ id: string; title: string; kind: 'event' | 'time_block'; startsAt: string }>;
} {
  const db = getDb();

  const sessionRows = db.getAllSync<{ id: string; student_name: string; scheduled_for: string }>(
    `SELECT s.id, st.full_name as student_name, s.scheduled_for
     FROM sessions s
     LEFT JOIN students st ON st.id = s.student_id
     WHERE s.status = 'scheduled'
       AND s.scheduled_for < ?
       AND datetime(s.scheduled_for, '+' || CAST(s.estimated_duration_minutes AS TEXT) || ' minutes') > ?`,
    [endsAt, startsAt]
  );

  const ceRows = db.getAllSync<{ id: string; title: string; kind: string; starts_at: string }>(
    `SELECT id, title, kind, starts_at FROM calendar_events
     WHERE starts_at < ? AND (ends_at IS NULL OR ends_at > ?)`,
    [endsAt, startsAt]
  );

  return {
    sessions: sessionRows.map(r => ({ id: r.id, studentName: r.student_name, scheduledFor: r.scheduled_for })),
    calendarItems: ceRows.map(r => ({ id: r.id, title: r.title, kind: r.kind as 'event' | 'time_block', startsAt: r.starts_at })),
  };
}
