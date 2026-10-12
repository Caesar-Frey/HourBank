import { getDb } from './client';
import { newId } from './uuid';
import { listActiveStudents } from './students';
import { Student, Session } from './schema';

type StudentInput = {
  fullName: string;
  grade: number;
  subject: string;
  curriculum: Student['curriculum'];
};

const DEMO_STUDENTS: StudentInput[] = [
  { fullName: 'Amara Nkosi', grade: 11, subject: 'Mathematics', curriculum: 'CAPS' },
  { fullName: 'Liam van der Berg', grade: 9, subject: 'Physical Sciences', curriculum: 'IEB' },
  { fullName: 'Sofia Patel', grade: 12, subject: 'Accounting', curriculum: 'CAPS' },
  { fullName: 'Ethan Fourie', grade: 8, subject: 'English', curriculum: 'Cambridge' },
  { fullName: 'Zara Mokoena', grade: 10, subject: 'Life Sciences', curriculum: 'CAPS' },
  { fullName: 'Noah Pietersen', grade: 7, subject: 'Mathematics', curriculum: 'IEB' },
];

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(14 + (n % 4), 0, 0, 0);
  return d.toISOString();
}

type BalancePlan = { topUps: { hours: number; amount: number; daysAgoVal: number }[]; sessions: { durationHours: number; daysAgoVal: number }[] };

const BALANCE_PLANS: BalancePlan[] = [
  // Amara — moss (≥3h remaining ~5h)
  {
    topUps: [
      { hours: 10, amount: 5500, daysAgoVal: 55 },
      { hours: 10, amount: 5500, daysAgoVal: 20 },
    ],
    sessions: [
      { durationHours: 1.5, daysAgoVal: 50 },
      { durationHours: 1, daysAgoVal: 43 },
      { durationHours: 1.5, daysAgoVal: 36 },
      { durationHours: 2, daysAgoVal: 29 },
      { durationHours: 1.5, daysAgoVal: 22 },
      { durationHours: 1, daysAgoVal: 15 },
      { durationHours: 1.5, daysAgoVal: 8 },
      { durationHours: 1, daysAgoVal: 3 },
    ],
  },
  // Liam — moss (≥3h remaining ~8h)
  {
    topUps: [
      { hours: 15, amount: 8000, daysAgoVal: 45 },
    ],
    sessions: [
      { durationHours: 1, daysAgoVal: 40 },
      { durationHours: 1.5, daysAgoVal: 33 },
      { durationHours: 1, daysAgoVal: 26 },
      { durationHours: 1.5, daysAgoVal: 19 },
      { durationHours: 1, daysAgoVal: 12 },
      { durationHours: 1, daysAgoVal: 5 },
    ],
  },
  // Sofia — amber (1–3h remaining ~2h)
  {
    topUps: [
      { hours: 10, amount: 5500, daysAgoVal: 70 },
    ],
    sessions: [
      { durationHours: 2, daysAgoVal: 63 },
      { durationHours: 1.5, daysAgoVal: 56 },
      { durationHours: 1.5, daysAgoVal: 49 },
      { durationHours: 1, daysAgoVal: 42 },
      { durationHours: 1, daysAgoVal: 14 },
      { durationHours: 1, daysAgoVal: 7 },
    ],
  },
  // Ethan — amber (~1.5h remaining)
  {
    topUps: [
      { hours: 5, amount: 3000, daysAgoVal: 30 },
      { hours: 5, amount: 3000, daysAgoVal: 10 },
    ],
    sessions: [
      { durationHours: 1.5, daysAgoVal: 28 },
      { durationHours: 1.5, daysAgoVal: 21 },
      { durationHours: 1.5, daysAgoVal: 14 },
      { durationHours: 1.5, daysAgoVal: 7 },
      { durationHours: 1, daysAgoVal: 3 },
    ],
  },
  // Zara — crimson (<1h remaining ~0.5h)
  {
    topUps: [
      { hours: 5, amount: 3000, daysAgoVal: 40 },
    ],
    sessions: [
      { durationHours: 1, daysAgoVal: 35 },
      { durationHours: 1.5, daysAgoVal: 28 },
      { durationHours: 1, daysAgoVal: 14 },
      { durationHours: 1, daysAgoVal: 5 },
    ],
  },
  // Noah — crimson (<1h remaining ~0.5h)
  {
    topUps: [
      { hours: 10, amount: 5500, daysAgoVal: 90 },
    ],
    sessions: [
      { durationHours: 2, daysAgoVal: 80 },
      { durationHours: 2, daysAgoVal: 66 },
      { durationHours: 1.5, daysAgoVal: 52 },
      { durationHours: 2, daysAgoVal: 38 },
      { durationHours: 1, daysAgoVal: 24 },
      { durationHours: 0.5, daysAgoVal: 10 },
    ],
  },
];

const PAYMENT_METHODS: Array<'eft' | 'cash'> = ['eft', 'eft', 'eft', 'cash'];
const TOPIC_MAP: Record<string, string[]> = {
  Mathematics: ['Algebra', 'Functions', 'Trigonometry', 'Calculus', 'Statistics'],
  'Physical Sciences': ['Mechanics', 'Waves', 'Electricity', 'Chemical Bonding', 'Organic Chemistry'],
  Accounting: ['Balance Sheet', 'Cash Flow', 'Depreciation', 'VAT', 'Ledger Entries'],
  English: ['Essay Writing', 'Poetry Analysis', 'Grammar', 'Literature', 'Comprehension'],
  'Life Sciences': ['Genetics', 'Evolution', 'Ecology', 'Cell Biology', 'Human Systems'],
};

export function seedDemoData(): void {
  if (listActiveStudents().length > 0) return;

  const db = getDb();

  DEMO_STUDENTS.forEach((studentData, i) => {
    const studentId = newId();
    const plan = BALANCE_PLANS[i];
    const topics = TOPIC_MAP[studentData.subject] ?? ['General'];

    db.runSync(
      `INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      [studentId, studentData.fullName, studentData.grade, studentData.subject, studentData.curriculum, daysAgo(95)]
    );

    let runningBalance = 0;

    // Insert top-ups
    const sortedTopUps = [...plan.topUps].sort((a, b) => b.daysAgoVal - a.daysAgoVal);
    sortedTopUps.forEach((topUp, j) => {
      const pkgId = newId();
      const createdAt = daysAgo(topUp.daysAgoVal);
      const payMethod = PAYMENT_METHODS[j % PAYMENT_METHODS.length];

      db.runSync(
        `INSERT INTO credit_packages (id, student_id, hours_added, amount_paid, payment_method, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [pkgId, studentId, topUp.hours, topUp.amount, payMethod, createdAt]
      );

      runningBalance += topUp.hours;

      db.runSync(
        `INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, related_package_id, created_at)
         VALUES (?, ?, 'top_up', ?, ?, ?, ?)`,
        [newId(), studentId, topUp.hours, runningBalance, pkgId, createdAt]
      );
    });

    // Insert historical sessions
    const sortedSessions = [...plan.sessions].sort((a, b) => b.daysAgoVal - a.daysAgoVal);
    sortedSessions.forEach((sess, j) => {
      const sessionId = newId();
      const endedAt = daysAgo(sess.daysAgoVal);
      const startedAt = new Date(new Date(endedAt).getTime() - sess.durationHours * 60 * 60 * 1000).toISOString();
      const durationMin = sess.durationHours * 60;
      const sessionTopics = JSON.stringify(topics.slice(j % topics.length, (j % topics.length) + 2));

      db.runSync(
        `INSERT INTO sessions (id, student_id, mode, started_at, ended_at, duration_minutes, paused_seconds, topics, status, created_at)
         VALUES (?, ?, 'in_person', ?, ?, ?, 0, ?, 'completed', ?)`,
        [sessionId, studentId, startedAt, endedAt, durationMin, sessionTopics, startedAt]
      );

      runningBalance -= sess.durationHours;

      db.runSync(
        `INSERT INTO ledger_entries (id, student_id, type, hours_delta, balance_after, related_session_id, created_at)
         VALUES (?, ?, 'session_deduction', ?, ?, ?, ?)`,
        [newId(), studentId, -sess.durationHours, runningBalance, sessionId, endedAt]
      );
    });

    // Schedule 1–2 upcoming sessions
    const upcomingCount = i < 4 ? 1 : 2;
    for (let u = 0; u < upcomingCount; u++) {
      const scheduledFor = daysFromNow(2 + u * 3 + i);
      const sessionId = newId();
      const sessionTopics = JSON.stringify(topics.slice(0, 2));

      db.runSync(
        `INSERT INTO sessions (id, student_id, mode, scheduled_for, estimated_duration_minutes, paused_seconds, topics, status, created_at)
         VALUES (?, ?, ?, ?, 90, 0, ?, 'scheduled', ?)`,
        [sessionId, studentId, u % 2 === 0 ? 'in_person' : 'online', scheduledFor, sessionTopics, daysAgo(1)]
      );
    }
  });
}

/**
 * DEV ONLY: wipe all user data. Children are deleted before parents so FK
 * RESTRICT constraints (claim_lines → sessions, receipts → sessions/packages)
 * never fire. The ledger's append-only DELETE guard triggers are dropped for
 * the wipe and recreated from their original SQL inside the same transaction.
 */
export function resetDb(): void {
  if (!__DEV__) throw new Error('resetDb is only available in development');
  const db = getDb();
  const tableExists = (name: string) =>
    db.getFirstSync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
      [name]
    ) != null;

  db.withTransactionSync(() => {
    const ledgerDeleteGuards = db.getAllSync<{ name: string; sql: string }>(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'trigger' AND tbl_name = 'ledger_entries' AND UPPER(sql) LIKE '%DELETE ON%'`
    );
    for (const t of ledgerDeleteGuards) db.runSync(`DROP TRIGGER IF EXISTS "${t.name}"`);

    const ordered = [
      'travel_settlements',
      'claim_lines',
      'claims',
      'receipts',
      'calendar_events',
      'ledger_entries',
      'sessions',
      'credit_packages',
      'student_subjects',
      'students',
    ];
    for (const table of ordered) {
      if (tableExists(table)) db.runSync(`DELETE FROM ${table}`);
    }

    for (const t of ledgerDeleteGuards) db.runSync(t.sql);
  });
}
