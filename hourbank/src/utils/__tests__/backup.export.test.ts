import BetterSQLite from 'better-sqlite3';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

jest.mock('expo-file-system/legacy', () => ({
  __esModule: true,
  cacheDirectory: '', documentDirectory: '',
  getInfoAsync: jest.fn(async () => ({ exists: true })),
  copyAsync: jest.fn(async ({ from, to }) => {
    require('fs').copyFileSync(require('url').fileURLToPath(from), require('url').fileURLToPath(to));
  }),
}));
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(), backupDatabaseAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({ removeItem: jest.fn(async () => {}) }));
jest.mock('../../db/client', () => ({ getDb: jest.fn() }));
jest.mock('../../db/tutorProfile', () => ({ getTutorProfile: jest.fn(), upsertTutorProfile: jest.fn() }));

import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';
import * as Sharing from 'expo-sharing';
import { getDb } from '../../db/client';
import { upsertTutorProfile } from '../../db/tutorProfile';
import { exportDatabase } from '../backup';

let root: string;
let source: BetterSQLite.Database;
let destination: BetterSQLite.Database | undefined;
let closed: boolean;
let exportedRows: unknown[];

beforeEach(() => {
  jest.clearAllMocks();
  root = mkdtempSync(join(tmpdir(), 'hourbank-backup-'));
  mkdirSync(join(root, 'SQLite'));
  Object.assign(FileSystem, {
    documentDirectory: pathToFileURL(root).href + '/',
    cacheDirectory: pathToFileURL(root).href + '/',
  });
  source = new BetterSQLite(join(root, 'SQLite/hourbank.db'));
  source.pragma('journal_mode = WAL');
  source.pragma('wal_autocheckpoint = 0');
  source.exec("CREATE TABLE lessons (notes TEXT); INSERT INTO lessons VALUES ('Latest committed lesson');");
  (getDb as jest.Mock).mockReturnValue(source);
  closed = false;
  exportedRows = [];
  (SQLite.openDatabaseAsync as jest.Mock).mockImplementation(async (name, _options, directory) => {
    const path = fileURLToPath(directory + name);
    destination = new BetterSQLite(path);
    return { path, closeAsync: async () => { destination!.close(); closed = true; } };
  });
  (SQLite.backupDatabaseAsync as jest.Mock).mockImplementation(async ({ sourceDatabase, destDatabase }) => {
    await sourceDatabase.backup(destDatabase.path);
  });
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
  (Sharing.shareAsync as jest.Mock).mockImplementation(async (uri) => {
    // Only this file travels to the recipient; no SQLite sidecars accompany it.
    const sharedPath = join(root, 'recipient.db');
    copyFileSync(fileURLToPath(uri), sharedPath);
    const reopened = new BetterSQLite(sharedPath, { readonly: true });
    try { exportedRows = reopened.prepare('SELECT notes FROM lessons').all(); }
    finally { reopened.close(); }
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

test('unavailable sharing rejects without claiming a successful backup', async () => {
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(false);
  await expect(exportDatabase()).rejects.toThrow();
  expect(upsertTutorProfile).not.toHaveBeenCalled();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

test('snapshot failure closes the destination and never shares or records success', async () => {
  (SQLite.backupDatabaseAsync as jest.Mock).mockRejectedValue(new Error('snapshot failed'));
  await expect(exportDatabase()).rejects.toThrow('snapshot failed');
  expect(closed).toBe(true);
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
