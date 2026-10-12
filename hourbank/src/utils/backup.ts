import * as FileSystem from 'expo-file-system/legacy';
import { backupDatabaseAsync, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';
import { getDb, __setDb } from '../db/client';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTutorProfile, upsertTutorProfile } from '../db/tutorProfile';
import { initDb } from '../db/schema';
import { runMigrations, type Migration } from '../db/migrations';
import { ensureProofsDirectory, fileExtension } from './proofImages';

const BACKUP_NUDGE_DISMISSED_TIER_KEY = '@hourbank/backup_nudge_dismissed_tier';
const BACKUP_NUDGE_TIERS = [14, 30, 60, 120]; // days

// Returns the highest tier value that is ≤ daysSince (the "current active threshold").
// Returns null if daysSince < 14.
export function getCurrentNudgeTier(daysSince: number): number | null {
  const candidates = BACKUP_NUDGE_TIERS.filter(t => t <= daysSince);
  return candidates.length ? Math.max(...candidates) : null;
}

export function shouldShowNudge(daysSince: number, dismissedTier: number | null): boolean {
  const tier = getCurrentNudgeTier(daysSince);
  if (tier === null) return false;
  if (dismissedTier === null) return true;
  return tier > dismissedTier;
}

export { BACKUP_NUDGE_DISMISSED_TIER_KEY };

/** Tables embedded in an exported snapshot (dropped again after restore). */
const BLOBS_TABLE = 'backup_blobs';
const META_TABLE = 'backup_meta';
const TEMP_PREFIXES = ['hourbank_backup_', 'restore_', 'pre_restore_'];

/**
 * Data tables every HourBank build has had since the first schema (f6e302b).
 * tutor_profile and schema_migrations are NOT required: the earliest builds had
 * neither, and initDb()/runMigrations() create them when an old backup is
 * migrated forward on restore.
 */
export const REQUIRED_TABLES = [
  'students',
  'sessions',
  'ledger_entries',
  'credit_packages',
];

function requireCacheDirectory(): string {
  if (!FileSystem.cacheDirectory) {
    throw new Error('No cache directory is available for the database backup.');
  }
  return FileSystem.cacheDirectory;
}

async function deleteQuietly(uri: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // best effort cleanup
  }
}

/** Delete a SQLite file and its sidecars. */
async function deleteDbFiles(uri: string): Promise<void> {
  await Promise.all(['', '-wal', '-shm', '-journal'].map(suffix => deleteQuietly(uri + suffix)));
}

/** Remove backup/restore temp files left in the cache by earlier runs. */
export async function cleanBackupTempFiles(): Promise<void> {
  const cache = FileSystem.cacheDirectory;
  if (!cache) return;
  let names: string[] = [];
  try {
    names = await FileSystem.readDirectoryAsync(cache);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter(n => TEMP_PREFIXES.some(p => n.startsWith(p)))
      .map(n => deleteQuietly(cache + n))
  );
}

function tableExistsSync(name: string): boolean {
  return getDb().getFirstSync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [name]
  ) != null;
}

/** Copy proof photos referenced by credit_packages into the snapshot as base64 rows. */
async function embedProofImages(dest: SQLiteDatabase): Promise<number> {
  await dest.execAsync(
    `CREATE TABLE IF NOT EXISTS ${BLOBS_TABLE} (package_id TEXT PRIMARY KEY, ext TEXT NOT NULL, data TEXT NOT NULL)`
  );
  if (!tableExistsSync('credit_packages')) return 0;
  const rows = getDb().getAllSync<{ id: string; proof_image_uri: string }>(
    `SELECT id, proof_image_uri FROM credit_packages WHERE proof_image_uri IS NOT NULL AND proof_image_uri != ''`
  );
  let embedded = 0;
  for (const r of rows) {
    try {
      const info = await FileSystem.getInfoAsync(r.proof_image_uri);
      if (!info.exists) continue;
      const data = await FileSystem.readAsStringAsync(r.proof_image_uri, { encoding: 'base64' });
      await dest.runAsync(
        `INSERT OR REPLACE INTO ${BLOBS_TABLE} (package_id, ext, data) VALUES (?, ?, ?)`,
        [r.id, fileExtension(r.proof_image_uri), data]
      );
      embedded++;
    } catch {
      // A missing/unreadable photo must not block the backup of the ledger.
    }
  }
  return embedded;
}

/**
 * Export a self-contained SQLite snapshot (WAL-safe online backup + proof
 * photos embedded as base64) and open the share sheet. `last_backup_at` is only
 * stamped once the share sheet resolves without error (best effort — the OS
 * does not report whether the file was actually saved).
 */
export async function exportDatabase(): Promise<{ uri: string; proofImages: number }> {
  const cacheDirectory = requireCacheDirectory();
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await cleanBackupTempFiles();

  // A raw file copy omits committed data in the live database's WAL.
  // Use a fresh destination so each export is a self-contained snapshot.
  const backupName = `hourbank_backup_${randomUUID()}.db`;
  const tempUri = cacheDirectory + backupName;
  let proofImages = 0;
  const destination = await openDatabaseAsync(backupName, {}, cacheDirectory);
  try {
    await backupDatabaseAsync({ sourceDatabase: getDb(), destDatabase: destination });
    proofImages = await embedProofImages(destination);
    await destination.execAsync(`CREATE TABLE IF NOT EXISTS ${META_TABLE} (key TEXT PRIMARY KEY, value TEXT)`);
    await destination.runAsync(
      `INSERT OR REPLACE INTO ${META_TABLE} (key, value) VALUES ('exported_at', ?)`,
      [new Date().toISOString()]
    );
  } catch (e) {
    await destination.closeAsync().catch(() => {});
    await deleteDbFiles(tempUri);
    throw e;
  }
  // Finish writing the snapshot before another app receives the file.
  await destination.closeAsync();
  await Sharing.shareAsync(tempUri, {
    mimeType: 'application/x-sqlite3',
    dialogTitle: 'Export HourBank Database',
  });
  upsertTutorProfile({ last_backup_at: new Date().toISOString() });
  await AsyncStorage.removeItem(BACKUP_NUDGE_DISMISSED_TIER_KEY);
  // The exported file is removed on the next export/restore (the receiving app
  // may still be reading it right after the share sheet closes).
  return { uri: tempUri, proofImages };
}

export async function getLastBackupAt(): Promise<string | null> {
  try {
    const profile = getTutorProfile();
    return profile?.last_backup_at ?? null;
  } catch {
    return null;
  }
}

// ─── Restore ──────────────────────────────────────────────────────────────────

export type BackupErrorCode =
  | 'NO_STORAGE'
  | 'UNREADABLE'
  | 'NOT_SQLITE'
  | 'CORRUPT'
  | 'EMPTY_BACKUP'
  | 'MISSING_TABLES'
  | 'NEWER_VERSION'
  | 'RESTORE_FAILED';

export class BackupError extends Error {
  constructor(
    public readonly code: BackupErrorCode,
    message: string,
    /** Short diagnostic (table names, versions, SQLite error) shown under the friendly copy. */
    public readonly detail?: string
  ) {
    super(detail ? `${message} [${detail}]` : message);
    this.name = 'BackupError';
  }
}

export type BackupSummary = {
  students: number;
  activeStudents: number;
  sessions: number;
  ledgerRows: number;
  /** created_at of the newest ledger entry, or null when the ledger is empty. */
  lastEntryAt: string | null;
  proofImages: number;
  /** When the snapshot was exported (null for backups made before this field existed). */
  exportedAt: string | null;
  migrationVersions: string[];
};

export type BackupInspection = { tempUri: string; summary: BackupSummary };

const SQLITE_MAGIC_B64 = 'U1FMaXRlIGZvcm1hdCAzAA=='; // "SQLite format 3\0"

function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 80);
}

/** "12 KB" / "0 B" — for diagnostic detail lines only. */
async function describeSize(uri: string): Promise<string> {
  try {
    const info = (await FileSystem.getInfoAsync(uri)) as { exists: boolean; size?: number };
    const size = info.exists ? info.size ?? 0 : 0;
    return size < 1024 ? `${size} B` : `${Math.round(size / 1024)} KB`;
  } catch {
    return 'size unknown';
  }
}

function uriScheme(uri: string): string {
  return uri.match(/^([a-z][a-z0-9+.-]*):/i)?.[1] ?? 'path';
}

function uriExtension(uri: string): string {
  const name = uri.split(/[?#]/)[0].split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : 'no extension';
}

/**
 * Validate a backup file WITHOUT touching the live database: copy it to a temp
 * file, check the SQLite header, PRAGMA integrity_check, required tables and
 * that every migration it has applied is known to this app (i.e. it was not
 * made by a newer app version). Returns a summary for the confirm screen.
 */
export async function inspectBackup(uri: string, appMigrationVersions: string[]): Promise<BackupInspection> {
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) throw new BackupError('NO_STORAGE', 'No cache directory is available.');
  const tempName = `restore_${randomUUID()}.db`;
  const tempUri = cacheDirectory + tempName;
  try {
    await FileSystem.copyAsync({ from: uri, to: tempUri });
  } catch (e) {
    await deleteDbFiles(tempUri);
    throw new BackupError('UNREADABLE', "The backup file couldn't be opened.", `${uriScheme(uri)} · ${errorText(e)}`);
  }

  try {
    let header = '';
    try {
      header = await FileSystem.readAsStringAsync(tempUri, { encoding: 'base64', position: 0, length: 16 });
    } catch {
      header = '';
    }
    if (header !== SQLITE_MAGIC_B64) {
      throw new BackupError(
        'NOT_SQLITE',
        'This file is not an HourBank backup (not a SQLite database).',
        `${await describeSize(tempUri)} · ${uriScheme(uri)} · ${uriExtension(uri)}`
      );
    }

    const db = await openDatabaseAsync(tempName, {}, cacheDirectory);
    try {
      let integrity: Array<Record<string, string>>;
      try {
        integrity = await db.getAllAsync<Record<string, string>>('PRAGMA integrity_check');
      } catch (e) {
        throw new BackupError('CORRUPT', 'The backup file is damaged and cannot be read.', errorText(e));
      }
      const ok = integrity.length === 1 && Object.values(integrity[0])[0] === 'ok';
      if (!ok) {
        const first = integrity.length > 0 ? String(Object.values(integrity[0])[0]) : 'no result';
        throw new BackupError('CORRUPT', 'The backup file failed an integrity check.', first.slice(0, 80));
      }

      const tables = new Set(
        (await db.getAllAsync<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)).map(t => t.name)
      );
      if (tables.size === 0) {
        // Builds before 2a36e90 exported by raw-copying hourbank.db while it was
        // open in WAL mode; the committed pages stayed in hourbank.db-wal, which
        // was never shared, so the file is only the empty header page.
        throw new BackupError(
          'EMPTY_BACKUP',
          'The backup file has no data in it.',
          `no tables · ${await describeSize(tempUri)}`
        );
      }
      const missing = REQUIRED_TABLES.filter(t => !tables.has(t));
      if (missing.length > 0) {
        const found = [...tables].filter(t => !t.startsWith('sqlite_')).sort();
        throw new BackupError(
          'MISSING_TABLES',
          'The backup is missing required HourBank data.',
          `missing ${missing.join(', ')} · found ${found.slice(0, 8).join(', ')}${found.length > 8 ? ', …' : ''} · ${await describeSize(tempUri)}`
        );
      }

      // Backups from before the migration runner have no schema_migrations:
      // treat them as version-less and let restore apply every migration.
      const versions = tables.has('schema_migrations')
        ? (await db.getAllAsync<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version')).map(r => r.version)
        : [];
      const known = new Set(appMigrationVersions);
      const unknown = versions.filter(v => !known.has(v));
      if (unknown.length > 0) {
        throw new BackupError(
          'NEWER_VERSION',
          'This backup was made by a newer version of HourBank. Update the app first.',
          unknown.join(', ')
        );
      }

      const count = async (sql: string) => (await db.getFirstAsync<{ n: number }>(sql))?.n ?? 0;
      const last = await db.getFirstAsync<{ at: string | null }>('SELECT MAX(created_at) AS at FROM ledger_entries');
      const exported = tables.has(META_TABLE)
        ? await db.getFirstAsync<{ value: string }>(`SELECT value FROM ${META_TABLE} WHERE key = 'exported_at'`)
        : null;

      const summary: BackupSummary = {
        students: await count('SELECT COUNT(*) AS n FROM students'),
        activeStudents: await count(`SELECT COUNT(*) AS n FROM students WHERE status != 'archived'`),
        sessions: await count('SELECT COUNT(*) AS n FROM sessions'),
        ledgerRows: await count('SELECT COUNT(*) AS n FROM ledger_entries'),
        lastEntryAt: last?.at ?? null,
        proofImages: tables.has(BLOBS_TABLE) ? await count(`SELECT COUNT(*) AS n FROM ${BLOBS_TABLE}`) : 0,
        exportedAt: exported?.value ?? null,
        migrationVersions: versions,
      };
      return { tempUri, summary };
    } finally {
      await db.closeAsync();
    }
  } catch (e) {
    await deleteDbFiles(tempUri);
    throw e;
  }
}

function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

function liveDatabaseUri(): string {
  const path = (getDb() as { databasePath?: string }).databasePath;
  if (path) return toFileUri(path);
  if (!FileSystem.documentDirectory) throw new BackupError('NO_STORAGE', 'No document directory available.');
  return `${FileSystem.documentDirectory}SQLite/hourbank.db`;
}

async function replaceDatabaseFile(mainUri: string, fromUri: string): Promise<void> {
  try {
    getDb().closeSync();
  } catch {
    // already closed
  }
  __setDb(null); // next getDb() reopens the (replaced) file
  await deleteQuietly(`${mainUri}-wal`);
  await deleteQuietly(`${mainUri}-shm`);
  await FileSystem.deleteAsync(mainUri, { idempotent: true });
  await FileSystem.copyAsync({ from: fromUri, to: mainUri });
}

function reopenAndMigrate(migrations: Migration[]): void {
  initDb();
  runMigrations(migrations);
}

/** Write embedded proof photos to documentDirectory/proofs and repoint packages. */
async function extractProofImages(): Promise<number> {
  if (!tableExistsSync(BLOBS_TABLE)) return 0;
  const db = getDb();
  const rows = db.getAllSync<{ package_id: string; ext: string; data: string }>(
    `SELECT package_id, ext, data FROM ${BLOBS_TABLE}`
  );
  let restored = 0;
  if (rows.length > 0) {
    const dir = await ensureProofsDirectory();
    for (const r of rows) {
      const dest = `${dir}${r.package_id}.${r.ext}`;
      await FileSystem.writeAsStringAsync(dest, r.data, { encoding: 'base64' });
      db.runSync('UPDATE credit_packages SET proof_image_uri = ? WHERE id = ?', [dest, r.package_id]);
      restored++;
    }
  }
  db.runSync(`DROP TABLE IF EXISTS ${BLOBS_TABLE}`);
  db.runSync(`DROP TABLE IF EXISTS ${META_TABLE}`);
  return restored;
}

/**
 * Replace ALL app data with a previously inspected backup. A safety snapshot of
 * the current database is taken first and put back if anything fails. After
 * success the DB singleton points at the restored data (migrated to this app
 * version); callers should reset in-memory state and navigate home.
 */
export async function restoreBackup(
  inspection: BackupInspection,
  migrations: Migration[]
): Promise<{ proofImages: number }> {
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) throw new BackupError('NO_STORAGE', 'No cache directory is available.');
  const mainUri = liveDatabaseUri();

  const safetyName = `pre_restore_${randomUUID()}.db`;
  const safetyUri = cacheDirectory + safetyName;
  const safety = await openDatabaseAsync(safetyName, {}, cacheDirectory);
  try {
    await backupDatabaseAsync({ sourceDatabase: getDb(), destDatabase: safety });
  } finally {
    await safety.closeAsync();
  }

  try {
    await replaceDatabaseFile(mainUri, inspection.tempUri);
    reopenAndMigrate(migrations);
    const proofImages = await extractProofImages();
    return { proofImages };
  } catch (e) {
    try {
      await replaceDatabaseFile(mainUri, safetyUri);
      reopenAndMigrate(migrations);
    } catch {
      // Leave the error below as the primary failure.
    }
    throw new BackupError('RESTORE_FAILED', 'Restore failed and your previous data was kept.', errorText(e));
  } finally {
    await deleteDbFiles(inspection.tempUri);
    await deleteDbFiles(safetyUri);
  }
}

/** Discard an inspected-but-not-restored backup's temp copy. */
export async function discardInspection(inspection: BackupInspection): Promise<void> {
  await deleteDbFiles(inspection.tempUri);
}

/**
 * Convenience wrapper for the Settings flow:
 *   const pending = await importBackup(pickedUri, ALL_MIGRATIONS);
 *   // show pending.summary, require typed confirm
 *   await pending.restore();   // or pending.cancel()
 */
export async function importBackup(
  uri: string,
  migrations: Migration[]
): Promise<{ summary: BackupSummary; restore: () => Promise<{ proofImages: number }>; cancel: () => Promise<void> }> {
  const inspection = await inspectBackup(uri, migrations.map(m => m.version));
  return {
    summary: inspection.summary,
    restore: () => restoreBackup(inspection, migrations),
    cancel: () => discardInspection(inspection),
  };
}
