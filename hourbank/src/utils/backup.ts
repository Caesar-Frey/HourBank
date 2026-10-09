import { cacheDirectory } from 'expo-file-system/legacy';
import { backupDatabaseAsync, openDatabaseAsync } from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';
import { getDb } from '../db/client';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTutorProfile, upsertTutorProfile } from '../db/tutorProfile';

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

export async function exportDatabase(): Promise<void> {
  if (!cacheDirectory) {
    throw new Error('No cache directory is available for the database export.');
  }
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }

  // A raw file copy omits committed data in the live database's WAL.
  // Use a fresh destination so each export is a self-contained snapshot.
  const backupName = `hourbank_backup_${randomUUID()}.db`;
  const tempUri = cacheDirectory + backupName;
  const destination = await openDatabaseAsync(backupName, {}, cacheDirectory);
  try {
    await backupDatabaseAsync({ sourceDatabase: getDb(), destDatabase: destination });
  } finally {
    // Finish writing the snapshot before another app receives the file.
    await destination.closeAsync();
  }
  await Sharing.shareAsync(tempUri, {
    mimeType: 'application/x-sqlite3',
    dialogTitle: 'Export HourBank Database',
  });
  upsertTutorProfile({ last_backup_at: new Date().toISOString() });
  await AsyncStorage.removeItem(BACKUP_NUDGE_DISMISSED_TIER_KEY);
}

export async function getLastBackupAt(): Promise<string | null> {
  try {
    const profile = getTutorProfile();
    return profile?.last_backup_at ?? null;
  } catch {
    return null;
  }
}
