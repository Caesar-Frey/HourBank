import { getDb } from './client';
import { billableSessionSql, billableSessionDateSql } from './claims';
import { effectiveSubjectIdSql } from './migrations';

const subjectNameSql = (alias: string) =>
  `(SELECT ss.subject FROM student_subjects ss WHERE ss.id = ${effectiveSubjectIdSql(alias)})`;

export type StudentMonthRow = {
  studentId: string;
  name: string;
  grade: number;
  subject: string;
  hours: number;
  sessions: number;
  cashRand: number;
};

export type MonthSummary = {
  monthLabel: string;
  totalCashRand: number;
  /** Billed hours of lessons actually TAUGHT in the month (charged no-shows excluded). */
  totalHours: number;
  /** Lessons actually taught (charged no-shows excluded). */
  totalLessons: number;
  /** Billed hours of charged no-shows (billed, claimable — but not taught). */
  noShowHours: number;
  noShowLessons: number;
  /** Per-student BILLED totals (taught lessons + charged no-shows). cashRand includes travel payments. */
  perStudent: StudentMonthRow[];
  /** Per-subject BILLED totals (taught lessons + charged no-shows), hours desc. */
  perSubject: SubjectMonthRow[];
  /** Travel payments received in the month (included in totalCashRand). */
  travelCashRand: number;
};

export type SubjectMonthRow = {
  studentId: string;
  studentName: string;
  subjectId: string | null;
  subject: string;
  hours: number;
  sessions: number;
};

export type TravelSettlementRow = {
  id: string;
  created_at: string;
  student_id: string;
  student_full_name: string;
  amount: number;
  payment_method: string;
  package_id: string | null;
  note: string | null;
};

/**
 * [start, end) ISO bounds for a calendar month at LOCAL midnight (SAST is
 * UTC+2 — UTC bounds misfiled the first two hours of each month).
 */
export function localMonthBounds(year: number, monthIdx: number): { start: string; end: string } {
  return {
    start: new Date(year, monthIdx, 1).toISOString(),
    end: new Date(year, monthIdx + 1, 1).toISOString(),
  };
}

/** Billed minutes, falling back to active duration, then wall-clock (legacy rows). */
const BILLED_MINUTES_SQL = `COALESCE(s.billed_minutes, s.duration_minutes,
  (julianday(s.ended_at) - julianday(s.started_at)) * 1440)`;

export type TopUpRow = {
  id: string;
  created_at: string;
  student_id: string;
  student_full_name: string;
  hours_delta: number;
  notes: string | null;
  /** Rands paid for the linked credit package (null for legacy/unlinked top-ups). */
  amount_paid: number | null;
  payment_method: string | null;
  /** Subject the hours were bought for. */
  subject_id: string | null;
  subject_name: string | null;
};

export type SessionListRow = {
  id: string;
  /** Lesson date: ended_at, or started_at/scheduled_for for a charged no-show. */
  ended_at: string;
  student_id: string;
  student_full_name: string;
  started_at: string | null;
  /** BILLED length in seconds (kept in seconds for formatBilledDuration). */
  duration: number;
  billed_minutes: number;
  mode: 'in_person' | 'online';
  /** 'completed', or 'cancelled' for a charged no-show (see cancel_reason). No 'verified' status exists. */
  status: string;
  cancel_reason: string | null;
  session_type: 'general' | 'review' | 'test_prep' | 'exam_prep';
  subject_id: string | null;
  subject_name: string | null;
  travel_km: number | null;
  /** Parent travel charge snapshotted on the lesson (null = none). */
  parent_travel_fee: number | null;
};

export function listTopUpsForMonth(year: number, monthIdx: number): TopUpRow[] {
  const db = getDb();
  const { start, end } = localMonthBounds(year, monthIdx);
  return db.getAllSync<TopUpRow>(
    `SELECT le.id, le.created_at, le.student_id, st.full_name AS student_full_name,
            le.hours_delta, le.reason AS notes,
            cp.amount_paid, cp.payment_method,
            ${effectiveSubjectIdSql('le')} AS subject_id, ${subjectNameSql('le')} AS subject_name
     FROM ledger_entries le
     JOIN students st ON le.student_id = st.id
     LEFT JOIN credit_packages cp ON cp.id = le.related_package_id
     WHERE le.type = 'top_up'
       AND julianday(le.created_at) >= julianday(?) AND julianday(le.created_at) < julianday(?)
     ORDER BY le.created_at DESC`,
    [start, end]
  );
}

export function listSessionsForMonth(year: number, monthIdx: number): SessionListRow[] {
  const db = getDb();
  const { start, end } = localMonthBounds(year, monthIdx);
  return db.getAllSync<SessionListRow>(
    `SELECT s.id, ${billableSessionDateSql('s')} AS ended_at, s.started_at, s.cancel_reason, s.student_id, st.full_name AS student_full_name,
            s.mode, s.status, s.session_type, s.travel_km, s.parent_travel_fee,
            ${effectiveSubjectIdSql('s')} AS subject_id, ${subjectNameSql('s')} AS subject_name,
            ROUND(${BILLED_MINUTES_SQL}, 2) AS billed_minutes,
            CAST(ROUND(${BILLED_MINUTES_SQL} * 60) AS INTEGER) AS duration
     FROM sessions s
     JOIN students st ON s.student_id = st.id
     WHERE ${billableSessionSql('s')}
       AND julianday(${billableSessionDateSql('s')}) >= julianday(?)
       AND julianday(${billableSessionDateSql('s')}) < julianday(?)
     ORDER BY julianday(${billableSessionDateSql('s')}) DESC`,
    [start, end]
  );
}

/** Travel payments received in a month (Money In), newest first. */
export function listTravelSettlementsForMonth(year: number, monthIdx: number): TravelSettlementRow[] {
  const { start, end } = localMonthBounds(year, monthIdx);
  return getDb().getAllSync<TravelSettlementRow>(
    `SELECT ts.id, ts.created_at, ts.student_id, st.full_name AS student_full_name, ts.amount,
            ts.payment_method, ts.package_id, ts.note
     FROM travel_settlements ts JOIN students st ON st.id = ts.student_id
     WHERE julianday(ts.created_at) >= julianday(?) AND julianday(ts.created_at) < julianday(?)
     ORDER BY ts.created_at DESC, ts.rowid DESC`,
    [start, end]
  );
}

export type WeekLessonStats = {
  completedCount: number;
  completedHours: number;
  scheduledCount: number;
  scheduledHours: number;
};

/**
 * Completed + scheduled lessons for the current (Monday-start) week.
 * Hours are derived from session minutes — billed/duration for completed,
 * estimated for scheduled — never from a stored balance column.
 */
export function getWeekLessonStats(): WeekLessonStats {
  const db = getDb();
  const now = new Date();
  const dow = now.getDay();              // 0=Sun, 1=Mon, ...
  const diff = dow === 0 ? -6 : 1 - dow; // Monday-start
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() + diff);
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);
  const startISO = startOfWeek.toISOString();
  const endISO = endOfWeek.toISOString();

  const completed = db.getFirstSync<{ count: number; minutes: number }>(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(COALESCE(s.billed_minutes, s.duration_minutes)), 0) AS minutes
     FROM sessions s
     JOIN students st ON s.student_id = st.id
     WHERE ${billableSessionSql('s')}
       AND st.status != 'archived'
       AND julianday(${billableSessionDateSql('s')}) >= julianday(?)
       AND julianday(${billableSessionDateSql('s')}) < julianday(?)`,
    [startISO, endISO]
  );

  const scheduled = db.getFirstSync<{ count: number; minutes: number }>(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(s.estimated_duration_minutes), 0) AS minutes
     FROM sessions s
     JOIN students st ON s.student_id = st.id
     WHERE s.status = 'scheduled'
       AND st.status != 'archived'
       AND julianday(s.scheduled_for) >= julianday(?) AND julianday(s.scheduled_for) < julianday(?)`,
    [startISO, endISO]
  );

  return {
    completedCount: completed?.count ?? 0,
    completedHours: (completed?.minutes ?? 0) / 60,
    scheduledCount: scheduled?.count ?? 0,
    scheduledHours: (scheduled?.minutes ?? 0) / 60,
  };
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function getMonthSummary(year: number, monthZeroIdx: number): MonthSummary {
  const db = getDb();
  const { start, end } = localMonthBounds(year, monthZeroIdx);
  const monthLabel = `${MONTH_NAMES[monthZeroIdx]} ${year}`;

  type SessionRow = {
    student_id: string; name: string; grade: number; subject: string;
    hours: number; sessions: number; noShowHours: number; noShowSessions: number;
  };
  const NO_SHOW = `(s.status = 'cancelled' AND s.cancel_reason = 'no_show')`;
  const sessionRows = db.getAllSync<SessionRow>(
    `SELECT s.student_id, st.full_name AS name, st.grade, st.subject,
            COALESCE(SUM(${BILLED_MINUTES_SQL}) / 60.0, 0) AS hours,
            COUNT(*) AS sessions,
            COALESCE(SUM(CASE WHEN ${NO_SHOW} THEN ${BILLED_MINUTES_SQL} ELSE 0 END) / 60.0, 0) AS noShowHours,
            COALESCE(SUM(CASE WHEN ${NO_SHOW} THEN 1 ELSE 0 END), 0) AS noShowSessions
     FROM sessions s
     JOIN students st ON s.student_id = st.id
     WHERE ${billableSessionSql('s')}
       AND julianday(${billableSessionDateSql('s')}) >= julianday(?)
       AND julianday(${billableSessionDateSql('s')}) < julianday(?)
     GROUP BY s.student_id`,
    [start, end]
  );

  type PkgRow = { student_id: string; name: string; grade: number; subject: string; cashRand: number };
  const pkgRows = db.getAllSync<PkgRow>(
    `SELECT cp.student_id, st.full_name AS name, st.grade, st.subject,
            COALESCE(SUM(cp.amount_paid), 0) AS cashRand
     FROM credit_packages cp
     JOIN students st ON cp.student_id = st.id
     WHERE julianday(cp.created_at) >= julianday(?) AND julianday(cp.created_at) < julianday(?)
     GROUP BY cp.student_id`,
    [start, end]
  );

  type TravelRow = { student_id: string; name: string; grade: number; subject: string; cashRand: number };
  const travelRows = db.getAllSync<TravelRow>(
    `SELECT ts.student_id, st.full_name AS name, st.grade, st.subject, COALESCE(SUM(ts.amount), 0) AS cashRand
     FROM travel_settlements ts JOIN students st ON st.id = ts.student_id
     WHERE julianday(ts.created_at) >= julianday(?) AND julianday(ts.created_at) < julianday(?)
     GROUP BY ts.student_id`,
    [start, end]
  );

  type SubjectRow = { student_id: string; name: string; subject_id: string | null; subject: string | null; hours: number; sessions: number };
  const subjectRows = db.getAllSync<SubjectRow>(
    `SELECT s.student_id, st.full_name AS name, ${effectiveSubjectIdSql('s')} AS subject_id,
            COALESCE(${subjectNameSql('s')}, st.subject) AS subject,
            COALESCE(SUM(${BILLED_MINUTES_SQL}) / 60.0, 0) AS hours, COUNT(*) AS sessions
     FROM sessions s
     JOIN students st ON s.student_id = st.id
     WHERE ${billableSessionSql('s')}
       AND julianday(${billableSessionDateSql('s')}) >= julianday(?)
       AND julianday(${billableSessionDateSql('s')}) < julianday(?)
     GROUP BY s.student_id, ${effectiveSubjectIdSql('s')}`,
    [start, end]
  );
  const perSubject: SubjectMonthRow[] = subjectRows
    .map(r => ({
      studentId: r.student_id,
      studentName: r.name,
      subjectId: r.subject_id,
      subject: r.subject ?? '',
      hours: r.hours,
      sessions: r.sessions,
    }))
    .sort((a, b) => b.hours - a.hours);

  const cashMap = new Map<string, number>();
  const infoMap = new Map<string, { name: string; grade: number; subject: string }>();
  for (const r of pkgRows) {
    cashMap.set(r.student_id, r.cashRand);
    infoMap.set(r.student_id, { name: r.name, grade: r.grade, subject: r.subject });
  }
  for (const r of travelRows) {
    cashMap.set(r.student_id, (cashMap.get(r.student_id) ?? 0) + r.cashRand);
    if (!infoMap.has(r.student_id)) infoMap.set(r.student_id, { name: r.name, grade: r.grade, subject: r.subject });
  }
  for (const r of sessionRows) {
    if (!infoMap.has(r.student_id)) {
      infoMap.set(r.student_id, { name: r.name, grade: r.grade, subject: r.subject });
    }
  }

  const allIds = new Set([
    ...sessionRows.map(r => r.student_id),
    ...pkgRows.map(r => r.student_id),
    ...travelRows.map(r => r.student_id),
  ]);

  const perStudent: StudentMonthRow[] = Array.from(allIds).map(sid => {
    const sessRow = sessionRows.find(r => r.student_id === sid);
    const info = infoMap.get(sid)!;
    return {
      studentId: sid,
      name: info.name,
      grade: info.grade,
      subject: info.subject,
      hours: sessRow?.hours ?? 0,
      sessions: sessRow?.sessions ?? 0,
      cashRand: cashMap.get(sid) ?? 0,
    };
  });

  perStudent.sort((a, b) => b.hours - a.hours);

  const travelCashRand = travelRows.reduce((sum, r) => sum + r.cashRand, 0);
  const totalCashRand = pkgRows.reduce((sum, r) => sum + r.cashRand, 0) + travelCashRand;
  const noShowHours = sessionRows.reduce((sum, r) => sum + r.noShowHours, 0);
  const noShowLessons = sessionRows.reduce((sum, r) => sum + r.noShowSessions, 0);
  const totalHours = sessionRows.reduce((sum, r) => sum + r.hours, 0) - noShowHours;
  const totalLessons = sessionRows.reduce((sum, r) => sum + r.sessions, 0) - noShowLessons;

  return { monthLabel, totalCashRand, totalHours, totalLessons, noShowHours, noShowLessons, perStudent, perSubject, travelCashRand };
}
