import { createMigratedTestDb, resetDbSingleton } from './testDb';
import type { TestDb } from './testDb';
import {
  createStudent,
  updateStudent,
  getStudent,
  archiveStudent,
  listArchivedStudents,
  restoreStudent,
  createAdjustment,
} from '../students';
import { createScheduled } from '../sessions';

let db: TestDb;

beforeEach(() => { db = createMigratedTestDb(); });
afterEach(() => resetDbSingleton());

function newStudent(name = 'Alice') {
  return createStudent({ fullName: name, grade: 10, subject: 'Maths', curriculum: 'CAPS' });
}

describe('parent contact fields', () => {
  it('createStudent stores parent name and phone', () => {
    const s = createStudent({
      fullName: 'Alice', grade: 10, subject: 'Maths', curriculum: 'CAPS',
      parentName: 'Mrs Botha', parentPhone: '082 123 4567',
    });
    expect(s.parent_name).toBe('Mrs Botha');
    expect(getStudent(s.id)?.parent_phone).toBe('082 123 4567');
  });

  it('defaults parent fields to null', () => {
    const s = newStudent();
    expect(getStudent(s.id)?.parent_name).toBeNull();
    expect(getStudent(s.id)?.parent_phone).toBeNull();
  });

  it('updateStudent preserves parent fields when omitted and updates when given', () => {
    const s = createStudent({
      fullName: 'Alice', grade: 10, subject: 'Maths', curriculum: 'CAPS', parentName: 'Mrs B', parentPhone: '0821',
    });
    updateStudent(s.id, { fullName: 'Alice B', grade: 11, subject: 'Maths', curriculum: 'CAPS' });
    expect(getStudent(s.id)?.parent_name).toBe('Mrs B');
    updateStudent(s.id, { fullName: 'Alice B', grade: 11, subject: 'Maths', curriculum: 'CAPS', parentPhone: null });
    expect(getStudent(s.id)?.parent_phone).toBeNull();
  });
});

describe('archive / restore', () => {
  it('archiving cancels all scheduled lessons and returns the count', () => {
    const s = newStudent();
    createScheduled({ studentId: s.id, scheduledFor: '2099-01-01T08:00:00.000Z', estimatedDurationMinutes: 60, mode: 'in_person', session_type: 'general' });
    createScheduled({ studentId: s.id, scheduledFor: '2099-01-02T08:00:00.000Z', estimatedDurationMinutes: 60, mode: 'in_person', session_type: 'general' });
    const result = archiveStudent(s.id);
    expect(result.cancelledLessons).toBe(2);
    const rows = db.getAllSync<{ status: string; cancel_reason: string }>('SELECT status, cancel_reason FROM sessions');
    expect(rows.every(r => r.status === 'cancelled' && r.cancel_reason === 'student_archived')).toBe(true);
  });

  it('listArchivedStudents returns archived students with balance', () => {
    const a = newStudent('Alice');
    newStudent('Bob');
    db.runSync(
      `INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, created_at) VALUES ('t', ?, 'top_up', 3, 3, '2026-01-01')`,
      [a.id]
    );
    archiveStudent(a.id);
    const list = listArchivedStudents();
    expect(list.map(s => s.id)).toEqual([a.id]);
    expect(list[0].current_balance).toBe(3);
  });

  it('restoreStudent moves an archived student back to active', () => {
    const a = newStudent();
    archiveStudent(a.id);
    expect(getStudent(a.id)).toBeNull();
    restoreStudent(a.id);
    expect(getStudent(a.id)?.status).toBe('active');
  });

  it('restoreStudent throws for a non-archived student', () => {
    const a = newStudent();
    expect(() => restoreStudent(a.id)).toThrow();
  });
});

describe('createAdjustment', () => {
  it('appends a positive adjustment with reason', () => {
    const a = newStudent();
    const entry = createAdjustment({ studentId: a.id, hoursDelta: 1.5, reason: 'Goodwill credit' });
    expect(entry.type).toBe('adjustment');
    expect(entry.hours_delta).toBe(1.5);
    expect(entry.balance_after).toBe(1.5);
    expect(entry.reason).toBe('Goodwill credit');
  });

  it('appends a negative adjustment', () => {
    const a = newStudent();
    const entry = createAdjustment({ studentId: a.id, hoursDelta: -0.5, reason: 'Correction' });
    expect(entry.balance_after).toBe(-0.5);
  });

  it('rejects empty reason, zero or non-finite delta, unknown student', () => {
    const a = newStudent();
    expect(() => createAdjustment({ studentId: a.id, hoursDelta: 1, reason: '  ' })).toThrow();
    expect(() => createAdjustment({ studentId: a.id, hoursDelta: 0, reason: 'x' })).toThrow();
    expect(() => createAdjustment({ studentId: a.id, hoursDelta: NaN, reason: 'x' })).toThrow();
    expect(() => createAdjustment({ studentId: 'nope', hoursDelta: 1, reason: 'x' })).toThrow();
    expect(db.getAllSync('SELECT id FROM ledger_entries')).toHaveLength(0);
  });
});
