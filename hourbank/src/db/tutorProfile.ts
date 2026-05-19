import { getDb } from './client';
import { newId } from './uuid';

export type TutorProfile = {
  id: string;
  full_name: string;
  hourly_rate: number;
  currency: string;
  max_owe_hours: number;
  tier_system_enabled: number; // 0 or 1 (SQLite bool)
  package_tiers: string; // JSON string: [{hours, price, label, sort_order}]
  selected_subject_ids: string; // JSON string: []
  last_backup_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PackageTier = {
  hours: number;
  price: number;
  label: string;
  sort_order: number;
};

const DEFAULT_TIERS: PackageTier[] = [
  { hours: 5,  price: 3000, label: '5 hours',  sort_order: 0 },
  { hours: 10, price: 5500, label: '10 hours', sort_order: 1 },
  { hours: 15, price: 8000, label: '15 hours', sort_order: 2 },
];

export function getTutorProfile(): TutorProfile | null {
  const db = getDb();
  return db.getFirstSync<TutorProfile>('SELECT * FROM tutor_profile LIMIT 1') ?? null;
}

export function upsertTutorProfile(data: Partial<TutorProfile>): TutorProfile {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getTutorProfile();

  if (existing) {
    const merged: TutorProfile = { ...existing, ...data, updated_at: now };
    db.runSync(
      `UPDATE tutor_profile SET
        full_name = ?,
        hourly_rate = ?,
        currency = ?,
        max_owe_hours = ?,
        tier_system_enabled = ?,
        package_tiers = ?,
        selected_subject_ids = ?,
        last_backup_at = ?,
        updated_at = ?
       WHERE id = ?`,
      [
        merged.full_name,
        merged.hourly_rate,
        merged.currency,
        merged.max_owe_hours,
        merged.tier_system_enabled,
        merged.package_tiers,
        merged.selected_subject_ids,
        merged.last_backup_at ?? null,
        merged.updated_at,
        merged.id,
      ]
    );
    return merged;
  }

  // Insert new
  const id = data.id ?? newId();
  const row: TutorProfile = {
    id,
    full_name: data.full_name ?? '',
    hourly_rate: data.hourly_rate ?? 600,
    currency: data.currency ?? 'ZAR',
    max_owe_hours: data.max_owe_hours ?? 0,
    tier_system_enabled: data.tier_system_enabled ?? 1,
    package_tiers: data.package_tiers ?? JSON.stringify(DEFAULT_TIERS),
    selected_subject_ids: data.selected_subject_ids ?? '[]',
    last_backup_at: data.last_backup_at ?? null,
    created_at: data.created_at ?? now,
    updated_at: now,
  };

  db.runSync(
    `INSERT INTO tutor_profile (id, full_name, hourly_rate, currency, max_owe_hours, tier_system_enabled, package_tiers, selected_subject_ids, last_backup_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.full_name,
      row.hourly_rate,
      row.currency,
      row.max_owe_hours,
      row.tier_system_enabled,
      row.package_tiers,
      row.selected_subject_ids,
      row.last_backup_at,
      row.created_at,
      row.updated_at,
    ]
  );
  return row;
}

export function getOrCreateTutorProfile(): TutorProfile {
  return getTutorProfile() ?? upsertTutorProfile({});
}
