/**
 * travel.ts — PARENT travel billing, in arrears (migration 009).
 *
 * Each recorded in-person lesson snapshots its parent travel charge
 * (sessions.parent_travel_fee, at the student's rate at the time). Travel owed
 * (rand) = Σ charges of completed lessons − Σ travel_settlements. Settlements
 * are rand payments — with a top-up (package_id) or on their own — kept apart
 * from the hours ledger. Payments are applied to the oldest lessons first.
 *
 * Not to be confused with the tutor's PAYOUT travel in claims.ts.
 */
import { getDb } from './client';
import { CreditPackage, TravelSettlement } from './schema';
import { effectiveSubjectIdSql } from './migrations';
import { newId } from './uuid';

export type TravelErrorCode = 'INVALID_INPUT' | 'EXCEEDS_OWED' | 'NOT_FOUND';

export class TravelError extends Error {
  readonly code: TravelErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: TravelErrorCode, message: string, details?: Record<string, unknown>) {
    super(`${code}: ${message}`);
    this.name = 'TravelError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, TravelError.prototype);
  }
}

export function isTravelError(e: unknown, code?: TravelErrorCode): e is TravelError {
  return e instanceof TravelError && (code === undefined || e.code === code);
}

export type TravelOwedLesson = {
  session_id: string;
  subject_id: string | null;
  subject_name: string | null;
  /** Lesson date (started_at, else ended_at). */
  date: string;
  travel_km: number | null;
  parent_travel_fee: number;
  /** Part of this lesson's charge not yet covered by settlements. */
  unpaid: number;
};

export type TravelOwed = {
  /** Rand still owed (never below 0). */
  amount: number;
  /** Σ parent travel charges of recorded lessons. */
  charged: number;
  /** Σ settlements. */
  settled: number;
  /** Overpaid amount (settled > charged, e.g. after a lesson was edited to online). */
  credit: number;
  /** Lessons with an unpaid part, oldest first. */
  lessons: TravelOwedLesson[];
  lessonCount: number;
  /** Date of the oldest unpaid lesson (null when nothing owed). */
  since: string | null;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const LESSON_DATE = 'COALESCE(s.started_at, s.ended_at, s.scheduled_for)';

/** Lessons that can carry a parent travel charge: recorded, or a charged no-show with "Include travel" on. */
const TRAVEL_CHARGEABLE = `(s.status = 'completed' OR (s.status = 'cancelled' AND s.cancel_reason = 'no_show' AND COALESCE(s.no_show_travel, 0) = 1))`;

function chargedLessons(studentId: string): Array<Omit<TravelOwedLesson, 'unpaid'>> {
  return getDb().getAllSync<Omit<TravelOwedLesson, 'unpaid'>>(
    `SELECT s.id AS session_id, ${effectiveSubjectIdSql('s')} AS subject_id,
            (SELECT ss.subject FROM student_subjects ss WHERE ss.id = ${effectiveSubjectIdSql('s')}) AS subject_name,
            ${LESSON_DATE} AS date, s.travel_km, s.parent_travel_fee
     FROM sessions s
     WHERE s.student_id = ? AND ${TRAVEL_CHARGEABLE} AND s.mode = 'in_person'
       AND COALESCE(s.parent_travel_fee, 0) > 0
     ORDER BY julianday(${LESSON_DATE}) ASC, s.rowid ASC`,
    [studentId]
  );
}

function settledTotal(studentId: string): number {
  const row = getDb().getFirstSync<{ t: number | null }>(
    'SELECT SUM(amount) AS t FROM travel_settlements WHERE student_id = ?',
    [studentId]
  );
  return round2(row?.t ?? 0);
}

/** Travel owed by a student's family, with the unpaid lessons (FIFO allocation). */
export function getTravelOwed(studentId: string): TravelOwed {
  const lessons = chargedLessons(studentId);
  const charged = round2(lessons.reduce((a, l) => a + l.parent_travel_fee, 0));
  const settled = settledTotal(studentId);
  let pool = settled;
  const unpaid: TravelOwedLesson[] = [];
  for (const l of lessons) {
    const covered = Math.min(pool, l.parent_travel_fee);
    pool = round2(pool - covered);
    const rest = round2(l.parent_travel_fee - covered);
    if (rest > 0) unpaid.push({ ...l, unpaid: rest });
  }
  return {
    amount: round2(Math.max(0, charged - settled)),
    charged,
    settled,
    credit: round2(Math.max(0, settled - charged)),
    lessons: unpaid,
    lessonCount: unpaid.length,
    since: unpaid[0]?.date ?? null,
  };
}

/**
 * Record a travel payment. Standalone (packageId omitted/null) or alongside a
 * top-up (packageId of the same student; method defaults to the package's).
 * Partial payments are fine; paying more than is owed throws EXCEEDS_OWED.
 */
export interface SettleTravelInput {
  studentId: string;
  amount: number;
  packageId?: string | null;
  method?: CreditPackage['payment_method'];
  note?: string | null;
  now?: Date;
}

export function settleTravel(data: SettleTravelInput): TravelSettlement {
  let result: TravelSettlement | null = null;
  getDb().withTransactionSync(() => {
    result = settleTravelInTx(data);
  });
  return result!;
}

/** settleTravel for use inside an existing transaction (e.g. a top-up). */
export function settleTravelInTx(data: SettleTravelInput): TravelSettlement {
  const db = getDb();
  if (!Number.isFinite(data.amount) || data.amount <= 0) {
    throw new TravelError('INVALID_INPUT', 'Travel payment must be greater than zero');
  }
  const amount = round2(data.amount);
  let result: TravelSettlement | null = null;

  {
    const student = db.getFirstSync<{ id: string }>('SELECT id FROM students WHERE id = ?', [data.studentId]);
    if (!student) throw new TravelError('NOT_FOUND', `Student ${data.studentId} not found`);

    let method: CreditPackage['payment_method'] = data.method ?? 'eft';
    if (data.packageId) {
      const pkg = db.getFirstSync<{ student_id: string; payment_method: CreditPackage['payment_method'] }>(
        'SELECT student_id, payment_method FROM credit_packages WHERE id = ?',
        [data.packageId]
      );
      if (!pkg || pkg.student_id !== data.studentId) {
        throw new TravelError('INVALID_INPUT', 'Top-up not found for this student');
      }
      method = data.method ?? pkg.payment_method;
    }

    const owed = getTravelOwed(data.studentId).amount;
    if (amount > owed + 0.001) {
      throw new TravelError('EXCEEDS_OWED', `Only R${owed.toFixed(2)} travel is owed`, { owed, amount });
    }

    const row: TravelSettlement = {
      id: newId(),
      student_id: data.studentId,
      amount,
      payment_method: method,
      package_id: data.packageId ?? null,
      note: data.note?.trim() ? data.note.trim() : null,
      created_at: (data.now ?? new Date()).toISOString(),
    };
    db.runSync(
      `INSERT INTO travel_settlements (id, student_id, amount, payment_method, package_id, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.student_id, row.amount, row.payment_method, row.package_id, row.note, row.created_at]
    );
    result = row;
  }

  return result!;
}

/** A student's travel payments, newest first (rand history — not the hours ledger). */
export function listTravelSettlements(studentId: string): TravelSettlement[] {
  return getDb().getAllSync<TravelSettlement>(
    'SELECT * FROM travel_settlements WHERE student_id = ? ORDER BY created_at DESC, rowid DESC',
    [studentId]
  );
}

export function getTravelSettlement(id: string): TravelSettlement | null {
  return getDb().getFirstSync<TravelSettlement>('SELECT * FROM travel_settlements WHERE id = ?', [id]) ?? null;
}

/** Travel payments recorded with a given top-up (transaction detail). */
export function listTravelSettlementsForPackage(packageId: string): TravelSettlement[] {
  return getDb().getAllSync<TravelSettlement>(
    'SELECT * FROM travel_settlements WHERE package_id = ? ORDER BY created_at ASC, rowid ASC',
    [packageId]
  );
}

/**
 * Students with travel owed > 0, largest first. Archived students are kept
 * (flagged) — archiving doesn't cancel what a parent owes (B6).
 */
export function listTravelOwedByStudent(): Array<{ student_id: string; full_name: string; amount: number; lessonCount: number; archived: boolean }> {
  const ids = getDb().getAllSync<{ id: string; full_name: string; status: string }>(
    `SELECT DISTINCT st.id, st.full_name, st.status FROM students st
     JOIN sessions s ON s.student_id = st.id
     WHERE ${TRAVEL_CHARGEABLE} AND s.mode = 'in_person' AND COALESCE(s.parent_travel_fee, 0) > 0`
  );
  return ids
    .map(r => {
      const o = getTravelOwed(r.id);
      return { student_id: r.id, full_name: r.full_name, amount: o.amount, lessonCount: o.lessonCount, archived: r.status === 'archived' };
    })
    .filter(r => r.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.full_name.localeCompare(b.full_name));
}
