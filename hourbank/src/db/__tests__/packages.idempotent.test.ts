import { createMigratedTestDb, resetDbSingleton } from './testDb';
import { createStudent } from '../students';
import { createPackage } from '../packages';
import { currentBalance } from '../ledger';

beforeEach(() => { createMigratedTestDb(); });
afterEach(() => resetDbSingleton());

function student(name = 'Ana') {
  return createStudent({ fullName: name, grade: 10, subject: 'Maths', curriculum: 'CAPS' });
}

describe('createPackage with a caller-supplied id', () => {
  it('credits once even when submitted twice', () => {
    const s = student();
    const first = createPackage({ id: 'pkg-1', studentId: s.id, hoursAdded: 10, amountPaid: 5500, paymentMethod: 'eft' });
    const second = createPackage({ id: 'pkg-1', studentId: s.id, hoursAdded: 10, amountPaid: 5500, paymentMethod: 'eft' });
    expect(second.pkg.id).toBe('pkg-1');
    expect(second.entry.id).toBe(first.entry.id);
    expect(currentBalance(s.id)).toBe(10);
  });

  it('refuses to reuse an id for another student', () => {
    const a = student('Ana');
    const b = student('Ben');
    createPackage({ id: 'pkg-2', studentId: a.id, hoursAdded: 5, amountPaid: 3000, paymentMethod: 'cash' });
    expect(() =>
      createPackage({ id: 'pkg-2', studentId: b.id, hoursAdded: 5, amountPaid: 3000, paymentMethod: 'cash' })
    ).toThrow(/already exists/);
    expect(currentBalance(b.id)).toBe(0);
  });

  it('still generates an id when none is given', () => {
    const s = student();
    const r = createPackage({ studentId: s.id, hoursAdded: 2, amountPaid: 1200, paymentMethod: 'card' });
    expect(r.pkg.id).toEqual(expect.any(String));
    expect(r.entry.related_package_id).toBe(r.pkg.id);
  });
});
