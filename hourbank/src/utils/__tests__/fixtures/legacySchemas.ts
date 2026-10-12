/**
 * Exact on-disk schemas (sqlite_master SQL) produced by earlier app builds, dumped
 * by running each build's own initDb() + migration list from git history:
 *
 *  - SCHEMA_V1_NO_RUNNER       f6e302b  initDb only, no schema_migrations / tutor_profile
 *  - SCHEMA_MAY_2026           4c6b1d6  EAS preview APK: initDb + 002, 003, 004, 005
 *  - SCHEMA_OCT_2026_PRE_REMEDIATION 2a36e90  initDb + 002 … 006 (pre audit remediation)
 *
 * Used to prove backups made by those builds still restore into this app.
 */

export const VERSIONS_MAY_2026 = ['002_post_grilling', '003_session_type', '004_calendar_events', '005_ledger_constraints'];
export const VERSIONS_OCT_2026_PRE_REMEDIATION = [...VERSIONS_MAY_2026, '006_claims'];

export const SCHEMA_V1_NO_RUNNER: string[] = [
  `CREATE TABLE students (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      grade INTEGER CHECK (grade BETWEEN 1 AND 12),
      subject TEXT NOT NULL,
      curriculum TEXT NOT NULL DEFAULT 'CAPS' CHECK (curriculum IN ('CAPS','IEB','Cambridge','Other')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  `CREATE TABLE credit_packages (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      hours_added REAL NOT NULL CHECK (hours_added > 0),
      amount_paid REAL NOT NULL CHECK (amount_paid >= 0),
      payment_method TEXT NOT NULL DEFAULT 'eft' CHECK (payment_method IN ('eft','cash','card','other')),
      payment_ref TEXT,
      proof_image_uri TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  `CREATE TABLE sessions (
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
    )`,
  `CREATE TABLE ledger_entries (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('top_up','session_deduction','adjustment','refund')),
      hours_delta REAL NOT NULL,
      balance_after REAL NOT NULL,
      related_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      related_package_id TEXT REFERENCES credit_packages(id) ON DELETE SET NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  `CREATE INDEX idx_ledger_student ON ledger_entries(student_id, created_at DESC)`,
  `CREATE INDEX idx_sessions_student_status ON sessions(student_id, status)`,
  `CREATE INDEX idx_sessions_scheduled ON sessions(status, scheduled_for)`,
];

export const SCHEMA_MAY_2026: string[] = [
  `CREATE TABLE students (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      grade INTEGER CHECK (grade BETWEEN 1 AND 12),
      subject TEXT NOT NULL,
      curriculum TEXT NOT NULL DEFAULT 'CAPS' CHECK (curriculum IN ('CAPS','IEB','Cambridge','Other')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    , updated_at TEXT, tutor_id TEXT)`,
  `CREATE TABLE credit_packages (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      hours_added REAL NOT NULL CHECK (hours_added > 0),
      amount_paid REAL NOT NULL CHECK (amount_paid >= 0),
      payment_method TEXT NOT NULL DEFAULT 'eft' CHECK (payment_method IN ('eft','cash','card','other')),
      payment_ref TEXT,
      proof_image_uri TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    , updated_at TEXT, tutor_id TEXT)`,
  `CREATE TABLE tutor_profile (
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
    )`,
  `CREATE TABLE ledger_entries (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
      type TEXT NOT NULL CHECK (type IN ('top_up','session_deduction','adjustment','refund')),
      hours_delta REAL NOT NULL,
      balance_after REAL NOT NULL,
      related_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      related_package_id TEXT REFERENCES credit_packages(id) ON DELETE SET NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    , updated_at TEXT, tutor_id TEXT)`,
  `CREATE TABLE schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`,
  `CREATE TABLE "sessions" (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      mode TEXT NOT NULL DEFAULT 'in_person' CHECK (mode IN ('in_person','online')),
      scheduled_for TEXT,
      estimated_duration_minutes REAL,
      started_at TEXT,
      ended_at TEXT,
      paused_seconds INTEGER NOT NULL DEFAULT 0,
      duration_minutes REAL,
      billed_minutes INTEGER,
      paused_at TEXT,
      cancel_reason TEXT,
      topics TEXT NOT NULL DEFAULT '[]',
      session_notes TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','paused','completed','cancelled')),
      verified_at TEXT,
      updated_at TEXT,
      tutor_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    , session_type TEXT NOT NULL DEFAULT 'general' CHECK (session_type IN ('general','review','test_prep','exam_prep')))`,
  `CREATE TABLE subjects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  `CREATE TABLE topics (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES subjects(id),
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, is_custom INTEGER NOT NULL DEFAULT 0,
      UNIQUE(subject_id, name)
    )`,
  `CREATE TABLE curricula (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  `CREATE TABLE receipts (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id),
      package_id TEXT REFERENCES credit_packages(id),
      kind TEXT NOT NULL CHECK (kind IN ('session', 'top_up')),
      rendered_path TEXT,
      shared_at TEXT,
      created_at TEXT NOT NULL
    )`,
  `CREATE TABLE calendar_events (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('event','time_block')),
          student_id TEXT NULL REFERENCES students(id) ON DELETE SET NULL,
          starts_at TEXT NOT NULL,
          ends_at TEXT NULL,
          all_day INTEGER NOT NULL DEFAULT 0,
          title TEXT NOT NULL,
          category TEXT NULL CHECK (category IS NULL OR category IN ('test','exam','homework','other')),
          notes TEXT NULL,
          tutor_id TEXT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
  `CREATE INDEX idx_ledger_student ON ledger_entries(student_id, created_at DESC)`,
  `CREATE INDEX idx_sessions_student_status ON sessions(student_id, status)`,
  `CREATE INDEX idx_sessions_scheduled ON sessions(status, scheduled_for)`,
  `CREATE UNIQUE INDEX sessions_one_active ON sessions(status) WHERE status IN ('active', 'paused')`,
  `CREATE INDEX idx_calendar_events_range ON calendar_events(starts_at)`,
  `CREATE INDEX idx_calendar_events_student ON calendar_events(student_id)`,
  `CREATE INDEX idx_ledger_session
        ON ledger_entries(related_session_id)`,
  `CREATE TRIGGER chk_ledger_deduction_sign
        BEFORE INSERT ON ledger_entries
        WHEN NEW.type IN ('session_deduction', 'adjustment') AND NEW.hours_delta > 0
        BEGIN
          SELECT RAISE(ABORT, 'session_deduction/adjustment must have negative hours_delta');
        END`,
  `CREATE TRIGGER chk_topup_delta_sign
        BEFORE INSERT ON ledger_entries
        WHEN NEW.type = 'top_up' AND NEW.hours_delta < 0
        BEGIN
          SELECT RAISE(ABORT, 'top_up must have positive hours_delta');
        END`,
];

export const SCHEMA_OCT_2026_PRE_REMEDIATION: string[] = [
  `CREATE TABLE students (
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
    , updated_at TEXT, tutor_id TEXT)`,
  `CREATE TABLE credit_packages (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      hours_added REAL NOT NULL CHECK (hours_added > 0),
      amount_paid REAL NOT NULL CHECK (amount_paid >= 0),
      payment_method TEXT NOT NULL DEFAULT 'eft' CHECK (payment_method IN ('eft','cash','card','other')),
      payment_ref TEXT,
      proof_image_uri TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    , updated_at TEXT, tutor_id TEXT)`,
  `CREATE TABLE tutor_profile (
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
    )`,
  `CREATE TABLE ledger_entries (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
      type TEXT NOT NULL CHECK (type IN ('top_up','session_deduction','adjustment','refund')),
      hours_delta REAL NOT NULL,
      balance_after REAL NOT NULL,
      related_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      related_package_id TEXT REFERENCES credit_packages(id) ON DELETE SET NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    , updated_at TEXT, tutor_id TEXT)`,
  `CREATE TABLE schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`,
  `CREATE TABLE "sessions" (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      mode TEXT NOT NULL DEFAULT 'in_person' CHECK (mode IN ('in_person','online')),
      scheduled_for TEXT,
      estimated_duration_minutes REAL,
      started_at TEXT,
      ended_at TEXT,
      paused_seconds INTEGER NOT NULL DEFAULT 0,
      duration_minutes REAL,
      billed_minutes INTEGER,
      paused_at TEXT,
      cancel_reason TEXT,
      topics TEXT NOT NULL DEFAULT '[]',
      session_notes TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','paused','completed','cancelled')),
      verified_at TEXT,
      updated_at TEXT,
      tutor_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    , session_type TEXT NOT NULL DEFAULT 'general' CHECK (session_type IN ('general','review','test_prep','exam_prep')))`,
  `CREATE TABLE subjects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  `CREATE TABLE topics (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES subjects(id),
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, is_custom INTEGER NOT NULL DEFAULT 0,
      UNIQUE(subject_id, name)
    )`,
  `CREATE TABLE curricula (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  `CREATE TABLE receipts (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id),
      package_id TEXT REFERENCES credit_packages(id),
      kind TEXT NOT NULL CHECK (kind IN ('session', 'top_up')),
      rendered_path TEXT,
      shared_at TEXT,
      created_at TEXT NOT NULL
    )`,
  `CREATE TABLE calendar_events (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('event','time_block')),
          student_id TEXT NULL REFERENCES students(id) ON DELETE SET NULL,
          starts_at TEXT NOT NULL,
          ends_at TEXT NULL,
          all_day INTEGER NOT NULL DEFAULT 0,
          title TEXT NOT NULL,
          category TEXT NULL CHECK (category IS NULL OR category IN ('test','exam','homework','other')),
          notes TEXT NULL,
          tutor_id TEXT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
  `CREATE TABLE claims (
          id               TEXT PRIMARY KEY,
          tutor_id         TEXT,
          period_start     TEXT,
          period_end       TEXT,
          payout_rate      REAL NOT NULL,
          travel_mode      TEXT NOT NULL DEFAULT 'flat' CHECK (travel_mode IN ('flat','distance')),
          per_km_rate      REAL,
          lesson_fee_total REAL NOT NULL,
          travel_total     REAL NOT NULL,
          grand_total      REAL NOT NULL,
          report_path      TEXT,
          voided_at        TEXT,
          void_reason      TEXT,
          created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
  `CREATE TABLE claim_lines (
          id           TEXT PRIMARY KEY,
          claim_id     TEXT NOT NULL REFERENCES claims(id) ON DELETE RESTRICT,
          session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
          billed_hours REAL NOT NULL,
          mode         TEXT NOT NULL CHECK (mode IN ('in_person','online')),
          lesson_fee   REAL NOT NULL,
          travel_fee   REAL NOT NULL,
          created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
  `CREATE INDEX idx_ledger_student ON ledger_entries(student_id, created_at DESC)`,
  `CREATE INDEX idx_sessions_student_status ON sessions(student_id, status)`,
  `CREATE INDEX idx_sessions_scheduled ON sessions(status, scheduled_for)`,
  `CREATE UNIQUE INDEX sessions_one_active ON sessions(status) WHERE status IN ('active', 'paused')`,
  `CREATE INDEX idx_calendar_events_range ON calendar_events(starts_at)`,
  `CREATE INDEX idx_calendar_events_student ON calendar_events(student_id)`,
  `CREATE INDEX idx_ledger_session
        ON ledger_entries(related_session_id)`,
  `CREATE INDEX idx_claim_lines_session ON claim_lines(session_id)`,
  `CREATE INDEX idx_claim_lines_claim   ON claim_lines(claim_id)`,
  `CREATE INDEX idx_claims_voided       ON claims(voided_at)`,
  `CREATE TRIGGER chk_ledger_deduction_sign
        BEFORE INSERT ON ledger_entries
        WHEN NEW.type IN ('session_deduction', 'adjustment') AND NEW.hours_delta > 0
        BEGIN
          SELECT RAISE(ABORT, 'session_deduction/adjustment must have negative hours_delta');
        END`,
  `CREATE TRIGGER chk_topup_delta_sign
        BEFORE INSERT ON ledger_entries
        WHEN NEW.type = 'top_up' AND NEW.hours_delta < 0
        BEGIN
          SELECT RAISE(ABORT, 'top_up must have positive hours_delta');
        END`,
];

