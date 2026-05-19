import { getDb } from './client';

export type Student = {
  id: string;
  full_name: string;
  grade: number;
  subject: string;
  curriculum: 'CAPS' | 'IEB' | 'Cambridge' | 'Other';
  status: 'active' | 'paused' | 'archived';
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
};

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
  cancel_reason: string | null;
  topics: string;
  session_notes: string | null;
  status: 'scheduled' | 'active' | 'paused' | 'completed' | 'cancelled';
  session_type: 'general' | 'review' | 'test_prep' | 'exam_prep';
  verified_at: string | null;
  updated_at: string | null;
  tutor_id: string | null;
  created_at: string;
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
