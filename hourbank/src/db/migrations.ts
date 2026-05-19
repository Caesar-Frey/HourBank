import * as SQLite from 'expo-sqlite';
import { getDb } from './client';

export type Migration =
  | { version: string; sql: string }
  | { version: string; run: (db: SQLite.SQLiteDatabase) => void };

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
      db.runSync(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
        [migration.version, new Date().toISOString()]
      );
    });
  }
}

export const MIGRATION_002: Migration = {
  version: '002_post_grilling',
  sql: `
    PRAGMA foreign_keys = OFF;
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
    PRAGMA foreign_keys = ON;
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
