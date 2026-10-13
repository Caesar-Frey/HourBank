import { createTestDb, createMigratedTestDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import {
  runMigrations,
  ALL_MIGRATIONS,
  MIGRATION_008_CONTACTS_REFERENCE,
  MIGRATION_009_SUBJECTS_TRAVEL,
  suspendLedgerGuards,
} from '../migrations';

const T0 = '2026-09-01T08:00:00.000Z';

function colNames(db: TestDb, table: string): string[] {
  return db.getAllSync<{ name: string }>(`PRAGMA table_info(${table})`).map(r => r.name);
}

function balancesByStudent(db: TestDb): Record<string, number> {
  const rows = db.getAllSync<{ student_id: string; b: number }>(
    'SELECT student_id, SUM(hours_delta) AS b FROM ledger_entries GROUP BY student_id'
  );
  return Object.fromEntries(rows.map(r => [r.student_id, Math.round(r.b * 1e6) / 1e6]));
}

/** A realistic 008-era database: 3 students, top-ups, lessons, no-show, adjustment, claim. */
function populate008(db: TestDb): void {
  const ins = (sql: string, p: (string | number | null)[] = []) => db.runSync(sql, p);
  ins(`INSERT INTO tutor_profile (id, full_name, created_at, updated_at, travel_mode, per_km_rate)
       VALUES ('tp', 'Jane', ?, ?, 'distance', 4.5)`, [T0, T0]);
  ins(`INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at, travel_distance_km, travel_flat_fee)
       VALUES ('a', 'Amahle', 10, 'Maths', 'CAPS', 'active', ?, 12, 50)`, [T0]);
  ins(`INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at)
       VALUES ('b', 'Bongani', 12, 'Physical Sciences', 'IEB', 'paused', ?)`, [T0]);
  ins(`INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at)
       VALUES ('c', 'Chloe', 8, 'English', 'CAPS', 'archived', ?)`, [T0]);
  for (const [id, sid, hrs] of [['pa', 'a', 10], ['pb', 'b', 5], ['pc', 'c', 2]] as const) {
    ins(`INSERT INTO credit_packages (id, student_id, hours_added, amount_paid, created_at) VALUES (?, ?, ?, 600, ?)`, [id, sid, hrs, T0]);
    ins(`INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, related_package_id, created_at)
         VALUES (?, ?, 'top_up', ?, ?, ?, ?)`, [`le-${id}`, sid, hrs, hrs, id, T0]);
  }
  ins(`INSERT INTO sessions (id, student_id, status, started_at, ended_at, duration_minutes, billed_minutes, created_at)
       VALUES ('sa1', 'a', 'completed', '2026-09-02T10:00:00.000Z', '2026-09-02T11:30:00.000Z', 90, 90, ?)`, [T0]);
  ins(`INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, related_session_id, created_at)
       VALUES ('le-sa1', 'a', 'session_deduction', -1.5, 8.5, 'sa1', '2026-09-02T11:30:00.000Z')`);
  ins(`INSERT INTO sessions (id, student_id, status, cancel_reason, scheduled_for, billed_minutes, created_at)
       VALUES ('sb1', 'b', 'cancelled', 'no_show', '2026-09-03T10:00:00.000Z', 60, ?)`, [T0]);
  ins(`INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, related_session_id, reason, created_at)
       VALUES ('le-sb1', 'b', 'session_deduction', -1, 4, 'sb1', 'No-show', '2026-09-03T11:00:00.000Z')`);
  ins(`INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, reason, created_at)
       VALUES ('le-adj', 'c', 'adjustment', -0.5, 1.5, 'Double top-up', '2026-09-04T09:00:00.000Z')`);
  ins(`INSERT INTO sessions (id, student_id, status, scheduled_for, estimated_duration_minutes, created_at)
       VALUES ('sa2', 'a', 'scheduled', '2026-12-01T10:00:00.000Z', 60, ?)`, [T0]);
  ins(`INSERT INTO claims (id, payout_rate, lesson_fee_total, travel_total, grand_total, created_at)
       VALUES ('cl1', 300, 450, 0, 450, ?)`, [T0]);
  ins(`INSERT INTO claim_lines (id, claim_id, session_id, billed_hours, mode, lesson_fee, travel_fee, created_at)
       VALUES ('cll1', 'cl1', 'sa1', 1.5, 'in_person', 450, 0, ?)`, [T0]);
}

const PRE_009 = ALL_MIGRATIONS.slice(0, ALL_MIGRATIONS.indexOf(MIGRATION_009_SUBJECTS_TRAVEL));

describe('migration 009 — subjects, editable lessons, travel billing', () => {
  afterEach(() => resetDbSingleton());

  it('is the last migration and follows 008', () => {
    const idx = ALL_MIGRATIONS.indexOf(MIGRATION_009_SUBJECTS_TRAVEL);
    expect(ALL_MIGRATIONS[idx - 1]).toBe(MIGRATION_008_CONTACTS_REFERENCE);
    expect(MIGRATION_009_SUBJECTS_TRAVEL.version).toBe('009_subjects_travel');
  });

  describe('upgrade from a populated 008 database', () => {
    let db: TestDb;
    let before: Record<string, number>;
    const counts = (d: TestDb) => Object.fromEntries(
      ['students', 'sessions', 'credit_packages', 'ledger_entries', 'claims', 'claim_lines'].map(t => [
        t, d.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n,
      ])
    );
    let countsBefore: Record<string, number>;

    beforeEach(() => {
      db = createTestDb();
      runMigrations(PRE_009);
      populate008(db);
      before = balancesByStudent(db);
      countsBefore = counts(db);
      runMigrations([MIGRATION_009_SUBJECTS_TRAVEL]);
    });

    it('loses no rows', () => {
      expect(counts(db)).toEqual(countsBefore);
    });

    it('creates exactly one subject per student (incl. paused/archived) from students.subject', () => {
      const rows = db.getAllSync<{ id: string; student_id: string; subject: string; status: string; grade: number | null }>(
        'SELECT id, student_id, subject, status, grade FROM student_subjects ORDER BY student_id'
      );
      expect(rows).toEqual([
        { id: 'ss-a', student_id: 'a', subject: 'Maths', status: 'active', grade: null },
        { id: 'ss-b', student_id: 'b', subject: 'Physical Sciences', status: 'active', grade: null },
        { id: 'ss-c', student_id: 'c', subject: 'English', status: 'active', grade: null },
      ]);
    });

    it('backfills subject_id on every session, package and ledger row', () => {
      for (const t of ['sessions', 'credit_packages', 'ledger_entries']) {
        const nulls = db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE subject_id IS NULL`)!.n;
        expect({ t, nulls }).toEqual({ t, nulls: 0 });
        const wrong = db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE subject_id != 'ss-' || student_id`)!.n;
        expect(wrong).toBe(0);
      }
    });

    it('keeps every student balance: sum of subject balances == old balance', () => {
      expect(balancesByStudent(db)).toEqual(before);
      const view = db.getAllSync<{ student_id: string; total: number }>(
        'SELECT student_id, SUM(balance_hours) AS total FROM student_subject_balances GROUP BY student_id'
      );
      expect(Object.fromEntries(view.map(v => [v.student_id, Math.round(v.total * 1e6) / 1e6]))).toEqual(before);
      expect(before).toEqual({ a: 8.5, b: 4, c: 1.5 });
    });

    it('adds lesson travel/edit columns and travel billing start', () => {
      expect(colNames(db, 'sessions')).toEqual(expect.arrayContaining(['subject_id', 'travel_km', 'edited_at']));
      const s = db.getFirstSync<{ travel_km: number | null; edited_at: string | null }>(`SELECT travel_km, edited_at FROM sessions WHERE id = 'sa1'`);
      expect(s).toEqual({ travel_km: null, edited_at: null });
      expect(db.getFirstSync(`SELECT parent_travel_fee FROM sessions WHERE id = 'sa1'`)).toEqual({ parent_travel_fee: null });
      expect(colNames(db, 'travel_settlements')).toEqual(
        expect.arrayContaining(['id', 'student_id', 'amount', 'payment_method', 'package_id', 'note', 'created_at'])
      );
    });

    it("seeds each student's parent travel rate from the tutor's travel config", () => {
      const rows = db.getAllSync<{ id: string; parent_travel_mode: string; parent_travel_flat_fee: number; parent_travel_per_km: number }>(
        'SELECT id, parent_travel_mode, parent_travel_flat_fee, parent_travel_per_km FROM students ORDER BY id'
      );
      expect(rows).toEqual([
        { id: 'a', parent_travel_mode: 'per_km', parent_travel_flat_fee: 50, parent_travel_per_km: 4.5 },
        { id: 'b', parent_travel_mode: 'per_km', parent_travel_flat_fee: 0, parent_travel_per_km: 4.5 },
        { id: 'c', parent_travel_mode: 'per_km', parent_travel_flat_fee: 0, parent_travel_per_km: 4.5 },
      ]);
    });

    it('leaves claims untouched', () => {
      expect(db.getFirstSync('SELECT session_id, travel_fee FROM claim_lines')).toEqual({ session_id: 'sa1', travel_fee: 0 });
    });
  });

  describe('ledger guard', () => {
    let db: TestDb;
    beforeEach(() => {
      db = createTestDb();
      runMigrations(PRE_009);
      populate008(db);
      runMigrations([MIGRATION_009_SUBJECTS_TRAVEL]);
      db.runSync(`INSERT INTO student_subjects (id, student_id, subject, status, sort_order, created_at) VALUES ('ss-a2', 'a', 'Science', 'active', 1, ?)`, [T0]);
    });

    it('allows a session_deduction hours_delta + subject_id edit', () => {
      db.runSync(`UPDATE ledger_entries SET hours_delta = -1, subject_id = 'ss-a2', updated_at = ? WHERE id = 'le-sa1'`, [T0]);
      expect(db.getFirstSync(`SELECT hours_delta, subject_id FROM ledger_entries WHERE id = 'le-sa1'`)).toEqual({ hours_delta: -1, subject_id: 'ss-a2' });
    });

    it('rejects a deduction edit that makes hours_delta non-negative', () => {
      expect(() => db.runSync(`UPDATE ledger_entries SET hours_delta = 0 WHERE id = 'le-sa1'`)).toThrow(/append-only/);
      expect(() => db.runSync(`UPDATE ledger_entries SET hours_delta = 1 WHERE id = 'le-sa1'`)).toThrow(/append-only/);
    });

    it('rejects edits to any other deduction column', () => {
      expect(() => db.runSync(`UPDATE ledger_entries SET balance_after = 0 WHERE id = 'le-sa1'`)).toThrow(/append-only/);
      expect(() => db.runSync(`UPDATE ledger_entries SET created_at = ? WHERE id = 'le-sa1'`, [T0])).toThrow(/append-only/);
      expect(() => db.runSync(`UPDATE ledger_entries SET student_id = 'b' WHERE id = 'le-sa1'`)).toThrow(/append-only/);
      expect(() => db.runSync(`UPDATE ledger_entries SET type = 'adjustment' WHERE id = 'le-sa1'`)).toThrow(/append-only/);
      expect(() => db.runSync(`UPDATE ledger_entries SET related_session_id = NULL WHERE id = 'le-sa1'`)).toThrow(/append-only/);
    });

    it('still blocks UPDATE on top_up and adjustment rows', () => {
      expect(() => db.runSync(`UPDATE ledger_entries SET hours_delta = 50 WHERE id = 'le-pa'`)).toThrow(/append-only/);
      expect(() => db.runSync(`UPDATE ledger_entries SET subject_id = 'ss-a2' WHERE id = 'le-pa'`)).toThrow(/append-only/);
      expect(() => db.runSync(`UPDATE ledger_entries SET hours_delta = -2 WHERE id = 'le-adj'`)).toThrow(/append-only/);
    });

    it('still blocks DELETE on every row type', () => {
      for (const id of ['le-pa', 'le-sa1', 'le-adj']) {
        expect(() => db.runSync('DELETE FROM ledger_entries WHERE id = ?', [id])).toThrow(/append-only/);
      }
    });

    it('still blocks deleting a session whose deduction would be nulled', () => {
      expect(() => db.runSync(`DELETE FROM sessions WHERE id = 'sa1'`)).toThrow();
    });

    it('suspendLedgerGuards restores the 009 guard generation', () => {
      suspendLedgerGuards(() => undefined);
      const names = db.getAllSync<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'ledger_entries' ORDER BY name`
      ).map(r => r.name);
      expect(names).toContain('ledger_update_guard');
      expect(names).toContain('ledger_no_delete');
      expect(names).not.toContain('ledger_no_update');
      db.runSync(`UPDATE ledger_entries SET hours_delta = -1 WHERE id = 'le-sa1'`);
      expect(() => db.runSync(`UPDATE ledger_entries SET hours_delta = 50 WHERE id = 'le-pa'`)).toThrow(/append-only/);
    });
  });

  it('fresh install: full chain gives an empty, guarded 009 schema', () => {
    const db = createMigratedTestDb();
    expect(db.getAllSync('SELECT * FROM student_subjects')).toEqual([]);
    expect(db.getAllSync('SELECT * FROM student_subject_balances')).toEqual([]);
    expect(colNames(db, 'ledger_entries')).toContain('subject_id');
    expect(colNames(db, 'credit_packages')).toContain('subject_id');
    const triggers = db.getAllSync<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'ledger_entries'`).map(r => r.name);
    expect(triggers).toEqual(expect.arrayContaining(['ledger_update_guard', 'ledger_no_delete']));
    expect(triggers).not.toContain('ledger_no_update');
  });

  it('is idempotent when re-run on a migrated database', () => {
    const db = createTestDb();
    runMigrations(PRE_009);
    populate008(db);
    runMigrations([MIGRATION_009_SUBJECTS_TRAVEL]);
    db.runSync(`DELETE FROM schema_migrations WHERE version = '009_subjects_travel'`);
    expect(() => runMigrations([MIGRATION_009_SUBJECTS_TRAVEL])).not.toThrow();
    expect(db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM student_subjects')!.n).toBe(3);
    expect(balancesByStudent(db)).toEqual({ a: 8.5, b: 4, c: 1.5 });
  });
});

describe('migration 010 — travel rate snapshot', () => {
  afterEach(() => resetDbSingleton());

  it('upgrades a populated 009 DB: adds columns, backfills derivable lessons, idempotent', () => {
    const db = createTestDb();
    runMigrations(ALL_MIGRATIONS.slice(0, -1));
    const st = (id: string, mode: string, flat: number, perKm: number) =>
      db.runSync(`INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at, parent_travel_mode, parent_travel_flat_fee, parent_travel_per_km)
                  VALUES (?, ?, 10, 'Maths', 'CAPS', 'active', ?, ?, ?, ?)`, [id, id, T0, mode, flat, perKm]);
    st('pk', 'per_km', 0, 5); st('fl', 'flat', 80, 0); st('no', 'none', 0, 0);
    const ses = (id: string, sid: string, km: number | null, fee: number | null) =>
      db.runSync(`INSERT INTO sessions (id, student_id, status, mode, started_at, ended_at, billed_minutes, created_at, travel_km, parent_travel_fee)
                  VALUES (?, ?, 'completed', 'in_person', ?, ?, 60, ?, ?, ?)`, [id, sid, T0, T0, T0, km, fee]);
    ses('l1', 'pk', 10, 50); ses('l2', 'pk', 0, 40); ses('l3', 'fl', 7, 80); ses('l4', 'no', 5, null); ses('l5', 'pk', 10, null);
    runMigrations(ALL_MIGRATIONS);
    runMigrations(ALL_MIGRATIONS);
    const rows = db.getAllSync<Record<string, unknown>>(
      `SELECT id, parent_travel_mode_snapshot AS m, parent_travel_flat_snapshot AS f, parent_travel_per_km_snapshot AS k
       FROM sessions ORDER BY id`
    );
    expect(rows).toEqual([
      { id: 'l1', m: 'per_km', f: 0, k: 5 },
      { id: 'l2', m: null, f: null, k: null },
      { id: 'l3', m: 'flat', f: 80, k: 0 },
      { id: 'l4', m: null, f: null, k: null },
      { id: 'l5', m: null, f: null, k: null },
    ]);
  });
});
