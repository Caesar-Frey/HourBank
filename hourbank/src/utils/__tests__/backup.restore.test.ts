import BetterSQLite from 'better-sqlite3';
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

jest.mock('expo-file-system/legacy', () => {
  const fs = require('fs');
  const { fileURLToPath: toPath } = require('url');
  return {
    __esModule: true,
    cacheDirectory: '', documentDirectory: '',
    getInfoAsync: jest.fn(async (uri: string) => {
      const p = toPath(uri);
      return fs.existsSync(p) ? { exists: true, size: fs.statSync(p).size } : { exists: false };
    }),
    copyAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
      fs.copyFileSync(toPath(from), toPath(to));
    }),
    deleteAsync: jest.fn(async (uri: string) => { fs.rmSync(toPath(uri), { force: true, recursive: true }); }),
    readDirectoryAsync: jest.fn(async (uri: string) => fs.readdirSync(toPath(uri))),
    makeDirectoryAsync: jest.fn(async (uri: string) => { fs.mkdirSync(toPath(uri), { recursive: true }); }),
    readAsStringAsync: jest.fn(async (uri: string, opts?: { position?: number; length?: number }) => {
      let buf: Buffer = fs.readFileSync(toPath(uri));
      if (opts?.length !== undefined) buf = buf.subarray(opts.position ?? 0, (opts.position ?? 0) + opts.length);
      return buf.toString('base64');
    }),
    writeAsStringAsync: jest.fn(async (uri: string, data: string) => {
      fs.writeFileSync(toPath(uri), Buffer.from(data, 'base64'));
    }),
  };
});

jest.mock('expo-sqlite', () => {
  const { fileURLToPath: toPath } = require('url');
  return {
    openDatabaseAsync: jest.fn(async (name: string, _opts: unknown, directory: string) => {
      const BS = require('better-sqlite3');
      const path = toPath(directory + name);
      const bs = new BS(path);
      return {
        _bsDb: bs,
        path,
        execAsync: async (sql: string) => { bs.exec(sql); },
        runAsync: async (sql: string, p: unknown[] = []) => ({ changes: bs.prepare(sql).run(...p).changes }),
        getAllAsync: async (sql: string, p: unknown[] = []) => bs.prepare(sql).all(...p),
        getFirstAsync: async (sql: string, p: unknown[] = []) => bs.prepare(sql).get(...p) ?? null,
        closeAsync: async () => { bs.close(); },
      };
    }),
    backupDatabaseAsync: jest.fn(async ({ sourceDatabase, destDatabase }: any) => {
      await sourceDatabase._bsDb.backup(destDatabase.path);
    }),
  };
});

jest.mock('../../db/client', () => {
  let db: unknown = null;
  return {
    getDb: () => {
      if (!db) db = (globalThis as any).__openMainDb();
      return db;
    },
    __setDb: (x: unknown) => { db = x; },
  };
});
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({ removeItem: jest.fn(async () => {}) }));

import * as FileSystem from 'expo-file-system/legacy';
import { getDb, __setDb } from '../../db/client';
import { wrapBetterSqlite } from '../../db/__tests__/wrapBetterSqlite';
import { initDb } from '../../db/schema';
import {
  runMigrations,
  ALL_MIGRATIONS,
  type Migration,
} from '../../db/migrations';
import { inspectBackup, restoreBackup, importBackup, getLastBackupAt, BackupError } from '../backup';
import {
  SCHEMA_V1_NO_RUNNER,
  SCHEMA_MAY_2026,
  SCHEMA_OCT_2026_PRE_REMEDIATION,
  VERSIONS_MAY_2026,
  VERSIONS_OCT_2026_PRE_REMEDIATION,
} from './fixtures/legacySchemas';

// Same chain the app boots with (incl. 007 columns + ledger append-only triggers).
const MIGRATIONS: Migration[] = ALL_MIGRATIONS;
const VERSIONS = MIGRATIONS.map(m => m.version);

let root: string;
let mainPath: string;

function openWrapped(path: string) {
  const bs = new BetterSQLite(path);
  return Object.assign(wrapBetterSqlite(bs), {
    databasePath: path,
    closeSync: () => bs.close(),
  });
}

/** Build a fully migrated DB file at `path` and seed it. */
function buildDb(path: string, seed: (db: ReturnType<typeof openWrapped>) => void) {
  const db = openWrapped(path);
  __setDb(db);
  initDb();
  runMigrations(MIGRATIONS);
  seed(db);
  db.closeSync();
  __setDb(null);
}

function addStudent(db: ReturnType<typeof openWrapped>, id: string, name: string) {
  db.runSync(
    `INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at)
     VALUES (?, ?, 10, 'Mathematics', 'CAPS', 'active', '2026-01-01T00:00:00.000Z')`,
    [id, name]
  );
}

const PHOTO = Buffer.from([9, 8, 7, 6, 5]);

function buildBackupFile(): string {
  const path = join(root, 'picked', 'backup.db');
  buildDb(path, db => {
    addStudent(db, 'b1', 'Backup Bea');
    addStudent(db, 'b2', 'Backup Ben');
    db.runSync(
      `INSERT INTO credit_packages (id, student_id, hours_added, amount_paid, proof_image_uri, created_at)
       VALUES ('p1', 'b1', 10, 5500, 'file:///old-device/proofs/x.png', '2026-02-01T00:00:00.000Z')`
    );
    db.runSync(
      `INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, related_package_id, created_at)
       VALUES ('e1', 'b1', 'top_up', 10, 10, 'p1', '2026-02-01T00:00:00.000Z')`
    );
    db.runSync(`CREATE TABLE backup_blobs (package_id TEXT PRIMARY KEY, ext TEXT NOT NULL, data TEXT NOT NULL)`);
    db.runSync(`INSERT INTO backup_blobs VALUES ('p1', 'png', ?)`, [PHOTO.toString('base64')]);
    db.runSync(`CREATE TABLE backup_meta (key TEXT PRIMARY KEY, value TEXT)`);
    db.runSync(`INSERT INTO backup_meta VALUES ('exported_at', '2026-10-01T10:00:00.000Z')`);
  });
  return pathToFileURL(path).href;
}

beforeEach(() => {
  jest.clearAllMocks();
  root = mkdtempSync(join(tmpdir(), 'hourbank-restore-'));
  for (const d of ['doc/SQLite', 'cache', 'picked']) mkdirSync(join(root, d), { recursive: true });
  Object.assign(FileSystem, {
    documentDirectory: pathToFileURL(join(root, 'doc')).href + '/',
    cacheDirectory: pathToFileURL(join(root, 'cache')).href + '/',
  });
  mainPath = join(root, 'doc/SQLite/hourbank.db');
  (globalThis as any).__openMainDb = () => openWrapped(mainPath);
  buildDb(mainPath, db => addStudent(db, 'live1', 'Live Lerato'));
});

afterEach(() => {
  try { (getDb() as any).closeSync(); } catch { /* closed */ }
  __setDb(null);
  rmSync(root, { recursive: true, force: true });
});

const liveNames = () => getDb().getAllSync<{ full_name: string }>('SELECT full_name FROM students ORDER BY full_name').map(r => r.full_name);

describe('inspectBackup', () => {
  it('summarises a valid backup without touching live data', async () => {
    const { summary, tempUri } = await inspectBackup(buildBackupFile(), VERSIONS);
    expect(summary).toMatchObject({
      students: 2, activeStudents: 2, ledgerRows: 1, sessions: 0,
      lastEntryAt: '2026-02-01T00:00:00.000Z', proofImages: 1, exportedAt: '2026-10-01T10:00:00.000Z',
    });
    expect(tempUri.startsWith(FileSystem.cacheDirectory!)).toBe(true);
    expect(liveNames()).toEqual(['Live Lerato']);
  });

  it('rejects a file that is not SQLite and cleans its temp copy', async () => {
    const p = join(root, 'picked', 'notes.txt');
    writeFileSync(p, 'hello world, definitely not a database');
    await expect(inspectBackup(pathToFileURL(p).href, VERSIONS)).rejects.toMatchObject({
      code: 'NOT_SQLITE', detail: '38 B · file · .txt',
    });
    expect(readdirSync(join(root, 'cache'))).toEqual([]);
  });

  it('reports an unreadable picked file with its URI scheme', async () => {
    const err = await inspectBackup('content://com.android.providers.downloads/document/42', VERSIONS).catch(e => e);
    expect(err).toBeInstanceOf(BackupError);
    expect(err.code).toBe('UNREADABLE');
    expect(err.detail).toMatch(/^content · /);
    expect(readdirSync(join(root, 'cache'))).toEqual([]);
  });

  it('rejects a damaged database', async () => {
    const p = join(root, 'picked', 'broken.db');
    writeFileSync(p, Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(4096, 0xab)]));
    await expect(inspectBackup(pathToFileURL(p).href, VERSIONS)).rejects.toMatchObject({ code: 'CORRUPT' });
  });

  it('rejects a SQLite file without HourBank tables', async () => {
    const p = join(root, 'picked', 'other.db');
    const bs = new BetterSQLite(p);
    bs.exec('CREATE TABLE things (x)');
    bs.close();
    await expect(inspectBackup(pathToFileURL(p).href, VERSIONS)).rejects.toMatchObject({ code: 'MISSING_TABLES' });
  });

  it('rejects a backup made by a newer app version', async () => {
    const uri = buildBackupFile();
    const bs = new BetterSQLite(join(root, 'picked', 'backup.db'));
    bs.prepare(`INSERT INTO schema_migrations (version, applied_at) VALUES ('999_future', 'x')`).run();
    bs.close();
    const err = await inspectBackup(uri, VERSIONS).catch(e => e);
    expect(err).toBeInstanceOf(BackupError);
    expect(err.code).toBe('NEWER_VERSION');
  });
});

describe('restoreBackup', () => {
  it('replaces live data, migrates, restores proof photos and cleans temp files', async () => {
    // Leave a stale WAL sidecar from the live DB; it must not leak into the restored DB.
    writeFileSync(`${mainPath}-wal`, Buffer.alloc(0));
    const inspection = await inspectBackup(buildBackupFile(), VERSIONS);
    const result = await restoreBackup(inspection, MIGRATIONS);

    expect(result.proofImages).toBe(1);
    expect(liveNames()).toEqual(['Backup Bea', 'Backup Ben']);
    const pkg = getDb().getFirstSync<{ proof_image_uri: string }>(`SELECT proof_image_uri FROM credit_packages WHERE id = 'p1'`)!;
    expect(pkg.proof_image_uri).toBe(`${FileSystem.documentDirectory}proofs/p1.png`);
    expect(readFileSync(join(root, 'doc/proofs/p1.png'))).toEqual(PHOTO);
    const blobs = getDb().getFirstSync(`SELECT name FROM sqlite_master WHERE name IN ('backup_blobs','backup_meta')`);
    expect(blobs).toBeNull();
    expect(readdirSync(join(root, 'cache'))).toEqual([]);
  });

  it('keeps the previous data when the restore fails part-way', async () => {
    const inspection = await inspectBackup(buildBackupFile(), VERSIONS);
    // Fails while migrating the restored file, succeeds when re-opening the safety copy.
    let calls = 0;
    const flaky: Migration = {
      version: '999_flaky',
      run: () => { calls++; if (calls === 1) throw new Error('boom'); },
    };
    const err = await restoreBackup(inspection, [...MIGRATIONS, flaky]).catch(e => e);
    expect(err).toBeInstanceOf(BackupError);
    expect(err.code).toBe('RESTORE_FAILED');
    expect(liveNames()).toEqual(['Live Lerato']);
    expect(readdirSync(join(root, 'cache'))).toEqual([]);
  });
});

describe('backups made by older app versions', () => {
  type Legacy = { schema: string[]; versions: string[] | null };
  const V1: Legacy = { schema: SCHEMA_V1_NO_RUNNER, versions: null };
  const MAY: Legacy = { schema: SCHEMA_MAY_2026, versions: VERSIONS_MAY_2026 };
  const OCT: Legacy = { schema: SCHEMA_OCT_2026_PRE_REMEDIATION, versions: VERSIONS_OCT_2026_PRE_REMEDIATION };

  /**
   * Re-create the old app's live DB (WAL mode, as its initDb set) and export it
   * the way that build did. `walOnly` mirrors the pre-2a36e90 export: a raw copy
   * of hourbank.db taken while the app still had it open, so every committed
   * page still sat in hourbank.db-wal, which was never shared.
   */
  function buildLegacyBackup(legacy: Legacy, opts: { walOnly?: boolean } = {}): string {
    const livePath = join(root, 'picked', 'old-live.db');
    const bs = new BetterSQLite(livePath);
    bs.pragma('journal_mode = WAL');
    bs.pragma('wal_autocheckpoint = 0'); // small DBs never reached the 1000-page autocheckpoint
    for (const sql of legacy.schema) bs.exec(sql);
    for (const v of legacy.versions ?? []) {
      bs.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(v, '2026-05-19T10:00:00.000Z');
    }
    const v1 = legacy.versions === null;
    bs.exec(`INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at)
             VALUES ('o1', 'Old Olga', 10, 'Mathematics', 'CAPS', 'active', '2026-05-01T08:00:00.000Z')`);
    bs.exec(`INSERT INTO credit_packages (id, student_id, hours_added, amount_paid, created_at)
             VALUES ('op1', 'o1', 10, 5500, '2026-05-01T08:00:00.000Z')`);
    bs.exec(`INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, related_package_id, created_at)
             VALUES ('oe1', 'o1', 'top_up', 10, 10, 'op1', '2026-05-01T08:00:00.000Z')`);
    bs.exec(`INSERT INTO sessions (id, student_id, status, started_at, ended_at, duration_minutes, created_at)
             VALUES ('os1', 'o1', '${v1 ? 'verified' : 'completed'}', '2026-05-02T10:00:00.000Z', '2026-05-02T11:00:00.000Z', 60, '2026-05-02T10:00:00.000Z')`);
    bs.exec(`INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, related_session_id, created_at)
             VALUES ('oe2', 'o1', 'session_deduction', -1, 9, 'os1', '2026-05-02T11:00:00.000Z')`);
    if (!v1) {
      bs.exec(`INSERT INTO tutor_profile (id, full_name, last_backup_at) VALUES ('tp1', 'Old Tutor', '2026-05-10T09:00:00.000Z')`);
    }
    const out = join(root, 'picked', 'hourbank_backup.db'); // old export file name
    if (opts.walOnly) {
      copyFileSync(livePath, out); // what FileSystem.copyAsync(DB_PATH → cache) shipped
      bs.close();
    } else {
      bs.close(); // checkpoint: main file holds everything
      copyFileSync(livePath, out);
    }
    return pathToFileURL(out).href;
  }

  it.each([
    ['May 2026 build (4c6b1d6, migrations 002–005)', MAY],
    ['pre-remediation build (2a36e90, migrations 002–006)', OCT],
  ])('restores a %s backup and migrates it forward', async (_label, legacy) => {
    const pending = await importBackup(buildLegacyBackup(legacy), MIGRATIONS);
    expect(pending.summary).toMatchObject({
      students: 1, sessions: 1, ledgerRows: 2, exportedAt: null, migrationVersions: legacy.versions,
    });
    await pending.restore();
    expect(liveNames()).toEqual(['Old Olga']);
    const applied = getDb().getAllSync<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version').map(r => r.version);
    expect(applied).toEqual([...VERSIONS].sort());
    const bal = getDb().getFirstSync<{ s: number }>(`SELECT SUM(hours_delta) AS s FROM ledger_entries WHERE student_id = 'o1'`)!;
    expect(bal.s).toBe(9);
    expect(await getLastBackupAt()).toBe('2026-05-10T09:00:00.000Z');
  });

  it('restores a backup from before the migration runner (no schema_migrations / tutor_profile)', async () => {
    const pending = await importBackup(buildLegacyBackup(V1), MIGRATIONS);
    expect(pending.summary).toMatchObject({ students: 1, sessions: 1, ledgerRows: 2, migrationVersions: [] });
    await pending.restore();
    expect(liveNames()).toEqual(['Old Olga']);
    const s = getDb().getFirstSync<{ status: string }>(`SELECT status FROM sessions WHERE id = 'os1'`)!;
    expect(s.status).toBe('completed');
    const applied = getDb().getAllSync<{ version: string }>('SELECT version FROM schema_migrations').map(r => r.version);
    expect(applied.sort()).toEqual([...VERSIONS].sort());
  });

  it('explains an old raw-copy export whose data was left behind in the WAL (the phone report)', async () => {
    const uri = buildLegacyBackup(MAY, { walOnly: true });
    // The shared file is just the WAL-mode header page: valid SQLite, zero tables.
    const shared = new BetterSQLite(join(root, 'picked', 'hourbank_backup.db'), { readonly: true });
    expect(shared.prepare(`SELECT COUNT(*) AS n FROM sqlite_master`).get()).toEqual({ n: 0 });
    shared.close();

    const err = await importBackup(uri, MIGRATIONS).catch(e => e);
    expect(err).toBeInstanceOf(BackupError);
    expect(err.code).toBe('EMPTY_BACKUP');
    expect(err.detail).toBe('no tables · 4 KB');
    expect(liveNames()).toEqual(['Live Lerato']);
    expect(readdirSync(join(root, 'cache'))).toEqual([]);
  });

  it('restores a 007-era backup (before 008) and adds student contact + payment reference columns', async () => {
    const path = join(root, 'picked', 'backup-007.db');
    const db = openWrapped(path);
    __setDb(db);
    initDb();
    runMigrations(MIGRATIONS.filter(m => m.version !== '008_contacts_reference'));
    addStudent(db, 's7', 'Seven Sipho');
    db.closeSync();
    __setDb(null);

    const pending = await importBackup(pathToFileURL(path).href, MIGRATIONS);
    expect(pending.summary.migrationVersions).not.toContain('008_contacts_reference');
    await pending.restore();
    expect(liveNames()).toEqual(['Seven Sipho']);
    const applied = getDb().getAllSync<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version').map(r => r.version);
    expect(applied).toEqual([...VERSIONS].sort());
    const s = getDb().getFirstSync<{ student_phone: string | null; preferred_contact: string }>(
      `SELECT student_phone, preferred_contact FROM students WHERE id = 's7'`
    )!;
    expect(s).toEqual({ student_phone: null, preferred_contact: 'parent' });
    const cols = getDb().getAllSync<{ name: string }>(`PRAGMA table_info(tutor_profile)`).map(c => c.name);
    expect(cols).toContain('payment_reference_template');
  });

  it('names the missing table when an HourBank backup is only partly there', async () => {
    const uri = buildLegacyBackup(MAY);
    const bs = new BetterSQLite(join(root, 'picked', 'hourbank_backup.db'));
    bs.exec('PRAGMA foreign_keys = OFF; DROP TABLE ledger_entries;');
    bs.close();
    const err = await inspectBackup(uri, VERSIONS).catch(e => e);
    expect(err.code).toBe('MISSING_TABLES');
    expect(err.detail).toMatch(/^missing ledger_entries · found calendar_events, credit_packages, .* · \d+ KB$/);
  });

  it('names the unknown migration when a backup is newer than the app', async () => {
    const uri = buildLegacyBackup(OCT);
    const bs = new BetterSQLite(join(root, 'picked', 'hourbank_backup.db'));
    bs.prepare(`INSERT INTO schema_migrations (version, applied_at) VALUES ('999_future', 'x')`).run();
    bs.close();
    const err = await inspectBackup(uri, VERSIONS).catch(e => e);
    expect(err.code).toBe('NEWER_VERSION');
    expect(err.detail).toBe('999_future');
  });
});

describe('importBackup', () => {
  it('exposes summary + restore/cancel; cancel removes the temp copy', async () => {
    const pending = await importBackup(buildBackupFile(), MIGRATIONS);
    expect(pending.summary.students).toBe(2);
    expect(readdirSync(join(root, 'cache'))).toHaveLength(1);
    await pending.cancel();
    expect(readdirSync(join(root, 'cache'))).toEqual([]);
    expect(existsSync(mainPath)).toBe(true);
    expect(liveNames()).toEqual(['Live Lerato']);
  });
});
