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
import { initDb } from '../schema';
import { runMigrations, MIGRATION_002, MIGRATION_003_SESSION_TYPE, MIGRATION_004_CALENDAR_EVENTS, MIGRATION_005_LEDGER_CONSTRAINTS, MIGRATION_006_CLAIMS } from '../migrations';
import { wrapBetterSqlite } from './wrapBetterSqlite';

// Re-export TestDb so test files can import it from here.
export type { TestDb } from './wrapBetterSqlite';

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Open a fresh in-memory SQLite database with the full HourBank schema applied.
 * Each call returns an independent isolated database.
 *
 * Uses initDb() from schema.ts directly — no manual SQL duplication.
 *
 * Also wires the getDb() singleton — no need to call mockGetDb() in beforeEach
 * unless re-wiring mid-test.
 */
export function createTestDb() {
  const bsDb = new BetterSQLite(':memory:');
  const wrapped = wrapBetterSqlite(bsDb);
  // Wire the singleton so initDb() (which calls getDb()) hits our in-memory db.
  __setDb(wrapped);
  initDb();
  return wrapped;
}

/** Service-test database with the same migration chain used at application boot. */
export function createMigratedTestDb() {
  const db = createTestDb();
  runMigrations([MIGRATION_002, MIGRATION_003_SESSION_TYPE, MIGRATION_004_CALENDAR_EVENTS, MIGRATION_005_LEDGER_CONSTRAINTS, MIGRATION_006_CLAIMS]);
  return db;
}

/**
 * Replace the singleton returned by getDb() with the given test database.
 *
 * Usage:
 *   let db: TestDb;
 *   beforeEach(() => { db = createTestDb(); mockGetDb(db); });
 *   afterEach(() => resetDbSingleton());
 */
export function mockGetDb(testDb: ReturnType<typeof createTestDb>): void {
  __setDb(testDb);
}

/**
 * Reset the db singleton in client.ts to null so the next getDb() opens fresh.
 */
export function resetDbSingleton(): void {
  __setDb(null);
}
