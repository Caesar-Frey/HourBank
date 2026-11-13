/**
 * Work package C (2026-11-12 polish handoff) — data parts.
 */
import { createTestDb, createMigratedTestDb, resetDbSingleton } from './testDb';
import { runMigrations, ALL_MIGRATIONS, MIGRATION_013_POLISH_C } from '../migrations';
import { createStudent, getStudent, markReminded } from '../students';

const base = { fullName: 'Amahle Dlamini', grade: 10, subject: 'Maths', curriculum: 'CAPS' as const };

describe('migration 013 / C1 — last reminded', () => {
  afterEach(() => resetDbSingleton());

  it('adds students.last_reminded_at (NULL for existing students) and is idempotent', () => {
    const db = createTestDb();
    runMigrations(ALL_MIGRATIONS.slice(0, ALL_MIGRATIONS.indexOf(MIGRATION_013_POLISH_C)));
    const s = createStudent(base);
    runMigrations(ALL_MIGRATIONS);
    expect(getStudent(s.id)!.last_reminded_at).toBeNull();
    expect(() => 'run' in MIGRATION_013_POLISH_C && MIGRATION_013_POLISH_C.run(db as never)).not.toThrow();
  });

  it('markReminded stamps the student', () => {
    createMigratedTestDb();
    const s = createStudent(base);
    markReminded(s.id, new Date('2026-11-03T09:00:00.000Z'));
    expect(getStudent(s.id)!.last_reminded_at).toBe('2026-11-03T09:00:00.000Z');
  });
});
