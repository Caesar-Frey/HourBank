import * as SQLite from 'expo-sqlite';
import { getDb } from './client';

type MigrationBase = {
  version: string;
  /**
   * Run with `PRAGMA foreign_keys = OFF`. Required for any migration that rebuilds
   * a table (CREATE new → copy → DROP old → RENAME): with FKs on, the DROP fires
   * ON DELETE actions on referencing tables (e.g. nulls ledger_entries.related_session_id).
   * The pragma is a no-op inside a transaction, so the runner toggles it *outside*
   * the transaction, runs `PRAGMA foreign_key_check` before COMMIT, and always
   * restores FKs afterwards.
   */
  foreignKeysOff?: boolean;
};

export type Migration =
  | (MigrationBase & { sql: string })
  | (MigrationBase & { run: (db: SQLite.SQLiteDatabase) => void });

export function hasColumn(db: SQLite.SQLiteDatabase, table: string, column: string): boolean {
  const rows = db.getAllSync<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.some(r => r.name === column);
}

export function hasTable(db: SQLite.SQLiteDatabase, table: string): boolean {
  const rows = db.getAllSync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [table]
  );
  return rows.length > 0;
}

export function runMigrations(migrations: Migration[]): void {
  const db = getDb();

  db.runSync(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  for (const migration of migrations) {
    const already = db.getFirstSync<{ version: string }>(
      'SELECT version FROM schema_migrations WHERE version = ?',
      [migration.version]
    );
    if (already) continue;

    const fkOff = migration.foreignKeysOff === true;
    // Must be outside the transaction — PRAGMA foreign_keys is a no-op inside one.
    if (fkOff) db.runSync('PRAGMA foreign_keys = OFF');
    try {
      db.withTransactionSync(() => {
        if ('run' in migration) {
          migration.run(db);
        } else {
          const statements = migration.sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);
          for (const stmt of statements) {
            db.runSync(stmt);
          }
        }
        if (fkOff) {
          const violations = db.getAllSync<{ table: string }>('PRAGMA foreign_key_check');
          if (violations.length > 0) {
            throw new Error(
              `Migration ${migration.version} left ${violations.length} foreign key violation(s) (first in table ${violations[0].table})`
            );
          }
        }
        db.runSync(
          'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
          [migration.version, new Date().toISOString()]
        );
      });
    } finally {
      if (fkOff) db.runSync('PRAGMA foreign_keys = ON');
    }
  }
}

export const MIGRATION_002: Migration = {
  version: '002_post_grilling',
  // Rebuilds `sessions`; FKs must be off or DROP TABLE nulls ledger_entries.related_session_id.
  foreignKeysOff: true,
  sql: `
    CREATE TABLE IF NOT EXISTS sessions_v2 (
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
    );
    INSERT INTO sessions_v2 (id, student_id, mode, scheduled_for, estimated_duration_minutes, started_at, ended_at, paused_seconds, duration_minutes, topics, session_notes, status, verified_at, created_at)
      SELECT id, student_id, mode, scheduled_for, estimated_duration_minutes, started_at, ended_at, paused_seconds, duration_minutes, topics, session_notes,
        CASE status WHEN 'pending_verification' THEN 'completed' WHEN 'verified' THEN 'completed' WHEN 'disputed' THEN 'cancelled' ELSE status END,
        verified_at, created_at
      FROM sessions;
    DROP TABLE sessions;
    ALTER TABLE sessions_v2 RENAME TO sessions;
    CREATE INDEX IF NOT EXISTS idx_sessions_student_status ON sessions(student_id, status);
    CREATE INDEX IF NOT EXISTS idx_sessions_scheduled ON sessions(status, scheduled_for);
    CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_active ON sessions(status) WHERE status IN ('active', 'paused');
    ALTER TABLE students ADD COLUMN updated_at TEXT;
    ALTER TABLE students ADD COLUMN tutor_id TEXT;
    ALTER TABLE credit_packages ADD COLUMN updated_at TEXT;
    ALTER TABLE credit_packages ADD COLUMN tutor_id TEXT;
    ALTER TABLE ledger_entries ADD COLUMN updated_at TEXT;
    ALTER TABLE ledger_entries ADD COLUMN tutor_id TEXT;
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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subjects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES subjects(id),
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(subject_id, name)
    );
    CREATE TABLE IF NOT EXISTS curricula (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id),
      package_id TEXT REFERENCES credit_packages(id),
      kind TEXT NOT NULL CHECK (kind IN ('session', 'top_up')),
      rendered_path TEXT,
      shared_at TEXT,
      created_at TEXT NOT NULL
    )
  `,
};

export const MIGRATION_003_SESSION_TYPE: Migration = {
  version: '003_session_type',
  run: (db) => {
    if (!hasColumn(db, 'sessions', 'session_type')) {
      db.runSync(
        `ALTER TABLE sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'general' CHECK (session_type IN ('general','review','test_prep','exam_prep'))`
      );
    }
    if (!hasColumn(db, 'topics', 'is_custom')) {
      db.runSync(`ALTER TABLE topics ADD COLUMN is_custom INTEGER NOT NULL DEFAULT 0`);
    }
    // DO NOT add topics.created_at — that column already exists from MIGRATION_002
  },
};

export const MIGRATION_005_LEDGER_CONSTRAINTS: Migration = {
  version: '005_ledger_constraints',
  run: (db) => {
    db.runSync(`
      CREATE TRIGGER IF NOT EXISTS chk_ledger_deduction_sign
        BEFORE INSERT ON ledger_entries
        WHEN NEW.type IN ('session_deduction', 'adjustment') AND NEW.hours_delta > 0
        BEGIN
          SELECT RAISE(ABORT, 'session_deduction/adjustment must have negative hours_delta');
        END
    `);
    db.runSync(`
      CREATE TRIGGER IF NOT EXISTS chk_topup_delta_sign
        BEFORE INSERT ON ledger_entries
        WHEN NEW.type = 'top_up' AND NEW.hours_delta < 0
        BEGIN
          SELECT RAISE(ABORT, 'top_up must have positive hours_delta');
        END
    `);
    db.runSync(`
      CREATE INDEX IF NOT EXISTS idx_ledger_session
        ON ledger_entries(related_session_id)
    `);
  },
};

export const MIGRATION_004_CALENDAR_EVENTS: Migration = {
  version: '004_calendar_events',
  run: (db) => {
    if (!hasTable(db, 'calendar_events')) {
      db.runSync(`
        CREATE TABLE calendar_events (
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
        )
      `);
      db.runSync(`CREATE INDEX idx_calendar_events_range ON calendar_events(starts_at)`);
      db.runSync(`CREATE INDEX idx_calendar_events_student ON calendar_events(student_id)`);
    }
  },
};

export const MIGRATION_006_CLAIMS: Migration = {
  version: '006_claims',
  run: (db) => {
    // ── New tables ────────────────────────────────────────────────────────────
    if (!hasTable(db, 'claims')) {
      db.runSync(`
        CREATE TABLE IF NOT EXISTS claims (
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
        )
      `);
    }

    if (!hasTable(db, 'claim_lines')) {
      db.runSync(`
        CREATE TABLE IF NOT EXISTS claim_lines (
          id           TEXT PRIMARY KEY,
          claim_id     TEXT NOT NULL REFERENCES claims(id) ON DELETE RESTRICT,
          session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
          billed_hours REAL NOT NULL,
          mode         TEXT NOT NULL CHECK (mode IN ('in_person','online')),
          lesson_fee   REAL NOT NULL,
          travel_fee   REAL NOT NULL,
          created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
    }

    // ── New columns on tutor_profile ─────────────────────────────────────────
    if (!hasColumn(db, 'tutor_profile', 'travel_mode')) {
      db.runSync(
        `ALTER TABLE tutor_profile ADD COLUMN travel_mode TEXT NOT NULL DEFAULT 'flat' CHECK (travel_mode IN ('flat','distance'))`
      );
    }
    if (!hasColumn(db, 'tutor_profile', 'per_km_rate')) {
      db.runSync(`ALTER TABLE tutor_profile ADD COLUMN per_km_rate REAL NOT NULL DEFAULT 0`);
    }

    // ── New columns on students ──────────────────────────────────────────────
    if (!hasColumn(db, 'students', 'travel_flat_fee')) {
      db.runSync(`ALTER TABLE students ADD COLUMN travel_flat_fee REAL NOT NULL DEFAULT 0`);
    }
    if (!hasColumn(db, 'students', 'travel_distance_km')) {
      db.runSync(`ALTER TABLE students ADD COLUMN travel_distance_km REAL NOT NULL DEFAULT 0`);
    }
    if (!hasColumn(db, 'students', 'payout_rate_override')) {
      db.runSync(`ALTER TABLE students ADD COLUMN payout_rate_override REAL`);
    }

    // ── Indexes ──────────────────────────────────────────────────────────────
    db.runSync(`CREATE INDEX IF NOT EXISTS idx_claim_lines_session ON claim_lines(session_id)`);
    db.runSync(`CREATE INDEX IF NOT EXISTS idx_claim_lines_claim   ON claim_lines(claim_id)`);
    db.runSync(`CREATE INDEX IF NOT EXISTS idx_claims_voided       ON claims(voided_at)`);
  },
};

// ── Ledger immutability guards ───────────────────────────────────────────────

function createLedgerImmutabilityTriggers(db: SQLite.SQLiteDatabase): void {
  db.runSync(`
    CREATE TRIGGER IF NOT EXISTS ledger_no_update
      BEFORE UPDATE ON ledger_entries
      BEGIN
        SELECT RAISE(ABORT, 'ledger_entries is append-only: UPDATE not allowed');
      END
  `);
  db.runSync(`
    CREATE TRIGGER IF NOT EXISTS ledger_no_delete
      BEFORE DELETE ON ledger_entries
      BEGIN
        SELECT RAISE(ABORT, 'ledger_entries is append-only: DELETE not allowed');
      END
  `);
}

function dropLedgerImmutabilityTriggers(db: SQLite.SQLiteDatabase): void {
  db.runSync('DROP TRIGGER IF EXISTS ledger_no_update');
  db.runSync('DROP TRIGGER IF EXISTS ledger_no_delete');
}

/**
 * Dev-only escape hatch for a full data wipe (seed.ts `resetDb`). Drops the
 * append-only triggers, runs `fn`, and re-creates them — all in ONE transaction,
 * so the guards are never left off. `fn` must NOT open its own transaction.
 */
export function suspendLedgerGuards(fn: () => void): void {
  const db = getDb();
  db.withTransactionSync(() => {
    dropLedgerImmutabilityTriggers(db);
    fn();
    createLedgerImmutabilityTriggers(db);
  });
}

/**
 * 007 — single migration owning all schema changes from the 2026-10-09 audit.
 * Additive only (no table rebuilds), idempotent when re-run directly.
 */
export const MIGRATION_007_AUDIT_REMEDIATION: Migration = {
  version: '007_audit_remediation',
  run: (db) => {
    const now = new Date().toISOString();

    // ── One in-flight session at a time ──────────────────────────────────────
    // Old index was UNIQUE on (status) → one 'active' AND one 'paused' could coexist.
    // Resolve any existing conflict first: keep the most recently started.
    db.runSync(
      `UPDATE sessions
         SET status = 'cancelled', cancel_reason = 'discarded',
             ended_at = COALESCE(ended_at, paused_at, ?), paused_at = NULL
       WHERE status IN ('active', 'paused')
         AND id != (
           SELECT id FROM sessions WHERE status IN ('active', 'paused')
           ORDER BY started_at DESC, created_at DESC LIMIT 1
         )`,
      [now]
    );
    db.runSync('DROP INDEX IF EXISTS sessions_one_active');
    db.runSync(
      `CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_in_flight
         ON sessions((1)) WHERE status IN ('active', 'paused')`
    );

    // Orphans from the old non-atomic createUnscheduled → startSession path.
    db.runSync(
      `UPDATE sessions SET status = 'cancelled', cancel_reason = 'discarded'
       WHERE status = 'scheduled' AND scheduled_for IS NULL AND started_at IS NULL`
    );

    // ── Ledger: append-only + signed adjustments ─────────────────────────────
    createLedgerImmutabilityTriggers(db);
    db.runSync('DROP TRIGGER IF EXISTS chk_ledger_deduction_sign');
    db.runSync(`
      CREATE TRIGGER IF NOT EXISTS chk_ledger_deduction_sign
        BEFORE INSERT ON ledger_entries
        WHEN NEW.type = 'session_deduction' AND NEW.hours_delta > 0
        BEGIN
          SELECT RAISE(ABORT, 'session_deduction must have negative hours_delta');
        END
    `);
    db.runSync(`
      CREATE TRIGGER IF NOT EXISTS chk_ledger_adjustment
        BEFORE INSERT ON ledger_entries
        WHEN NEW.type = 'adjustment'
          AND (NEW.reason IS NULL OR TRIM(NEW.reason) = '' OR NEW.hours_delta = 0)
        BEGIN
          SELECT RAISE(ABORT, 'adjustment requires a non-empty reason and non-zero hours_delta');
        END
    `);

    // ── tutor_profile: parent price split, payment details, billing rounding ─
    if (!hasColumn(db, 'tutor_profile', 'parent_hourly_price')) {
      db.runSync(`ALTER TABLE tutor_profile ADD COLUMN parent_hourly_price REAL NOT NULL DEFAULT 600`);
      db.runSync(`UPDATE tutor_profile SET parent_hourly_price = hourly_rate`);
    }
    if (!hasColumn(db, 'tutor_profile', 'payment_details')) {
      db.runSync(`ALTER TABLE tutor_profile ADD COLUMN payment_details TEXT`);
    }
    if (!hasColumn(db, 'tutor_profile', 'billing_round_minutes')) {
      db.runSync(`ALTER TABLE tutor_profile ADD COLUMN billing_round_minutes INTEGER NOT NULL DEFAULT 15`);
    }

    // ── students: parent contact ─────────────────────────────────────────────
    if (!hasColumn(db, 'students', 'parent_name')) {
      db.runSync(`ALTER TABLE students ADD COLUMN parent_name TEXT`);
    }
    if (!hasColumn(db, 'students', 'parent_phone')) {
      db.runSync(`ALTER TABLE students ADD COLUMN parent_phone TEXT`);
    }

    // ── sessions: cancel_reason (already added by 002 on most DBs) ───────────
    if (!hasColumn(db, 'sessions', 'cancel_reason')) {
      db.runSync(`ALTER TABLE sessions ADD COLUMN cancel_reason TEXT`);
    }
  },
};

/**
 * 008 — student's own WhatsApp number + who receives messages by default, and
 * the configurable payment reference template. Additive and idempotent.
 */
export const MIGRATION_008_CONTACTS_REFERENCE: Migration = {
  version: '008_contacts_reference',
  run: (db) => {
    if (!hasColumn(db, 'students', 'student_phone')) {
      db.runSync(`ALTER TABLE students ADD COLUMN student_phone TEXT`);
    }
    if (!hasColumn(db, 'students', 'preferred_contact')) {
      db.runSync(
        `ALTER TABLE students ADD COLUMN preferred_contact TEXT NOT NULL DEFAULT 'parent'
           CHECK (preferred_contact IN ('parent','student'))`
      );
    }
    if (!hasColumn(db, 'tutor_profile', 'payment_reference_template')) {
      db.runSync(
        `ALTER TABLE tutor_profile ADD COLUMN payment_reference_template TEXT NOT NULL DEFAULT '{first} {surname}'`
      );
    }
  },
};

/** Ordered migration chain run at app boot (app/_layout.tsx) and by test DBs. */
export const ALL_MIGRATIONS: Migration[] = [
  MIGRATION_002,
  MIGRATION_003_SESSION_TYPE,
  MIGRATION_004_CALENDAR_EVENTS,
  MIGRATION_005_LEDGER_CONSTRAINTS,
  MIGRATION_006_CLAIMS,
  MIGRATION_007_AUDIT_REMEDIATION,
  MIGRATION_008_CONTACTS_REFERENCE,
];
