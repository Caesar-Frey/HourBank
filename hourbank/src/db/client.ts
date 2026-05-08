import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync('hourbank.db');
  }
  return db;
}

/**
 * Test-only backdoor: replace the singleton with any compatible db object.
 * Called by testDb.ts mockGetDb() / resetDbSingleton() helpers.
 * Never call this from application code.
 *
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function __setDb(instance: any): void {
  db = instance as SQLite.SQLiteDatabase | null;
}
