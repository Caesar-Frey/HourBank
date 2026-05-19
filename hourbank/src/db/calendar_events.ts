import { getDb } from './client';
import { newId } from './uuid';
import type { CalendarEventRow } from './schema';

type NewCalendarEvent = Omit<CalendarEventRow, 'id' | 'created_at' | 'updated_at'>;

export function createCalendarEvent(data: NewCalendarEvent): CalendarEventRow {
  const db = getDb();
  const id = newId();
  const now = new Date().toISOString();

  db.runSync(
    `INSERT INTO calendar_events
       (id, kind, student_id, starts_at, ends_at, all_day, title, category, notes, tutor_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.kind,
      data.student_id,
      data.starts_at,
      data.ends_at,
      data.all_day,
      data.title,
      data.category,
      data.notes,
      data.tutor_id,
      now,
      now,
    ]
  );

  return {
    id,
    kind: data.kind,
    student_id: data.student_id,
    starts_at: data.starts_at,
    ends_at: data.ends_at,
    all_day: data.all_day,
    title: data.title,
    category: data.category,
    notes: data.notes,
    tutor_id: data.tutor_id,
    created_at: now,
    updated_at: now,
  };
}

export function updateCalendarEvent(
  id: string,
  data: Partial<Omit<CalendarEventRow, 'id' | 'created_at'>>
): void {
  const db = getDb();
  const now = new Date().toISOString();

  const fields: string[] = [];
  const params: (string | number | null)[] = [];

  if (data.kind !== undefined) { fields.push('kind = ?'); params.push(data.kind); }
  if (data.student_id !== undefined) { fields.push('student_id = ?'); params.push(data.student_id); }
  if (data.starts_at !== undefined) { fields.push('starts_at = ?'); params.push(data.starts_at); }
  if (data.ends_at !== undefined) { fields.push('ends_at = ?'); params.push(data.ends_at); }
  if (data.all_day !== undefined) { fields.push('all_day = ?'); params.push(data.all_day); }
  if (data.title !== undefined) { fields.push('title = ?'); params.push(data.title); }
  if (data.category !== undefined) { fields.push('category = ?'); params.push(data.category); }
  if (data.notes !== undefined) { fields.push('notes = ?'); params.push(data.notes); }
  if (data.tutor_id !== undefined) { fields.push('tutor_id = ?'); params.push(data.tutor_id); }

  fields.push('updated_at = ?');
  params.push(now);
  params.push(id);

  if (fields.length === 1) return; // only updated_at — nothing to do

  db.runSync(
    `UPDATE calendar_events SET ${fields.join(', ')} WHERE id = ?`,
    params
  );
}

export function deleteCalendarEvent(id: string): void {
  getDb().runSync(`DELETE FROM calendar_events WHERE id = ?`, [id]);
}

export function getCalendarEventById(
  id: string
): (CalendarEventRow & { student_name?: string }) | null {
  const db = getDb();
  return (
    db.getFirstSync<CalendarEventRow & { student_name?: string }>(
      `SELECT ce.*, s.full_name as student_name
       FROM calendar_events ce
       LEFT JOIN students s ON s.id = ce.student_id
       WHERE ce.id = ?`,
      [id]
    ) ?? null
  );
}
