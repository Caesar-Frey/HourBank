import { getDb } from './client';
import { Student, Session } from './schema';
import { newId } from './uuid';

// ── Shared query helpers ──────────────────────────────────────────────────────

/** Subselect fields shared by listActiveStudents and listPausedStudents. */
const STUDENT_SELECT_FIELDS = `
  s.*,
  COALESCE((
    SELECT SUM(le.hours_delta)
    FROM ledger_entries le
    WHERE le.student_id = s.id
  ), 0) AS current_balance,
  (
    SELECT json_object(
      'id', se.id, 'student_id', se.student_id, 'mode', se.mode,
      'scheduled_for', se.scheduled_for, 'estimated_duration_minutes', se.estimated_duration_minutes,
      'started_at', se.started_at, 'ended_at', se.ended_at, 'paused_seconds', se.paused_seconds,
      'duration_minutes', se.duration_minutes, 'topics', se.topics, 'session_notes', se.session_notes,
      'status', se.status, 'verified_at', se.verified_at, 'created_at', se.created_at
    )
    FROM sessions se
    WHERE se.student_id = s.id
      AND se.status = 'scheduled'
      AND datetime(se.scheduled_for) >= datetime('now')
    ORDER BY se.scheduled_for ASC
    LIMIT 1
  ) AS next_session_json
`;

function mapRows(
  rows: Array<Student & { current_balance: number; next_session_json: string | null }>,
): Array<Student & { current_balance: number; next_session: Session | null }> {
  return rows.map(row => ({
    ...row,
    next_session: row.next_session_json ? JSON.parse(row.next_session_json) as Session : null,
  }));
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function createStudent(data: {
  fullName: string;
  grade: number;
  subject: string;
  curriculum: Student['curriculum'];
  travelFlatFee?: number;
  travelDistanceKm?: number;
  payoutRateOverride?: number | null;
}): Student {
  const db = getDb();
  const id = newId();
  const now = new Date().toISOString();
  const travelFlatFee = data.travelFlatFee ?? 0;
  const travelDistanceKm = data.travelDistanceKm ?? 0;
  const payoutRateOverride = data.payoutRateOverride ?? null;

  db.runSync(
    `INSERT INTO students (id, full_name, grade, subject, curriculum, status, travel_flat_fee, travel_distance_km, payout_rate_override, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    [id, data.fullName, data.grade, data.subject, data.curriculum, travelFlatFee, travelDistanceKm, payoutRateOverride, now]
  );

  return {
    id,
    full_name: data.fullName,
    grade: data.grade,
    subject: data.subject,
    curriculum: data.curriculum,
    status: 'active',
    created_at: now,
    travel_flat_fee: travelFlatFee,
    travel_distance_km: travelDistanceKm,
    payout_rate_override: payoutRateOverride,
  };
}

export function listActiveStudents(): Array<Student & { current_balance: number; next_session: Session | null }> {
  const db = getDb();
  const rows = db.getAllSync<Student & { current_balance: number; next_session_json: string | null }>(`
    SELECT ${STUDENT_SELECT_FIELDS}
    FROM students s
    WHERE s.status = 'active'
    ORDER BY current_balance ASC
  `);
  return mapRows(rows);
}

export function listPausedStudents(): Array<Student & { current_balance: number; next_session: Session | null }> {
  const db = getDb();
  const rows = db.getAllSync<Student & { current_balance: number; next_session_json: string | null }>(`
    SELECT ${STUDENT_SELECT_FIELDS}
    FROM students s
    WHERE s.status = 'paused'
    ORDER BY current_balance ASC
  `);
  return mapRows(rows);
}

export function getStudent(id: string): Student | null {
  const db = getDb();
  return db.getFirstSync<Student>("SELECT * FROM students WHERE id = ? AND status != 'archived'", [id]) ?? null;
}

export function updateStudent(id: string, data: {
  fullName: string;
  grade: number;
  subject: string;
  curriculum: Student['curriculum'];
  travelFlatFee?: number;
  travelDistanceKm?: number;
  payoutRateOverride?: number | null;
}): void {
  const db = getDb();
  // Preserve existing travel/override values when a caller omits them, so editing
  // a student's core fields never silently clobbers dormant payout config.
  const existing = db.getFirstSync<{
    travel_flat_fee: number;
    travel_distance_km: number;
    payout_rate_override: number | null;
  }>('SELECT travel_flat_fee, travel_distance_km, payout_rate_override FROM students WHERE id = ?', [id]);

  const travelFlatFee = data.travelFlatFee ?? existing?.travel_flat_fee ?? 0;
  const travelDistanceKm = data.travelDistanceKm ?? existing?.travel_distance_km ?? 0;
  const payoutRateOverride =
    data.payoutRateOverride !== undefined ? data.payoutRateOverride : existing?.payout_rate_override ?? null;

  db.runSync(
    'UPDATE students SET full_name=?, grade=?, subject=?, curriculum=?, travel_flat_fee=?, travel_distance_km=?, payout_rate_override=? WHERE id=?',
    [data.fullName, data.grade, data.subject, data.curriculum, travelFlatFee, travelDistanceKm, payoutRateOverride, id]
  );
}

export function pauseStudent(id: string): void {
  const db = getDb();
  const result = db.runSync("UPDATE students SET status = 'paused' WHERE id = ? AND status = 'active'", [id]);
  if (result.changes === 0) throw new Error('Student not found or already paused');
}

export function reactivateStudent(id: string): void {
  const db = getDb();
  const result = db.runSync("UPDATE students SET status = 'active' WHERE id = ? AND status = 'paused'", [id]);
  if (result.changes === 0) throw new Error('Student not found or not in paused state');
}

export function archiveStudent(id: string): void {
  const db = getDb();

  // Guard: student must exist and be active or paused (not already archived)
  const student = db.getFirstSync<Student>('SELECT * FROM students WHERE id = ?', [id]);
  if (!student) throw new Error(`Student ${id} not found`);
  if (student.status === 'archived') throw new Error(`Student ${id} is already archived`);

  // Guard: no active or paused sessions
  const activeSession = db.getFirstSync<{ id: string }>(
    "SELECT id FROM sessions WHERE student_id = ? AND status IN ('active', 'paused') LIMIT 1",
    [id]
  );
  if (activeSession) throw new Error(`Student ${id} has an active or paused session — end it before archiving`);

  db.runSync("UPDATE students SET status = 'archived' WHERE id = ?", [id]);
}
