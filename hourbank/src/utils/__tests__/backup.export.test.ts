import BetterSQLite from 'better-sqlite3';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

jest.mock('expo-file-system/legacy', () => {
  const fs = require('fs');
  const { fileURLToPath: toPath } = require('url');
  return {
    __esModule: true,
    cacheDirectory: '', documentDirectory: '',
    getInfoAsync: jest.fn(async (uri: string) => ({ exists: fs.existsSync(toPath(uri)) })),
    copyAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
      fs.copyFileSync(toPath(from), toPath(to));
    }),
    deleteAsync: jest.fn(async (uri: string) => { fs.rmSync(toPath(uri), { force: true, recursive: true }); }),
    readDirectoryAsync: jest.fn(async (uri: string) => fs.readdirSync(toPath(uri))),
    readAsStringAsync: jest.fn(async (uri: string) => fs.readFileSync(toPath(uri)).toString('base64')),
  };
});
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(), backupDatabaseAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({ removeItem: jest.fn(async () => {}) }));
jest.mock('../../db/client', () => ({ getDb: jest.fn(), __setDb: jest.fn() }));
jest.mock('../../db/tutorProfile', () => ({ getTutorProfile: jest.fn(), upsertTutorProfile: jest.fn() }));

import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import * as Sharing from 'expo-sharing';
import { getDb } from '../../db/client';
import { upsertTutorProfile } from '../../db/tutorProfile';
import { wrapBetterSqlite } from '../../db/__tests__/wrapBetterSqlite';
import { exportDatabase } from '../backup';

let root: string;
let source: BetterSQLite.Database;
let destination: BetterSQLite.Database | undefined;
let closed: boolean;
let exportedRows: unknown[];
let exportedBlobs: Array<{ package_id: string; ext: string; data: string }>;

beforeEach(() => {
  jest.clearAllMocks();
  root = mkdtempSync(join(tmpdir(), 'hourbank-backup-'));
  mkdirSync(join(root, 'SQLite'));
  mkdirSync(join(root, 'cache'));
  Object.assign(FileSystem, {
    documentDirectory: pathToFileURL(root).href + '/',
    cacheDirectory: pathToFileURL(join(root, 'cache')).href + '/',
  });
  source = new BetterSQLite(join(root, 'SQLite/hourbank.db'));
  source.pragma('journal_mode = WAL');
  source.pragma('wal_autocheckpoint = 0');
  source.exec("CREATE TABLE lessons (notes TEXT); INSERT INTO lessons VALUES ('Latest committed lesson');");
  (getDb as jest.Mock).mockReturnValue(wrapBetterSqlite(source));
  closed = false;
  exportedRows = [];
  exportedBlobs = [];
  (SQLite.openDatabaseAsync as jest.Mock).mockImplementation(async (name, _options, directory) => {
    const path = fileURLToPath(directory + name);
    destination = new BetterSQLite(path);
    const d = destination;
    return {
      path,
      execAsync: async (sql: string) => { d.exec(sql); },
      runAsync: async (sql: string, params: unknown[] = []) => ({ changes: d.prepare(sql).run(...params).changes }),
      closeAsync: async () => { d.close(); closed = true; },
    };
  });
  (SQLite.backupDatabaseAsync as jest.Mock).mockImplementation(async ({ sourceDatabase, destDatabase }) => {
    await sourceDatabase._bsDb.backup(destDatabase.path);
  });
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
  (Sharing.shareAsync as jest.Mock).mockImplementation(async (uri) => {
    // Only this file travels to the recipient; no SQLite sidecars accompany it.
    const sharedPath = join(root, 'recipient.db');
    copyFileSync(fileURLToPath(uri), sharedPath);
    const reopened = new BetterSQLite(sharedPath, { readonly: true });
    try {
      exportedRows = reopened.prepare('SELECT notes FROM lessons').all();
      exportedBlobs = reopened.prepare('SELECT package_id, ext, data FROM backup_blobs').all() as typeof exportedBlobs;
    } finally { reopened.close(); }
    expect(closed).toBe(true);
  });
});

afterEach(() => {
  if (destination?.open) destination.close();
  source.close();
  rmSync(root, { recursive: true, force: true });
});

test('exports committed WAL data as a standalone database closed before sharing', async () => {
  await exportDatabase();
  expect(exportedRows).toEqual([{ notes: 'Latest committed lesson' }]);
  expect(upsertTutorProfile).toHaveBeenCalledWith({ last_backup_at: expect.any(String) });
});

test('embeds referenced proof photos so the single .db file is self-contained', async () => {
  const photo = join(root, 'proof.png');
  writeFileSync(photo, Buffer.from([1, 2, 3, 4]));
  source.exec(`CREATE TABLE credit_packages (id TEXT PRIMARY KEY, proof_image_uri TEXT)`);
  source.prepare('INSERT INTO credit_packages VALUES (?, ?), (?, ?), (?, NULL)')
    .run('p1', pathToFileURL(photo).href, 'p2', pathToFileURL(join(root, 'gone.jpg')).href, 'p3');
  const result = await exportDatabase();
  expect(result.proofImages).toBe(1);
  expect(exportedBlobs).toEqual([{ package_id: 'p1', ext: 'png', data: Buffer.from([1, 2, 3, 4]).toString('base64') }]);
});

test('cleans stale temp exports from earlier runs', async () => {
  const stale = join(root, 'cache', 'hourbank_backup_old.db');
  writeFileSync(stale, 'x');
  writeFileSync(join(root, 'cache', 'keep.txt'), 'x');
  await exportDatabase();
  expect(existsSync(stale)).toBe(false);
  expect(readdirSync(join(root, 'cache'))).toContain('keep.txt');
});

test('unavailable sharing rejects without claiming a successful backup', async () => {
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(false);
  await expect(exportDatabase()).rejects.toThrow();
  expect(upsertTutorProfile).not.toHaveBeenCalled();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

test('snapshot failure closes the destination, removes the partial file and never shares', async () => {
  (SQLite.backupDatabaseAsync as jest.Mock).mockRejectedValue(new Error('snapshot failed'));
  await expect(exportDatabase()).rejects.toThrow('snapshot failed');
  expect(closed).toBe(true);
  expect(readdirSync(join(root, 'cache')).filter(n => n.startsWith('hourbank_backup_'))).toEqual([]);
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(upsertTutorProfile).not.toHaveBeenCalled();
});

test('share failure does not record a successful backup', async () => {
  (Sharing.shareAsync as jest.Mock).mockRejectedValue(new Error('share failed'));
  await expect(exportDatabase()).rejects.toThrow('share failed');
  expect(upsertTutorProfile).not.toHaveBeenCalled();
});

test('missing cache directory rejects without sharing or recording success', async () => {
  Object.assign(FileSystem, { cacheDirectory: null });
  await expect(exportDatabase()).rejects.toThrow();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(upsertTutorProfile).not.toHaveBeenCalled();
});
