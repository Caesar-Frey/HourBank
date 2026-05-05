import { getDb } from './client';

export type Student = {
  id: string;
  full_name: string;
  grade: number;
  subject: string;
  curriculum: 'CAPS' | 'IEB' | 'Cambridge' | 'Other';
  status: 'active' | 'archived';
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
  topics: string;
  session_notes: string | null;
  status: 'scheduled' | 'active' | 'pending_verification' | 'verified' | 'disputed' | 'cancelled';
  verified_at: string | null;
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
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
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
      topics TEXT NOT NULL DEFAULT '[]',
      session_notes TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','pending_verification','verified','disputed','cancelled')),
      verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
