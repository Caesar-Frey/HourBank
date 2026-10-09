import { createTestDb, createMigratedTestDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import {
  runMigrations,
  ALL_MIGRATIONS,
  MIGRATION_002,
  MIGRATION_003_SESSION_TYPE,
  MIGRATION_004_CALENDAR_EVENTS,
  MIGRATION_005_LEDGER_CONSTRAINTS,
  MIGRATION_006_CLAIMS,
  MIGRATION_007_AUDIT_REMEDIATION,
  suspendLedgerGuards,
} from '../migrations';

const NOW = '2026-01-01T10:00:00.000Z';

function colNames(db: TestDb, table: string): string[] {
  return db.getAllSync<{ name: string }>(`PRAGMA table_info(${table})`).map(r => r.name);
}

function insertStudent(db: TestDb, id = 'stu-1') {
  db.runSync(
    `INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at) VALUES (?, 'Alice', 10, 'Maths', 'CAPS', 'active', ?)`,
    [id, NOW]
  );
}

function insertLedger(db: TestDb, id: string, type: string, delta: number, reason: string | null = null, sessionId: string | null = null) {
  db.runSync(
    `INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, related_session_id, reason, created_at)
     VALUES (?, 'stu-1', ?, ?, 0, ?, ?, ?)`,
    [id, type, delta, sessionId, reason, NOW]
  );
}

describe('ALL_MIGRATIONS', () => {
  it('ends with migration 007', () => {
    expect(ALL_MIGRATIONS[ALL_MIGRATIONS.length - 1]).toBe(MIGRATION_007_AUDIT_REMEDIATION);
    expect(MIGRATION_007_AUDIT_REMEDIATION.version).toBe('007_audit_remediation');
  });
});

describe('runner — foreign keys off for table-rebuild migrations', () => {
  afterEach(() => resetDbSingleton());

  it('preserves ledger_entries.related_session_id when 002 rebuilds sessions (v1 upgrade)', () => {
    const db = createTestDb(); // v1-shaped schema, no migrations yet
    insertStudent(db);
    db.runSync(
      `INSERT INTO sessions (id, student_id, mode, topics, status, started_at, ended_at, duration_minutes, created_at)
       VALUES ('sess-1', 'stu-1', 'in_person', '[]', 'completed', ?, ?, 60, ?)`,
      [NOW, NOW, NOW]
    );
    insertLedger(db, 'le-1', 'session_deduction', -1, null, 'sess-1');

    runMigrations(ALL_MIGRATIONS);

    const row = db.getFirstSync<{ related_session_id: string | null }>(
      `SELECT related_session_id FROM ledger_entries WHERE id = 'le-1'`
    );
    expect(row?.related_session_id).toBe('sess-1');
  });

  it('re-enables foreign keys after a foreignKeysOff migration', () => {
    const db = createTestDb();
    runMigrations(ALL_MIGRATIONS);
    const fk = db.getFirstSync<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(fk?.foreign_keys).toBe(1);
  });

  it('re-enables foreign keys even when the migration throws', () => {
    const db = createTestDb();
    expect(() =>
      runMigrations([{ version: 'bad', foreignKeysOff: true, run: () => { throw new Error('boom'); } }])
    ).toThrow('boom');
    const fk = db.getFirstSync<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(fk?.foreign_keys).toBe(1);
    const rec = db.getFirstSync(`SELECT version FROM schema_migrations WHERE version = 'bad'`);
    expect(rec).toBeNull();
  });

  it('marks 002 as a foreignKeysOff migration', () => {
    expect(MIGRATION_002.foreignKeysOff).toBe(true);
  });
});

describe('migration 007 — schema effects', () => {
  let db: TestDb;
  beforeEach(() => {
    db = createMigratedTestDb();
    insertStudent(db);
  });
  afterEach(() => resetDbSingleton());

  it('adds parent contact columns to students', () => {
    expect(colNames(db, 'students')).toEqual(expect.arrayContaining(['parent_name', 'parent_phone']));
  });

  it('adds parent_hourly_price, payment_details, billing_round_minutes to tutor_profile', () => {
    expect(colNames(db, 'tutor_profile')).toEqual(
      expect.arrayContaining(['parent_hourly_price', 'payment_details', 'billing_round_minutes'])
    );
  });

  it('allows only one active-or-paused session (active + paused cannot coexist)', () => {
    db.runSync(`INSERT INTO sessions (id, student_id, status, started_at) VALUES ('a', 'stu-1', 'active', ?)`, [NOW]);
    expect(() =>
      db.runSync(`INSERT INTO sessions (id, student_id, status, started_at, paused_at) VALUES ('b', 'stu-1', 'paused', ?, ?)`, [NOW, NOW])
    ).toThrow(/UNIQUE/);
  });

  it('still allows many scheduled sessions', () => {
    db.runSync(`INSERT INTO sessions (id, student_id, status) VALUES ('a', 'stu-1', 'scheduled')`);
    db.runSync(`INSERT INTO sessions (id, student_id, status) VALUES ('b', 'stu-1', 'scheduled')`);
    expect(db.getAllSync('SELECT id FROM sessions')).toHaveLength(2);
  });

  it('blocks UPDATE on ledger_entries', () => {
    insertLedger(db, 'le-1', 'top_up', 5);
    expect(() => db.runSync(`UPDATE ledger_entries SET hours_delta = 50 WHERE id = 'le-1'`)).toThrow(/append-only/);
  });

  it('blocks DELETE on ledger_entries', () => {
    insertLedger(db, 'le-1', 'top_up', 5);
    expect(() => db.runSync(`DELETE FROM ledger_entries WHERE id = 'le-1'`)).toThrow(/append-only/);
  });

  it('allows a positive adjustment with a reason', () => {
    expect(() => insertLedger(db, 'le-1', 'adjustment', 2, 'Credit for cancelled lesson')).not.toThrow();
  });

  it('allows a negative adjustment with a reason', () => {
    expect(() => insertLedger(db, 'le-1', 'adjustment', -2, 'Double top-up')).not.toThrow();
  });

  it('rejects an adjustment without a reason', () => {
    expect(() => insertLedger(db, 'le-1', 'adjustment', 2, null)).toThrow(/reason/);
    expect(() => insertLedger(db, 'le-2', 'adjustment', 2, '   ')).toThrow(/reason/);
  });

  it('still rejects a positive session_deduction', () => {
    expect(() => insertLedger(db, 'le-1', 'session_deduction', 1)).toThrow();
  });

  it('protects session-linked ledger rows: deleting a session is blocked', () => {
    db.runSync(`INSERT INTO sessions (id, student_id, status) VALUES ('s1', 'stu-1', 'completed')`);
    insertLedger(db, 'le-1', 'session_deduction', -1, null, 's1');
    expect(() => db.runSync(`DELETE FROM sessions WHERE id = 's1'`)).toThrow();
  });

  it('suspendLedgerGuards allows a full wipe and restores the guards afterwards', () => {
    insertLedger(db, 'le-1', 'top_up', 5);
    suspendLedgerGuards(() => {
      db.runSync('DELETE FROM ledger_entries');
    });
    expect(db.getAllSync('SELECT id FROM ledger_entries')).toHaveLength(0);
    insertLedger(db, 'le-2', 'top_up', 5);
    expect(() => db.runSync(`DELETE FROM ledger_entries WHERE id = 'le-2'`)).toThrow(/append-only/);
  });
});

describe('migration 007 — upgrade of existing data', () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb();
    runMigrations([MIGRATION_002, MIGRATION_003_SESSION_TYPE, MIGRATION_004_CALENDAR_EVENTS, MIGRATION_005_LEDGER_CONSTRAINTS, MIGRATION_006_CLAIMS]);
    insertStudent(db);
  });
  afterEach(() => resetDbSingleton());

  it('defaults parent_hourly_price to the existing hourly_rate', () => {
    db.runSync(
      `INSERT INTO tutor_profile (id, full_name, hourly_rate, created_at, updated_at) VALUES ('p1', '', 450, ?, ?)`,
      [NOW, NOW]
    );
    runMigrations([MIGRATION_007_AUDIT_REMEDIATION]);
    const row = db.getFirstSync<{ parent_hourly_price: number; billing_round_minutes: number; payment_details: string | null }>(
      'SELECT parent_hourly_price, billing_round_minutes, payment_details FROM tutor_profile'
    );
    expect(row?.parent_hourly_price).toBe(450);
    expect(row?.billing_round_minutes).toBe(15);
    expect(row?.payment_details).toBeNull();
  });

  it('resolves a pre-existing active + paused pair, keeping the most recently started', () => {
    db.runSync(`INSERT INTO sessions (id, student_id, status, started_at) VALUES ('old', 'stu-1', 'paused', '2026-01-01T08:00:00.000Z')`);
    db.runSync(`INSERT INTO sessions (id, student_id, status, started_at) VALUES ('new', 'stu-1', 'active', '2026-01-01T09:00:00.000Z')`);
    runMigrations([MIGRATION_007_AUDIT_REMEDIATION]);
    const rows = db.getAllSync<{ id: string; status: string; cancel_reason: string | null }>(
      'SELECT id, status, cancel_reason FROM sessions ORDER BY id'
    );
    expect(rows).toEqual([
      { id: 'new', status: 'active', cancel_reason: null },
      { id: 'old', status: 'cancelled', cancel_reason: 'discarded' },
    ]);
  });

  it('cancels orphaned never-started unscheduled rows', () => {
    db.runSync(`INSERT INTO sessions (id, student_id, status, scheduled_for, started_at) VALUES ('orphan', 'stu-1', 'scheduled', NULL, NULL)`);
    db.runSync(`INSERT INTO sessions (id, student_id, status, scheduled_for) VALUES ('real', 'stu-1', 'scheduled', ?)`, [NOW]);
    runMigrations([MIGRATION_007_AUDIT_REMEDIATION]);
    const rows = db.getAllSync<{ id: string; status: string; cancel_reason: string | null }>(
      'SELECT id, status, cancel_reason FROM sessions ORDER BY id'
    );
    expect(rows).toEqual([
      { id: 'orphan', status: 'cancelled', cancel_reason: 'discarded' },
      { id: 'real', status: 'scheduled', cancel_reason: null },
    ]);
  });

  it('is idempotent when run directly twice', () => {
    runMigrations([MIGRATION_007_AUDIT_REMEDIATION]);
    const m = MIGRATION_007_AUDIT_REMEDIATION as { run: (d: unknown) => void };
    expect(() => m.run(db)).not.toThrow();
  });
});
