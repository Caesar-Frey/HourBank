/**
 * wrapBetterSqlite.ts — single source of truth for the expo-sqlite bridge.
 *
 * Used by both testDb.ts (TypeScript imports) and jest.setup.js (require).
 * Do NOT import from application code.
 */

import BetterSQLite from 'better-sqlite3';

/** Minimal expo-sqlite API surface used by schema.ts / repositories */
export interface TestDb {
  _bsDb: BetterSQLite.Database;
  runSync(sql: string, params?: unknown[]): { changes: number };
  getAllSync<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  getFirstSync<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | null;
  withTransactionSync(fn: () => void): void;
}

export function wrapBetterSqlite(bsDb: BetterSQLite.Database): TestDb {
  return {
    _bsDb: bsDb,

    runSync(sql: string, params?: unknown[]): { changes: number } {
      const stmt = bsDb.prepare(sql);
      const info = params !== undefined ? stmt.run(...params) : stmt.run();
      return { changes: info.changes };
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

    withTransactionSync(fn: () => void): void {
      bsDb.transaction(fn)();
    },
  };
}
