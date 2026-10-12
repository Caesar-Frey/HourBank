process.env.TZ = 'Africa/Johannesburg';

jest.mock('expo-print', () => ({ printToFileAsync: jest.fn(async () => ({ uri: 'file:///tmp/print.pdf' })) }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => {}), isAvailableAsync: jest.fn(async () => true) }));
jest.mock('expo-file-system/legacy', () => ({
  __esModule: true,
  cacheDirectory: 'file:///cache/',
  copyAsync: jest.fn(async () => {}),
}));

import * as Print from 'expo-print';
import { createMigratedTestDb, resetDbSingleton } from '../../db/__tests__/testDb';
import { createStudent } from '../../db/students';
import { addStudentSubject, getPrimarySubjectId } from '../../db/subjects';
import { recordLesson } from '../../db/sessions';
import { createPackage } from '../../db/packages';
import { settleTravel } from '../../db/travel';
import { formatRand } from '../format';
import {
  getLessonReceiptText,
  getLowBalanceReminderText,
  getTopUpReceiptText,
  getTravelPaymentText,
  shareTravelPaymentReceipt,
} from '../receipt';

const R = formatRand;
const NOW = new Date('2026-10-12T15:00:00.000Z');
const base = { fullName: 'Amahle Dlamini', grade: 10, subject: 'Maths', curriculum: 'CAPS' as const };

describe('receipts and reminders with subjects + travel', () => {
  beforeEach(() => {
    createMigratedTestDb();
  });
  afterEach(() => resetDbSingleton());

  function setup(multi: boolean) {
    const s = createStudent({
      ...base, parentName: 'Thandi', travelDistanceKm: 12, parentTravelMode: 'per_km', parentTravelPerKm: 5,
    });
    const maths = getPrimarySubjectId(s.id)!;
    const science = multi ? addStudentSubject({ studentId: s.id, subject: 'Science' }).id : null;
    createPackage({ studentId: s.id, subjectId: maths, hoursAdded: 5, amountPaid: 2500, paymentMethod: 'eft' });
    const lesson = recordLesson({
      studentId: s.id, subjectId: maths, startedAt: '2026-10-02T08:00:00.000Z', billedMinutes: 60,
      topics: [], mode: 'in_person', now: NOW,
    }).session;
    return { s, maths, science, lesson };
  }

  it('lesson receipt shows travel; subject only for multi-subject students', () => {
    const single = setup(false);
    const t1 = getLessonReceiptText(single.lesson.id)!;
    expect(t1).toContain(`Travel: ${R(60)} (12 km)`);
    expect(t1).not.toContain('Subject:');
    expect(t1).toContain('Balance remaining: 4h');
  });

  it('multi-subject lesson receipt names the subject and its balance', () => {
    const { lesson } = setup(true);
    const t = getLessonReceiptText(lesson.id)!;
    expect(t).toContain('Subject: Maths');
    expect(t).toContain('Maths balance remaining: 4h');
  });

  it('top-up confirmation includes travel settled with the package', () => {
    const { s, maths } = setup(true);
    const { pkg } = createPackage({ studentId: s.id, subjectId: maths, hoursAdded: 10, amountPaid: 5500, paymentMethod: 'eft' });
    settleTravel({ studentId: s.id, amount: 40, packageId: pkg.id, now: NOW });
    const t = getTopUpReceiptText(pkg.id)!;
    expect(t).toContain('Hours added: 10h Maths');
    expect(t).toContain(`Travel settled: ${R(40)}`);
    expect(t).toContain(`Total received: ${R(5540)}`);
    expect(t).toContain('Maths balance: 14h');
    expect(t).toContain(`Travel still owed: ${R(20)}`);
  });

  it('reminder lists subject balances, travel owed and reference', () => {
    const { s } = setup(true);
    const t = getLowBalanceReminderText(s.id, { recipientName: 'Thandi' })!;
    expect(t).toContain('Maths: 4h remaining');
    expect(t).toContain('Science: 0m remaining');
    expect(t).toContain(`Travel owed: ${R(60)} (1 in-person lesson)`);
    expect(getLowBalanceReminderText('nope')).toBeNull();
  });

  it('travel payment text + PDF', async () => {
    const { s } = setup(false);
    const st = settleTravel({ studentId: s.id, amount: 20, method: 'cash', now: NOW });
    const t = getTravelPaymentText(st.id, { recipientName: 'Thandi' })!;
    expect(t).toContain(`Amount: ${R(20)}`);
    expect(t).toContain(`Travel still owed: ${R(40)}`);
    await expect(shareTravelPaymentReceipt(st.id)).resolves.toEqual({ shared: true, uri: expect.any(String) });
    const html = (Print.printToFileAsync as jest.Mock).mock.calls[0][0].html as string;
    expect(html).toContain('Travel payment receipt');
    expect(html).toContain('Cash');
    await expect(shareTravelPaymentReceipt('nope')).resolves.toEqual({ shared: false, uri: null });
  });
});
