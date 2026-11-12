import { getDb } from './client';

export type Student = {
  id: string;
  full_name: string;
  grade: number;
  subject: string;
  curriculum: 'CAPS' | 'IEB' | 'Cambridge' | 'Other';
  status: 'active' | 'paused' | 'archived';
  created_at: string;
  travel_flat_fee: number;
  travel_distance_km: number;
  payout_rate_override: number | null;
  /** Added by migration 007. Optional on the type so legacy object literals still compile. */
  parent_name?: string | null;
  /** WhatsApp/phone number as typed by the tutor (normalise at send time). Migration 007. */
  parent_phone?: string | null;
  /** Student's own WhatsApp number (some students handle payments themselves). Migration 008. */
  student_phone?: string | null;
  /** Who receives outgoing messages by default when both numbers exist. Migration 008. */
  preferred_contact?: PreferredContact;
  /** How the PARENT is charged for travel (migration 009). Distinct from the tutor's payout travel. */
  parent_travel_mode?: ParentTravelMode;
  /** Parent travel charge per in-person lesson when mode is 'flat' (rand). Migration 009. */
  parent_travel_flat_fee?: number;
  /** Parent travel charge per km when mode is 'per_km' (rand/km). Migration 009. */
  parent_travel_per_km?: number;
  /** When a top-up reminder was last opened in WhatsApp (migration 013). */
  last_reminded_at?: string | null;
};

export type PreferredContact = 'parent' | 'student';

/** How a family is charged for the tutor's travel (per student; legacy agreements differ). */
export type ParentTravelMode = 'flat' | 'per_km' | 'none';

/** A subject a student takes; each has its own hours balance (migration 009). */
export type StudentSubject = {
  id: string;
  student_id: string;
  subject: string;
  /** NULL = inherit the student's grade. */
  grade: number | null;
  /** NULL = inherit the student's curriculum. */
  curriculum: Student['curriculum'] | null;
  status: 'active' | 'archived';
  sort_order: number;
  created_at: string;
};

/** Rand payment against a student's travel owed (with a top-up or on its own). */
export type TravelSettlement = {
  id: string;
  student_id: string;
  amount: number;
  payment_method: CreditPackage['payment_method'];
  package_id: string | null;
  note: string | null;
  created_at: string;
};

export type CreditPackage = {
  id: string;
  student_id: string;
  hours_added: number;
  amount_paid: number;
  payment_method: 'eft' | 'cash' | 'card' | 'other';
  payment_ref: string | null;
  proof_image_uri: string | null;
  notes: string | null;
  created_at: string;
  /** Subject the hours were bought for (migration 009). */
  subject_id?: string | null;
};

/**
 * Why a session ended up `cancelled`:
 * - cancelled: scheduled lesson called off
 * - no_show: student didn't attend (may carry a deduction if charged)
 * - discarded: in-flight timer thrown away (or orphan cleaned by migration 007)
 * - student_archived: future lesson cancelled because the student was archived
 * - removed: a recorded lesson (or charged no-show) struck from history; its
 *   hours went back via an `adjustment` (migration 011, see removed_at)
 */
export type SessionCancelReason = 'cancelled' | 'no_show' | 'discarded' | 'student_archived' | 'removed';

export type Session = {
  id: string;
  student_id: string;
  mode: 'in_person' | 'online';
  scheduled_for: string | null;
  estimated_duration_minutes: number | null;
  started_at: string | null;
  ended_at: string | null;
  paused_seconds: number;
  duration_minutes: number | null;
  billed_minutes: number | null;
  paused_at: string | null;
  cancel_reason: SessionCancelReason | null;
  topics: string;
  session_notes: string | null;
  status: 'scheduled' | 'active' | 'paused' | 'completed' | 'cancelled';
  session_type: 'general' | 'review' | 'test_prep' | 'exam_prep';
  verified_at: string | null;
  updated_at: string | null;
  tutor_id: string | null;
  created_at: string;
  /** Subject taught (migration 009). NULL on rows written before subjects = student's primary subject. */
  subject_id?: string | null;
  /** Km travelled for this lesson; NULL = student's default (students.travel_distance_km). */
  travel_km?: number | null;
  /** Parent travel charge (rand) snapshotted when the lesson was recorded; NULL = none. */
  parent_travel_fee?: number | null;
  /** Rate terms that priced parent_travel_fee (migration 010); NULL = legacy, snapshotted on first edit. */
  parent_travel_mode_snapshot?: ParentTravelMode | null;
  parent_travel_flat_snapshot?: number | null;
  parent_travel_per_km_snapshot?: number | null;
  /** Set when a past lesson is edited in place. */
  edited_at?: string | null;
  /** Charged no-show only: 1 = parent travel charged and tutor travel claimed (migration 011, default 0). */
  no_show_travel?: number;
  /** Set when a recorded lesson was removed (status → cancelled/removed). Migration 011. */
  removed_at?: string | null;
};

export type LedgerEntry = {
  id: string;
  student_id: string;
  type: 'top_up' | 'session_deduction' | 'adjustment' | 'refund';
  hours_delta: number;
  balance_after: number;
  related_session_id: string | null;
  related_package_id: string | null;
  reason: string | null;
  created_at: string;
  /** Subject balance this row moves (migration 009). */
  subject_id?: string | null;
};

export type Claim = {
  id: string;
  tutor_id: string | null;
  period_start: string | null;
  period_end: string | null;
  payout_rate: number;
  travel_mode: 'flat' | 'distance';
  per_km_rate: number | null;
  lesson_fee_total: number;
  travel_total: number;
  grand_total: number;
  report_path: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
};

export type ClaimLine = {
  id: string;
  claim_id: string;
  session_id: string;
  billed_hours: number;
  mode: 'in_person' | 'online';
  lesson_fee: number;
  travel_fee: number;
  created_at: string;
  /** Payout rate (R/h) used for this line (migration 012); null when not derivable. */
  rate?: number | null;
};

export type Topic = {
  id: string;
  subject_id: string;
  name: string;
  sort_order: number;
  is_custom?: number; // 0 | 1
  created_at?: string | null;
  updated_at: string;
};

export interface CalendarEventRow {
  id: string;
  kind: 'event' | 'time_block';
  student_id: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: number; // 0 = timed, 1 = all-day
  title: string;
  category: 'test' | 'exam' | 'homework' | 'other' | null;
  notes: string | null;
  tutor_id: string | null;
  created_at: string;
  updated_at: string;
}

export function initDb(): void {
  const db = getDb();

  db.runSync('PRAGMA journal_mode = WAL');
  db.runSync('PRAGMA foreign_keys = ON');

  db.runSync(`
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      grade INTEGER CHECK (grade BETWEEN 1 AND 12),
      subject TEXT NOT NULL,
      curriculum TEXT NOT NULL DEFAULT 'CAPS' CHECK (curriculum IN ('CAPS','IEB','Cambridge','Other')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
      travel_flat_fee REAL NOT NULL DEFAULT 0,
      travel_distance_km REAL NOT NULL DEFAULT 0,
      payout_rate_override REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.runSync(`
    CREATE TABLE IF NOT EXISTS credit_packages (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      hours_added REAL NOT NULL CHECK (hours_added > 0),
      amount_paid REAL NOT NULL CHECK (amount_paid >= 0),
      payment_method TEXT NOT NULL DEFAULT 'eft' CHECK (payment_method IN ('eft','cash','card','other')),
      payment_ref TEXT,
      proof_image_uri TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.runSync(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      mode TEXT NOT NULL DEFAULT 'in_person' CHECK (mode IN ('in_person','online')),
      scheduled_for TEXT,
      estimated_duration_minutes REAL,
      started_at TEXT,
      ended_at TEXT,
      paused_seconds INTEGER NOT NULL DEFAULT 0,
      duration_minutes REAL,
      billed_minutes REAL,
      paused_at TEXT,
      cancel_reason TEXT,
      topics TEXT NOT NULL DEFAULT '[]',
      session_notes TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','paused','completed','cancelled')),
      verified_at TEXT,
      updated_at TEXT,
      tutor_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.runSync(`
    CREATE TABLE IF NOT EXISTS tutor_profile (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL DEFAULT '',
      hourly_rate REAL NOT NULL DEFAULT 600.0,
      currency TEXT NOT NULL DEFAULT 'ZAR',
      max_owe_hours REAL NOT NULL DEFAULT 0,
      tier_system_enabled INTEGER NOT NULL DEFAULT 1,
      package_tiers TEXT NOT NULL DEFAULT '[]',
      selected_subject_ids TEXT NOT NULL DEFAULT '[]',
      last_backup_at TEXT,
      travel_mode TEXT NOT NULL DEFAULT 'flat' CHECK (travel_mode IN ('flat','distance')),
      per_km_rate REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.runSync(`
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
      type TEXT NOT NULL CHECK (type IN ('top_up','session_deduction','adjustment','refund')),
      hours_delta REAL NOT NULL,
      balance_after REAL NOT NULL,
      related_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      related_package_id TEXT REFERENCES credit_packages(id) ON DELETE SET NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.runSync('CREATE INDEX IF NOT EXISTS idx_ledger_student ON ledger_entries(student_id, created_at DESC)');
  db.runSync('CREATE INDEX IF NOT EXISTS idx_sessions_student_status ON sessions(student_id, status)');
  db.runSync('CREATE INDEX IF NOT EXISTS idx_sessions_scheduled ON sessions(status, scheduled_for)');
}
