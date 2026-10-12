import { createTestDb, createMigratedTestDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import {
  runMigrations,
  ALL_MIGRATIONS,
  MIGRATION_007_AUDIT_REMEDIATION,
  MIGRATION_008_CONTACTS_REFERENCE,
} from '../migrations';
import { createStudent, getStudent, updateStudent } from '../students';
import { getOrCreateTutorProfile, upsertTutorProfile } from '../tutorProfile';
import { DEFAULT_PAYMENT_REFERENCE_TEMPLATE } from '../../utils/paymentReference';

const NOW = '2026-01-01T10:00:00.000Z';

function colNames(db: TestDb, table: string): string[] {
  return db.getAllSync<{ name: string }>(`PRAGMA table_info(${table})`).map(r => r.name);
}

describe('migration 008 — student contact + payment reference', () => {
  afterEach(() => resetDbSingleton());

  it('is the last migration and follows 007', () => {
    const idx = ALL_MIGRATIONS.indexOf(MIGRATION_008_CONTACTS_REFERENCE);
    expect(idx).toBe(ALL_MIGRATIONS.length - 1);
    expect(ALL_MIGRATIONS[idx - 1]).toBe(MIGRATION_007_AUDIT_REMEDIATION);
    expect(MIGRATION_008_CONTACTS_REFERENCE.version).toBe('008_contacts_reference');
  });

  it('upgrades a 007 database without touching existing data', () => {
    const db = createTestDb();
    runMigrations(ALL_MIGRATIONS.slice(0, ALL_MIGRATIONS.indexOf(MIGRATION_008_CONTACTS_REFERENCE)));
    expect(colNames(db, 'students')).not.toContain('student_phone');

    db.runSync(
      `INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at, parent_name, parent_phone)
       VALUES ('stu-1', 'Amahle Dlamini', 10, 'Maths', 'CAPS', 'active', ?, 'Thandi Dlamini', '0821234567')`,
      [NOW]
    );
    db.runSync(
      `INSERT INTO tutor_profile (id, full_name, created_at, updated_at, payment_details) VALUES ('tp', 'Jane', ?, ?, 'FNB 123')`,
      [NOW, NOW]
    );

    runMigrations([MIGRATION_008_CONTACTS_REFERENCE]);

    const s = db.getFirstSync<Record<string, unknown>>(`SELECT * FROM students WHERE id = 'stu-1'`);
    expect(s).toMatchObject({
      full_name: 'Amahle Dlamini',
      parent_name: 'Thandi Dlamini',
      parent_phone: '0821234567',
      student_phone: null,
      preferred_contact: 'parent',
    });
    const tp = db.getFirstSync<Record<string, unknown>>(`SELECT * FROM tutor_profile WHERE id = 'tp'`);
    expect(tp).toMatchObject({ payment_details: 'FNB 123', payment_reference_template: DEFAULT_PAYMENT_REFERENCE_TEMPLATE });
  });

  it('is idempotent when the columns already exist', () => {
    const db = createMigratedTestDb();
    db.runSync(`DELETE FROM schema_migrations WHERE version = '008_contacts_reference'`);
    expect(() => runMigrations([MIGRATION_008_CONTACTS_REFERENCE])).not.toThrow();
    expect(colNames(db, 'students').filter(c => c === 'student_phone')).toHaveLength(1);
  });

  it('rejects an unknown preferred_contact', () => {
    const db = createMigratedTestDb();
    expect(() =>
      db.runSync(
        `INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at, preferred_contact)
         VALUES ('x', 'X', 10, 'Maths', 'CAPS', 'active', ?, 'uncle')`,
        [NOW]
      )
    ).toThrow();
  });
});

describe('students.ts — student contact fields', () => {
  beforeEach(() => createMigratedTestDb());
  afterEach(() => resetDbSingleton());

  const base = { fullName: 'Amahle Dlamini', grade: 10, subject: 'Maths', curriculum: 'CAPS' as const };

  it('creates with student phone and preferred contact', () => {
    const s = createStudent({ ...base, studentPhone: ' 0831112222 ', preferredContact: 'student' });
    expect(s.student_phone).toBe('0831112222');
    expect(s.preferred_contact).toBe('student');
    expect(getStudent(s.id)).toMatchObject({ student_phone: '0831112222', preferred_contact: 'student' });
  });

  it('defaults preferred contact to parent', () => {
    const s = createStudent(base);
    expect(getStudent(s.id)).toMatchObject({ student_phone: null, preferred_contact: 'parent' });
  });

  it('update keeps student contact when omitted and clears on blank', () => {
    const s = createStudent({ ...base, studentPhone: '0831112222', preferredContact: 'student' });
    updateStudent(s.id, { ...base, fullName: 'Amahle D' });
    expect(getStudent(s.id)).toMatchObject({ student_phone: '0831112222', preferred_contact: 'student' });
    updateStudent(s.id, { ...base, studentPhone: '', preferredContact: 'parent' });
    expect(getStudent(s.id)).toMatchObject({ student_phone: null, preferred_contact: 'parent' });
  });
});

describe('tutorProfile.ts — payment reference template', () => {
  beforeEach(() => createMigratedTestDb());
  afterEach(() => resetDbSingleton());

  it('new profile gets the default template and saves edits', () => {
    const p = getOrCreateTutorProfile();
    expect(p.payment_reference_template).toBe(DEFAULT_PAYMENT_REFERENCE_TEMPLATE);
    const saved = upsertTutorProfile({ payment_reference_template: '{SURNAME}{initial}' });
    expect(saved.payment_reference_template).toBe('{SURNAME}{initial}');
    expect(getOrCreateTutorProfile().payment_reference_template).toBe('{SURNAME}{initial}');
  });
});
