import { createMigratedTestDb, resetDbSingleton } from '../../../db/__tests__/testDb';
import { createStudent } from '../../../db/students';
import { recordLesson } from '../../../db/sessions';
import { createPackage } from '../../../db/packages';
import { lessonKmBySession, topUpEntryIdForPackage } from '../moneyQueries';

const NOW = new Date('2026-10-12T15:00:00.000Z');

describe('moneyQueries', () => {
  beforeEach(() => { createMigratedTestDb(); });
  afterEach(() => resetDbSingleton());

  it('per-lesson km falls back to the student default', () => {
    const s = createStudent({ fullName: 'A B', grade: 10, subject: 'Maths', curriculum: 'CAPS', travelDistanceKm: 8 });
    const a = recordLesson({ studentId: s.id, startedAt: '2026-10-01T08:00:00.000Z', billedMinutes: 60, topics: [], mode: 'in_person', now: NOW }).session;
    const b = recordLesson({ studentId: s.id, startedAt: '2026-10-02T08:00:00.000Z', billedMinutes: 60, topics: [], mode: 'in_person', travelKm: 20, now: NOW }).session;
    const m = lessonKmBySession([a.id, b.id, 'nope']);
    expect(m.get(a.id)).toBe(8);
    expect(m.get(b.id)).toBe(20);
    expect(m.has('nope')).toBe(false);
    expect(lessonKmBySession([]).size).toBe(0);
  });

  it('finds the top-up ledger row for a package', () => {
    const s = createStudent({ fullName: 'A B', grade: 10, subject: 'Maths', curriculum: 'CAPS' });
    const { pkg, entry } = createPackage({ studentId: s.id, hoursAdded: 5, amountPaid: 100, paymentMethod: 'eft' });
    expect(topUpEntryIdForPackage(pkg.id)).toBe(entry.id);
    expect(topUpEntryIdForPackage('nope')).toBeNull();
  });
});
