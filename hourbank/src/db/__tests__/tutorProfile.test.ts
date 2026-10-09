import { createTestDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import { getTutorProfile, upsertTutorProfile, getOrCreateTutorProfile } from '../tutorProfile';

// The tutor_profile table is created by MIGRATION_002, not initDb().
// We create it manually here so we can test tutorProfile.ts in isolation.
function addTutorProfileTable(db: TestDb) {
  db.runSync(`
    CREATE TABLE IF NOT EXISTS tutor_profile (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL DEFAULT '',
      hourly_rate REAL NOT NULL DEFAULT 600.0,
      currency TEXT NOT NULL DEFAULT 'ZAR',
      max_owe_hours REAL NOT NULL DEFAULT 0,
      tier_system_enabled INTEGER NOT NULL DEFAULT 1,
      package_tiers TEXT NOT NULL DEFAULT '[]',
      selected_subject_ids TEXT NOT NULL DEFAULT '[]',
      last_backup_at TEXT,
      travel_mode TEXT NOT NULL DEFAULT 'flat' CHECK (travel_mode IN ('flat','distance')),
      per_km_rate REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

describe('tutorProfile', () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb();
    addTutorProfileTable(db);
  });

  afterEach(() => {
    resetDbSingleton();
  });

  describe('getTutorProfile', () => {
    it('returns null when no profile exists', () => {
      expect(getTutorProfile()).toBeNull();
    });

    it('returns the profile when one exists', () => {
      const now = new Date().toISOString();
      db.runSync(
        `INSERT INTO tutor_profile (id, full_name, hourly_rate, currency, max_owe_hours, tier_system_enabled, package_tiers, selected_subject_ids, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['prof-1', 'Jane Tutor', 600, 'ZAR', 0, 1, '[]', '[]', now, now]
      );
      const profile = getTutorProfile();
      expect(profile).not.toBeNull();
      expect(profile!.full_name).toBe('Jane Tutor');
      expect(profile!.hourly_rate).toBe(600);
    });
  });

  describe('upsertTutorProfile', () => {
    it('inserts a new profile with defaults when none exists', () => {
      const profile = upsertTutorProfile({});
      expect(profile.hourly_rate).toBe(600);
      expect(profile.currency).toBe('ZAR');
      expect(profile.max_owe_hours).toBe(0);
      expect(profile.tier_system_enabled).toBe(1);
    });

    it('inserts with provided values', () => {
      const profile = upsertTutorProfile({ full_name: 'Test Tutor', hourly_rate: 750 });
      expect(profile.full_name).toBe('Test Tutor');
      expect(profile.hourly_rate).toBe(750);
    });

    it('updates existing profile with partial data', () => {
      upsertTutorProfile({ full_name: 'Original' });
      const updated = upsertTutorProfile({ full_name: 'Updated', hourly_rate: 800 });
      expect(updated.full_name).toBe('Updated');
      expect(updated.hourly_rate).toBe(800);
      // Only one row should exist
      const rows = db.getAllSync('SELECT * FROM tutor_profile');
      expect(rows).toHaveLength(1);
    });

    it('persists update to DB', () => {
      upsertTutorProfile({ full_name: 'First' });
      upsertTutorProfile({ full_name: 'Second' });
      const profile = getTutorProfile();
      expect(profile!.full_name).toBe('Second');
    });

    it('updates max_owe_hours', () => {
      upsertTutorProfile({});
      const updated = upsertTutorProfile({ max_owe_hours: 3 });
      expect(updated.max_owe_hours).toBe(3);
    });
  });

  describe('getOrCreateTutorProfile', () => {
    it('creates a profile with defaults when none exists', () => {
      const profile = getOrCreateTutorProfile();
      expect(profile.hourly_rate).toBe(600);
      expect(profile.currency).toBe('ZAR');
    });

    it('returns existing profile when one exists', () => {
      upsertTutorProfile({ full_name: 'Existing', hourly_rate: 700 });
      const profile = getOrCreateTutorProfile();
      expect(profile.full_name).toBe('Existing');
      expect(profile.hourly_rate).toBe(700);
    });

    it('does not create duplicate rows', () => {
      getOrCreateTutorProfile();
      getOrCreateTutorProfile();
      const rows = db.getAllSync('SELECT * FROM tutor_profile');
      expect(rows).toHaveLength(1);
    });
  });
});
