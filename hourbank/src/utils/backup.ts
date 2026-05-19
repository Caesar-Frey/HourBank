import { documentDirectory, cacheDirectory, getInfoAsync, copyAsync } from 'expo-file-system/legacy';
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
  const DB_PATH = (documentDirectory ?? '') + 'SQLite/hourbank.db';
  const info = await getInfoAsync(DB_PATH);
  if (!info.exists) {
    console.warn('DB file not found at', DB_PATH);
    return;
  }
  const tempUri = (cacheDirectory ?? '') + 'hourbank_backup.db';
  await copyAsync({ from: DB_PATH, to: tempUri });
  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) {
    console.warn('Sharing not available on this device');
    return;
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
