import { getDb } from './client';

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
  totalHours: number;
  perStudent: StudentMonthRow[];
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function getMonthSummary(year: number, monthZeroIdx: number): MonthSummary {
  const db = getDb();
  const start = new Date(year, monthZeroIdx, 1).toISOString();
  const end = new Date(year, monthZeroIdx + 1, 1).toISOString();
  const monthLabel = `${MONTH_NAMES[monthZeroIdx]} ${year}`;

  type SessionRow = { student_id: string; name: string; grade: number; subject: string; hours: number; sessions: number };
  const sessionRows = db.getAllSync<SessionRow>(
    `SELECT s.student_id, st.full_name AS name, st.grade, st.subject,
            COALESCE(SUM(s.duration_minutes) / 60.0, 0) AS hours,
            COUNT(*) AS sessions
     FROM sessions s
     JOIN students st ON s.student_id = st.id
     WHERE s.status IN ('pending_verification','verified')
       AND s.ended_at >= ? AND s.ended_at < ?
     GROUP BY s.student_id`,
    [start, end]
  );

  type PkgRow = { student_id: string; name: string; grade: number; subject: string; cashRand: number };
  const pkgRows = db.getAllSync<PkgRow>(
    `SELECT cp.student_id, st.full_name AS name, st.grade, st.subject,
            COALESCE(SUM(cp.amount_paid), 0) AS cashRand
     FROM credit_packages cp
     JOIN students st ON cp.student_id = st.id
     WHERE cp.created_at >= ? AND cp.created_at < ?
     GROUP BY cp.student_id`,
    [start, end]
  );

  const cashMap = new Map<string, number>();
  const infoMap = new Map<string, { name: string; grade: number; subject: string }>();
  for (const r of pkgRows) {
    cashMap.set(r.student_id, r.cashRand);
    infoMap.set(r.student_id, { name: r.name, grade: r.grade, subject: r.subject });
  }
  for (const r of sessionRows) {
    if (!infoMap.has(r.student_id)) {
      infoMap.set(r.student_id, { name: r.name, grade: r.grade, subject: r.subject });
    }
  }

  const allIds = new Set([
    ...sessionRows.map(r => r.student_id),
    ...pkgRows.map(r => r.student_id),
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

  const totalCashRand = pkgRows.reduce((sum, r) => sum + r.cashRand, 0);
  const totalHours = sessionRows.reduce((sum, r) => sum + r.hours, 0);

  return { monthLabel, totalCashRand, totalHours, perStudent };
}
