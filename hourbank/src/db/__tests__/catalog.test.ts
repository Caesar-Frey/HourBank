/**
 * catalog.test.ts — TDD tests for src/db/catalog.ts
 *
 * Tests run in order:
 *  1. seedCatalog seeds subjects when table is empty
 *  2. seedCatalog is idempotent
 *  3. listSubjects returns seeded subjects
 *  4. listAllTopics returns topics
 *  5. listCurricula returns curricula
 */

import { createTestDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import { runMigrations, MIGRATION_002 } from '../migrations';
import {
  seedCatalog,
  listSubjects,
  listAllTopics,
  listTopicsForSubject,
  listCurricula,
} from '../catalog';

describe('catalog', () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb();
    // Run migration 002 so subjects/topics/curricula tables exist.
    runMigrations([MIGRATION_002]);
  });

  afterEach(() => {
    resetDbSingleton();
  });

  it('seedCatalog seeds subjects when table is empty', () => {
    seedCatalog();
    const subjects = listSubjects();
    expect(subjects.length).toBeGreaterThan(0);
    const names = subjects.map(s => s.name);
    expect(names).toContain('Mathematics');
    expect(names).toContain('Physics');
    expect(names).toContain('English');
  });

  it('seedCatalog is idempotent — calling twice does not duplicate subjects', () => {
    seedCatalog();
    const countAfterFirst = listSubjects().length;
    seedCatalog();
    const countAfterSecond = listSubjects().length;
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it('listSubjects returns seeded subjects with required fields', () => {
    seedCatalog();
    const subjects = listSubjects();
    expect(subjects.length).toBeGreaterThan(0);
    const first = subjects[0];
    expect(typeof first.id).toBe('string');
    expect(typeof first.name).toBe('string');
    expect(typeof first.sort_order).toBe('number');
    expect(typeof first.created_at).toBe('string');
    expect(typeof first.updated_at).toBe('string');
  });

  it('listAllTopics returns topics for seeded subjects', () => {
    seedCatalog();
    const topics = listAllTopics();
    expect(topics.length).toBeGreaterThan(0);
    const first = topics[0];
    expect(typeof first.id).toBe('string');
    expect(typeof first.subject_id).toBe('string');
    expect(typeof first.name).toBe('string');
  });

  it('listCurricula returns CAPS, IEB, Cambridge, Other', () => {
    seedCatalog();
    const curricula = listCurricula();
    const names = curricula.map(c => c.name);
    expect(names).toContain('CAPS');
    expect(names).toContain('IEB');
    expect(names).toContain('Cambridge');
    expect(names).toContain('Other');
  });
});
