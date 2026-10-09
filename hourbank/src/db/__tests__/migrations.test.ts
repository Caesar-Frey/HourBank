import { createTestDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import { runMigrations } from '../migrations';

describe('runMigrations — runner mechanics', () => {
  let db: TestDb;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { resetDbSingleton(); });

  it('creates schema_migrations table on first run', () => {
    runMigrations([]);
    const row = db.getFirstSync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
    );
    expect(row?.name).toBe('schema_migrations');
  });

  it('records each applied migration version', () => {
    runMigrations([{ version: '001_test', sql: 'SELECT 1' }]);
    const row = db.getFirstSync<{ version: string }>(
      "SELECT version FROM schema_migrations WHERE version = '001_test'"
    );
    expect(row?.version).toBe('001_test');
  });

  it('is idempotent — running same migrations twice leaves exactly one record', () => {
    const m = { version: '001_test', sql: 'SELECT 1' };
    runMigrations([m]);
    runMigrations([m]);
    const rows = db.getAllSync<{ version: string }>(
      "SELECT version FROM schema_migrations WHERE version = '001_test'"
    );
    expect(rows).toHaveLength(1);
  });

  it('applies only new migrations on subsequent runs', () => {
    runMigrations([{ version: '001_test', sql: 'SELECT 1' }]);
    runMigrations([
      { version: '001_test', sql: 'SELECT 1' },
      { version: '002_test', sql: 'SELECT 2' },
    ]);
    const rows = db.getAllSync<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version'
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].version).toBe('001_test');
    expect(rows[1].version).toBe('002_test');
  });

  it('executes migration SQL against the database', () => {
    runMigrations([{
      version: '001_test',
      sql: 'CREATE TABLE IF NOT EXISTS migration_test_table (id TEXT PRIMARY KEY)',
    }]);
    const row = db.getFirstSync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='migration_test_table'"
    );
    expect(row?.name).toBe('migration_test_table');
  });
});

describe('runMigrations — migration 002 schema effects', () => {
  let db: TestDb;
  const NOW = '2026-01-01T10:00:00.000Z';

  beforeEach(() => {
    db = createTestDb();
    db.runSync(
      `INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['student-1', 'Alice Botha', 10, 'Mathematics', 'CAPS', 'active', NOW]
    );
  });
  afterEach(() => { resetDbSingleton(); });

  it('adds billed_minutes column to sessions', () => {
    const { MIGRATION_002 } = require('../migrations');
    runMigrations([MIGRATION_002]);

    db.runSync(
      `INSERT INTO sessions (id, student_id, mode, topics, status, created_at) VALUES (?, ?, 'in_person', '[]', 'scheduled', ?)`,
      ['sess-1', 'student-1', NOW]
    );
    db.runSync('UPDATE sessions SET billed_minutes = 90 WHERE id = ?', ['sess-1']);

    const row = db.getFirstSync<{ billed_minutes: number }>(
      'SELECT billed_minutes FROM sessions WHERE id = ?', ['sess-1']
    );
    expect(row?.billed_minutes).toBe(90);
  });

  it('adds paused_at column to sessions', () => {
    const { MIGRATION_002 } = require('../migrations');
    runMigrations([MIGRATION_002]);

    db.runSync(
      `INSERT INTO sessions (id, student_id, mode, topics, status, created_at) VALUES (?, ?, 'in_person', '[]', 'scheduled', ?)`,
      ['sess-1', 'student-1', NOW]
    );
    db.runSync('UPDATE sessions SET paused_at = ? WHERE id = ?', [NOW, 'sess-1']);

    const row = db.getFirstSync<{ paused_at: string }>(
      'SELECT paused_at FROM sessions WHERE id = ?', ['sess-1']
    );
    expect(row?.paused_at).toBe(NOW);
  });

  it('completed sessions remain completed after migration runs', () => {
    db.runSync(
      `INSERT INTO sessions (id, student_id, mode, topics, status, started_at, ended_at, created_at) VALUES (?, ?, 'in_person', '[]', 'completed', ?, ?, ?)`,
      ['sess-1', 'student-1', NOW, NOW, NOW]
    );

    const { MIGRATION_002 } = require('../migrations');
    runMigrations([MIGRATION_002]);

    const row = db.getFirstSync<{ status: string }>(
      'SELECT status FROM sessions WHERE id = ?', ['sess-1']
    );
    expect(row?.status).toBe('completed');
  });

  it('cancelled sessions remain cancelled after migration runs', () => {
    db.runSync(
      `INSERT INTO sessions (id, student_id, mode, topics, status, started_at, ended_at, created_at) VALUES (?, ?, 'in_person', '[]', 'cancelled', ?, ?, ?)`,
      ['sess-1', 'student-1', NOW, NOW, NOW]
    );

    const { MIGRATION_002 } = require('../migrations');
    runMigrations([MIGRATION_002]);

    const row = db.getFirstSync<{ status: string }>(
      'SELECT status FROM sessions WHERE id = ?', ['sess-1']
    );
    expect(row?.status).toBe('cancelled');
  });

  it('adds updated_at column to students', () => {
    const { MIGRATION_002 } = require('../migrations');
    runMigrations([MIGRATION_002]);

    db.runSync("UPDATE students SET updated_at = ? WHERE id = ?", [NOW, 'student-1']);
    const row = db.getFirstSync<{ updated_at: string }>(
      'SELECT updated_at FROM students WHERE id = ?', ['student-1']
    );
    expect(row?.updated_at).toBe(NOW);
  });
});

describe('runMigrations — migration 006 claims schema effects', () => {
  let db: TestDb;

  function colNames(table: string): string[] {
    return db
      .getAllSync<{ name: string }>(`PRAGMA table_info(${table})`)
      .map(r => r.name);
  }

  function allMigrations() {
    const {
      MIGRATION_002,
      MIGRATION_003_SESSION_TYPE,
      MIGRATION_004_CALENDAR_EVENTS,
      MIGRATION_005_LEDGER_CONSTRAINTS,
      MIGRATION_006_CLAIMS,
    } = require('../migrations');
    return [
      MIGRATION_002,
      MIGRATION_003_SESSION_TYPE,
      MIGRATION_004_CALENDAR_EVENTS,
      MIGRATION_005_LEDGER_CONSTRAINTS,
      MIGRATION_006_CLAIMS,
    ];
  }

  beforeEach(() => {
    db = createTestDb();
    runMigrations(allMigrations());
  });
  afterEach(() => { resetDbSingleton(); });

  it('creates the claims table with all columns', () => {
    const cols = colNames('claims');
    expect(cols).toEqual(expect.arrayContaining([
      'id', 'tutor_id', 'period_start', 'period_end', 'payout_rate',
      'travel_mode', 'per_km_rate', 'lesson_fee_total', 'travel_total',
      'grand_total', 'report_path', 'voided_at', 'void_reason', 'created_at',
    ]));
  });

  it('creates the claim_lines table with all columns', () => {
    const cols = colNames('claim_lines');
    expect(cols).toEqual(expect.arrayContaining([
      'id', 'claim_id', 'session_id', 'billed_hours', 'mode',
      'lesson_fee', 'travel_fee', 'created_at',
    ]));
  });

  it('adds travel_mode and per_km_rate columns to tutor_profile', () => {
    const cols = colNames('tutor_profile');
    expect(cols).toEqual(expect.arrayContaining(['travel_mode', 'per_km_rate']));
  });

  it('adds travel columns and payout_rate_override to students', () => {
    const cols = colNames('students');
    expect(cols).toEqual(expect.arrayContaining([
      'travel_flat_fee', 'travel_distance_km', 'payout_rate_override',
    ]));
  });

  it('creates the claim_lines and claims indexes', () => {
    const idx = db
      .getAllSync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='index'"
      )
      .map(r => r.name);
    expect(idx).toEqual(expect.arrayContaining([
      'idx_claim_lines_session', 'idx_claim_lines_claim', 'idx_claims_voided',
    ]));
  });

  it('is idempotent — re-running migration 006 is a no-op', () => {
    const { MIGRATION_006_CLAIMS } = require('../migrations');
    const before = colNames('claims').length;
    // Re-run directly against the same db; guards must prevent duplicate work / errors.
    expect(() => MIGRATION_006_CLAIMS.run(db)).not.toThrow();
    expect(colNames('claims').length).toBe(before);
    // And via the runner (already recorded → skipped, no throw).
    expect(() => runMigrations(allMigrations())).not.toThrow();
  });
});
