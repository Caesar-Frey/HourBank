import { getDb } from './client';
import { Student, Session, LedgerEntry, PreferredContact } from './schema';
import { appendEntry } from './ledger';
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
  parentName?: string | null;
  parentPhone?: string | null;
  studentPhone?: string | null;
  preferredContact?: PreferredContact;
}): Student {
  const db = getDb();
  const id = newId();
  const now = new Date().toISOString();
  const travelFlatFee = data.travelFlatFee ?? 0;
  const travelDistanceKm = data.travelDistanceKm ?? 0;
  const payoutRateOverride = data.payoutRateOverride ?? null;
  const parentName = blankToNull(data.parentName);
  const parentPhone = blankToNull(data.parentPhone);
  const studentPhone = blankToNull(data.studentPhone);
  const preferredContact: PreferredContact = data.preferredContact === 'student' ? 'student' : 'parent';

  db.runSync(
    `INSERT INTO students (id, full_name, grade, subject, curriculum, status, travel_flat_fee, travel_distance_km, payout_rate_override, parent_name, parent_phone, student_phone, preferred_contact, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.fullName, data.grade, data.subject, data.curriculum, travelFlatFee, travelDistanceKm, payoutRateOverride, parentName, parentPhone, studentPhone, preferredContact, now]
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
    parent_name: parentName,
    parent_phone: parentPhone,
    student_phone: studentPhone,
    preferred_contact: preferredContact,
  };
}

function blankToNull(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
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
  /** undefined = keep existing; null/'' = clear. */
  parentName?: string | null;
  /** undefined = keep existing; null/'' = clear. */
  parentPhone?: string | null;
  /** undefined = keep existing; null/'' = clear. */
  studentPhone?: string | null;
  /** undefined = keep existing. */
  preferredContact?: PreferredContact;
}): void {
  const db = getDb();
  // Preserve existing travel/override/parent values when a caller omits them, so editing
  // a student's core fields never silently clobbers other config.
  const existing = db.getFirstSync<{
    travel_flat_fee: number;
    travel_distance_km: number;
    payout_rate_override: number | null;
    parent_name: string | null;
    parent_phone: string | null;
    student_phone: string | null;
    preferred_contact: PreferredContact | null;
  }>('SELECT travel_flat_fee, travel_distance_km, payout_rate_override, parent_name, parent_phone, student_phone, preferred_contact FROM students WHERE id = ?', [id]);

  const travelFlatFee = data.travelFlatFee ?? existing?.travel_flat_fee ?? 0;
  const travelDistanceKm = data.travelDistanceKm ?? existing?.travel_distance_km ?? 0;
  const payoutRateOverride =
    data.payoutRateOverride !== undefined ? data.payoutRateOverride : existing?.payout_rate_override ?? null;
  const parentName = data.parentName !== undefined ? blankToNull(data.parentName) : existing?.parent_name ?? null;
  const parentPhone = data.parentPhone !== undefined ? blankToNull(data.parentPhone) : existing?.parent_phone ?? null;

  const studentPhone = data.studentPhone !== undefined ? blankToNull(data.studentPhone) : existing?.student_phone ?? null;
  const preferredContact: PreferredContact =
    (data.preferredContact ?? existing?.preferred_contact) === 'student' ? 'student' : 'parent';

  db.runSync(
    'UPDATE students SET full_name=?, grade=?, subject=?, curriculum=?, travel_flat_fee=?, travel_distance_km=?, payout_rate_override=?, parent_name=?, parent_phone=?, student_phone=?, preferred_contact=? WHERE id=?',
    [data.fullName, data.grade, data.subject, data.curriculum, travelFlatFee, travelDistanceKm, payoutRateOverride, parentName, parentPhone, studentPhone, preferredContact, id]
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

/**
 * Soft-delete a student. Also cancels every still-scheduled lesson for them
 * (cancel_reason 'student_archived') in the same transaction.
 * Returns how many lessons were cancelled so the UI can confirm it.
 */
export function archiveStudent(id: string): { cancelledLessons: number } {
  const db = getDb();
  let cancelledLessons = 0;

  db.withTransactionSync(() => {
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

    cancelledLessons = db.runSync(
      "UPDATE sessions SET status = 'cancelled', cancel_reason = 'student_archived' WHERE student_id = ? AND status = 'scheduled'",
      [id]
    ).changes;

    db.runSync("UPDATE students SET status = 'archived' WHERE id = ?", [id]);
  });

  return { cancelledLessons };
}

/** Number of scheduled lessons that archiving would cancel (for the confirm dialog). */
export function countScheduledLessons(studentId: string): number {
  const row = getDb().getFirstSync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sessions WHERE student_id = ? AND status = 'scheduled'",
    [studentId]
  );
  return row?.n ?? 0;
}

export function listArchivedStudents(): Array<Student & { current_balance: number }> {
  return getDb().getAllSync<Student & { current_balance: number }>(`
    SELECT s.*,
      COALESCE((SELECT SUM(le.hours_delta) FROM ledger_entries le WHERE le.student_id = s.id), 0) AS current_balance
    FROM students s
    WHERE s.status = 'archived'
    ORDER BY s.full_name COLLATE NOCASE ASC
  `);
}

/** Un-archive: archived → active. Lessons cancelled by the archive are NOT restored. */
export function restoreStudent(id: string): void {
  const result = getDb().runSync(
    "UPDATE students SET status = 'active' WHERE id = ? AND status = 'archived'",
    [id]
  );
  if (result.changes === 0) throw new Error('Student not found or not archived');
}

/**
 * Append a balance correction to the ledger (append-only — never edits rows).
 * `hoursDelta` may be positive (credit) or negative (debit); `reason` is required.
 */
export function createAdjustment(data: { studentId: string; hoursDelta: number; reason: string }): LedgerEntry {
  const reason = data.reason.trim();
  if (!Number.isFinite(data.hoursDelta) || data.hoursDelta === 0) {
    throw new Error('Adjustment hours must be a non-zero number');
  }
  if (reason.length === 0) throw new Error('Adjustment requires a reason');
  const exists = getDb().getFirstSync<{ id: string }>('SELECT id FROM students WHERE id = ?', [data.studentId]);
  if (!exists) throw new Error(`Student ${data.studentId} not found`);
  return appendEntry({ studentId: data.studentId, type: 'adjustment', hoursDelta: data.hoursDelta, reason });
}
