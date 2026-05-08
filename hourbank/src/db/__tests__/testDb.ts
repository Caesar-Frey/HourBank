/**
 * testDb.ts — in-memory SQLite harness for Jest tests.
 *
 * Uses better-sqlite3 (Node-native) wrapped to match the expo-sqlite API
 * surface consumed by src/db/schema.ts and src/db/client.ts.
 *
 * Do NOT import this from application code — test files only.
 */

import BetterSQLite from 'better-sqlite3';
import { __setDb } from '../client';

// ─── Types ─────────────────────────────────────────────────────────────────

/** Minimal expo-sqlite API surface used by schema.ts / repositories */
export interface TestDb {
  _bsDb: BetterSQLite.Database;
  runSync(sql: string, params?: unknown[]): void;
  getAllSync<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  getFirstSync<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | null;
}

// ─── Wrap helper ───────────────────────────────────────────────────────────

function wrapBetterSqlite(bsDb: BetterSQLite.Database): TestDb {
  return {
    _bsDb: bsDb,

    runSync(sql: string, params?: unknown[]): void {
      const stmt = bsDb.prepare(sql);
      if (params !== undefined) {
        stmt.run(...params);
      } else {
        stmt.run();
      }
    },

    getAllSync<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
      const stmt = bsDb.prepare(sql);
      if (params !== undefined) {
        return stmt.all(...params) as T[];
      }
      return stmt.all() as T[];
    },

    getFirstSync<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | null {
      const stmt = bsDb.prepare(sql);
      const row = params !== undefined ? stmt.get(...params) : stmt.get();
      return (row as T) ?? null;
    },
  };
}

// ─── Schema ────────────────────────────────────────────────────────────────
// Mirror of src/db/schema.ts initDb() — kept in sync manually.

function applySchema(bsDb: BetterSQLite.Database): void {
  bsDb.pragma('journal_mode = WAL');
  bsDb.pragma('foreign_keys = ON');

  bsDb.exec(`
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

  bsDb.exec(`
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

  bsDb.exec(`
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

  bsDb.exec(`
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

  bsDb.exec('CREATE INDEX IF NOT EXISTS idx_ledger_student ON ledger_entries(student_id, created_at DESC)');
  bsDb.exec('CREATE INDEX IF NOT EXISTS idx_sessions_student_status ON sessions(student_id, status)');
  bsDb.exec('CREATE INDEX IF NOT EXISTS idx_sessions_scheduled ON sessions(status, scheduled_for)');
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Open a fresh in-memory SQLite database with the full HourBank schema applied.
 * Each call returns an independent isolated database.
 */
export function createTestDb(): TestDb {
  const bsDb = new BetterSQLite(':memory:');
  applySchema(bsDb);
  return wrapBetterSqlite(bsDb);
}

/**
 * Replace the singleton returned by getDb() with the given test database.
 *
 * Usage:
 *   let db: TestDb;
 *   beforeEach(() => { db = createTestDb(); mockGetDb(db); });
 *   afterEach(() => resetDbSingleton());
 */
export function mockGetDb(testDb: TestDb): void {
  __setDb(testDb);
}

/**
 * Reset the db singleton in client.ts to null so the next getDb() opens fresh.
 */
export function resetDbSingleton(): void {
  __setDb(null);
}
