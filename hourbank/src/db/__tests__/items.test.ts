/**
 * F1 — charge an item to credit.
 */
import { createMigratedTestDb, createTestDb, resetDbSingleton } from './testDb';
import { ALL_MIGRATIONS, MIGRATION_014_ITEMS, runMigrations } from '../migrations';
import { currentBalance } from '../ledger';
import { getDb } from '../client';
import { createStudent } from '../students';
import { getPrimarySubjectId, getSubjectBalance } from '../subjects';
import { createPackage } from '../packages';
import { recordLesson } from '../sessions';
import { listClaimablePool } from '../claims';
import { listLedger, getLedgerEntryById } from '../ledger';
import { upsertTutorProfile } from '../tutorProfile';
import {
  chargeItem, removeItemCharge, getSaleItems, saveSaleItems, suggestItemHours, itemTotals, parseSaleItems, ItemError,
} from '../items';
import { isStruckEntry, ledgerDescription } from '../../components/student/flowLogic';

const base = { fullName: 'Amahle Dlamini', grade: 10, subject: 'Maths', curriculum: 'CAPS' as const };

describe('F1 — charge an item', () => {
  beforeEach(() => { createMigratedTestDb(); upsertTutorProfile({ full_name: 'Tutor' }); });
  afterEach(() => resetDbSingleton());

  function funded() {
    const s = createStudent(base);
    createPackage({ studentId: s.id, hoursAdded: 5, amountPaid: 3000, paymentMethod: 'eft' });
    return { s, subj: getPrimarySubjectId(s.id)! };
  }

  it('takes hours from the subject credit and shows the item name', () => {
    const { s, subj } = funded();
    const e = chargeItem({ studentId: s.id, itemName: ' Study pack ', hours: 1, priceRand: 450 });
    expect(getSubjectBalance(s.id, subj)).toBe(4);
    expect(e.item_name).toBe('Study pack');
    const row = listLedger(s.id)[0];
    expect(row.item_name).toBe('Study pack');
    expect(row.item_price_rand).toBe(450);
    expect(ledgerDescription(row)).toBe('Study pack');
  });

  it('removing restores exactly and strikes both rows', () => {
    const { s, subj } = funded();
    const e = chargeItem({ studentId: s.id, itemName: 'Workbook', hours: 1.5 });
    removeItemCharge(e.id);
    expect(getSubjectBalance(s.id, subj)).toBe(5);
    const rows = listLedger(s.id);
    expect(rows.filter(isStruckEntry)).toHaveLength(2);
    expect(getLedgerEntryById(e.id)!.reversed_by).toBeTruthy();
    expect(() => removeItemCharge(e.id)).toThrow(ItemError);
  });

  it('is never in the claimable pool and never a lesson', () => {
    const { s } = funded();
    recordLesson({ studentId: s.id, startedAt: new Date(Date.now() - 3600e3).toISOString(), billedMinutes: 60, topics: [] });
    chargeItem({ studentId: s.id, itemName: 'Study pack', hours: 1 });
    expect(listClaimablePool()).toHaveLength(1);
    const n = getDb().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM sessions')!.n;
    expect(n).toBe(1);
  });

  it('nudges past the owing limit unless confirmed', () => {
    const s = createStudent(base);
    expect(() => chargeItem({ studentId: s.id, itemName: 'Pack', hours: 1 })).toThrow(expect.objectContaining({ code: 'OVER_OWE_LIMIT' }));
    expect(() => chargeItem({ studentId: s.id, itemName: 'Pack', hours: 1, allowOverOwe: true })).not.toThrow();
  });

  it('rejects an empty name or zero hours', () => {
    const { s } = funded();
    expect(() => chargeItem({ studentId: s.id, itemName: '  ', hours: 1 })).toThrow(expect.objectContaining({ code: 'INVALID' }));
    expect(() => chargeItem({ studentId: s.id, itemName: 'Pack', hours: 0 })).toThrow(expect.objectContaining({ code: 'INVALID' }));
  });

  it('item totals skip removed charges', () => {
    const { s } = funded();
    chargeItem({ studentId: s.id, itemName: 'Pack', hours: 1, priceRand: 450 });
    const gone = chargeItem({ studentId: s.id, itemName: 'Book', hours: 0.5, priceRand: 200 });
    removeItemCharge(gone.id);
    expect(itemTotals('2000-01-01T00:00:00.000Z', '2999-01-01T00:00:00.000Z')).toEqual({ count: 1, hours: 1, rand: 450 });
  });

  it('saved items round-trip and bad rows are dropped', () => {
    saveSaleItems([{ id: 'a', name: 'Past papers', price: 300, hours: null }, { id: 'b', name: '  ', price: null, hours: null }]);
    expect(getSaleItems()).toEqual([{ id: 'a', name: 'Past papers', price: 300, hours: null }]);
    expect(parseSaleItems('not json')).toEqual([]);
  });

  it('suggests credit from price at the parent rate, to the step', () => {
    expect(suggestItemHours(450, 450, 30)).toBe(1);
    expect(suggestItemHours(500, 600, 30)).toBe(1);   // 50m → 1h
    expect(suggestItemHours(100, 600, 30)).toBe(0.5); // minimum one step
    expect(suggestItemHours(null, 600, 30)).toBeNull();
  });
});

describe('migration 014 — items', () => {
  afterEach(() => resetDbSingleton());

  it('upgrades an existing ledger without touching balances, and is idempotent', () => {
    createTestDb();
    runMigrations(ALL_MIGRATIONS.slice(0, ALL_MIGRATIONS.indexOf(MIGRATION_014_ITEMS)));
    upsertTutorProfile({ full_name: 'Tutor' });
    const s = createStudent(base);
    createPackage({ studentId: s.id, hoursAdded: 5, amountPaid: 3000, paymentMethod: 'eft' });
    runMigrations(ALL_MIGRATIONS);
    runMigrations(ALL_MIGRATIONS);
    expect(currentBalance(s.id)).toBe(5);
    expect(listLedger(s.id)[0].item_name).toBeNull();
    expect(getSaleItems()).toEqual([]);
    chargeItem({ studentId: s.id, itemName: 'Pack', hours: 1 });
    expect(currentBalance(s.id)).toBe(4);
  });
});
