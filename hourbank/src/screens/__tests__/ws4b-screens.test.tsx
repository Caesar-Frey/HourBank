/**
 * Render-level checks for the Schedule / Money / Start lesson / Claim screens
 * against a real (in-memory, migrated) database — catches runtime breakage a
 * typecheck can't.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() };
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]),
  };
});
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
}));
const mockStartTimer = jest.fn();
jest.mock('../../contexts/SessionTimerContext', () => ({
  useSessionTimer: () => ({ startTimer: mockStartTimer }),
}));
jest.mock('../../utils/claimReport', () => ({ shareClaimReport: jest.fn(async () => {}) }));

import { createMigratedTestDb, resetDbSingleton } from '../../db/__tests__/testDb';
import type { TestDb } from '../../db/__tests__/testDb';
import { logPastSession, getActiveOrPausedSession, markNoShow } from '../../db/sessions';
import { listClaims, finaliseClaim } from '../../db/claims';
import ScheduleTab from '../../../app/(app)/schedule';
import MoneyTab from '../../../app/(app)/money';
import StartLessonScreen from '../../../app/start-lesson';
import NewClaimScreen from '../../../app/claim/new';
import ClaimDetailScreen from '../../../app/claim/[id]';

let db: TestDb;

function seedStudent(id: string, name: string) {
  db.runSync(
    `INSERT INTO students (id, full_name, grade, subject, curriculum, status, created_at)
     VALUES (?, ?, 10, 'Maths', 'CAPS', 'active', '2026-01-01T00:00:00.000Z')`,
    [id, name],
  );
}

function seedScheduled(id: string, studentId: string, at: Date, minutes = 60) {
  db.runSync(
    `INSERT INTO sessions (id, student_id, mode, status, scheduled_for, estimated_duration_minutes, session_type, created_at)
     VALUES (?, ?, 'in_person', 'scheduled', ?, ?, 'test_prep', ?)`,
    [id, studentId, at.toISOString(), minutes, at.toISOString()],
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  db = createMigratedTestDb();
  jest.clearAllMocks();
  mockParams = {};
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  seedStudent('s1', 'Ann Lee');
  seedStudent('s2', 'Ben Ng');
});

afterEach(() => {
  jest.restoreAllMocks();
  resetDbSingleton();
});

test('Schedule agenda shows overdue + upcoming lessons with type labels and owe warning', async () => {
  const yesterday = new Date(Date.now() - 26 * 3600_000);
  const nextWeek = new Date(Date.now() + 6 * 24 * 3600_000);
  seedScheduled('old', 's1', yesterday);
  seedScheduled('next', 's2', nextWeek, 90);

  const screen = render(<ScheduleTab />);
  await flush();

  expect(screen.getByText('Overdue')).toBeTruthy();
  expect(screen.getByText('Upcoming')).toBeTruthy();
  expect(screen.getAllByText(/Test prep · In person/).length).toBeGreaterThan(0);
  expect(screen.queryByText(/test_prep/)).toBeNull();
  // Balance 0 → a booked lesson pushes the student into owing.
  expect(screen.getAllByText(/will owe/).length).toBeGreaterThan(0);

  fireEvent.press(screen.getByText('Ann Lee'));
  expect(mockRouter.push).toHaveBeenCalledWith('/lesson/old');

  // Calendar segments render without crashing.
  fireEvent.press(screen.getByText('Month'));
  await flush();
  fireEvent.press(screen.getByText('Day'));
  await flush();
  fireEvent.press(screen.getByText('Week'));
  await flush();
  expect(screen.getAllByText('Overdue').length).toBeGreaterThan(0); // legend
});

test('New lesson: defaults to Record a lesson → record form for the picked student', async () => {
  mockParams = { studentId: 's1' };
  const screen = render(<StartLessonScreen />);
  await flush();
  fireEvent.press(screen.getByText('Record lesson for Ann'));
  expect(mockRouter.replace).toHaveBeenCalledWith('/student/s1/log-past');
  expect(getActiveOrPausedSession()).toBeNull();
});

test('Start timer: over-owe nudge confirms then retries; running lesson is never discarded', async () => {
  mockParams = { studentId: 's1' };
  const screen = render(<StartLessonScreen />);
  await flush();

  fireEvent.press(screen.getByLabelText('Start a timer'));
  fireEvent.press(screen.getByText('Start timer with Ann'));
  const [title, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  expect(title).toBe('Ann Lee will owe 1h');
  const startAnyway = (buttons as { text: string; onPress?: () => void }[]).find(b => b.text === 'Start anyway');
  act(() => startAnyway!.onPress!());

  const active = getActiveOrPausedSession();
  expect(active?.student_id).toBe('s1');
  expect(mockStartTimer).toHaveBeenCalledWith(active!.id, 's1', expect.any(String), 0);
  expect(mockRouter.replace).toHaveBeenCalledWith(`/student/s1/session?sessionId=${active!.id}`);

  // Second lesson while one is running → prompt with "Open live lesson"; nothing discarded.
  (Alert.alert as jest.Mock).mockClear();
  mockParams = { studentId: 's2', kind: 'timer' };
  const second = render(<StartLessonScreen />);
  await flush();
  fireEvent.press(second.getByText('Start timer with Ben'));
  // The running lesson is reported before any owe check.
  const running = (Alert.alert as jest.Mock).mock.calls[0];
  expect(running[0]).toBe('A lesson with Ann Lee is running');
  expect((running[2] as { text: string }[]).map(b => b.text)).toEqual(['Cancel', 'Open live lesson']);
  expect(getActiveOrPausedSession()?.id).toBe(active!.id);
});

test('Money tab: In shows outstanding owed hours; Out shows plain-language pool', async () => {
  logPastSession({ studentId: 's1', startedAt: new Date(Date.now() - 3600_000).toISOString(), minutes: 90, topics: [] });
  const screen = render(<MoneyTab />);
  await flush();
  expect(screen.getByText('Outstanding right now')).toBeTruthy();
  expect(screen.getByText('Owed by 1 student')).toBeTruthy();
  expect(screen.getAllByText('1h 30m').length).toBeGreaterThan(0);

  fireEvent.press(screen.getByText('Out'));
  await flush();
  expect(screen.getByText('1 lesson taught but not yet claimed')).toBeTruthy();
});

test('New claim: grouped by student, hold-back excluded, finalise asks to confirm', async () => {
  logPastSession({ studentId: 's1', startedAt: new Date(Date.now() - 3 * 3600_000).toISOString(), minutes: 60, topics: [] });
  logPastSession({ studentId: 's2', startedAt: new Date(Date.now() - 2 * 3600_000).toISOString(), minutes: 60, topics: [] });

  const screen = render(<NewClaimScreen />);
  await flush();
  expect(screen.getByText('Ann Lee')).toBeTruthy();
  expect(screen.getByText('Ben Ng')).toBeTruthy();
  expect(screen.getByText('Lessons (2/2)')).toBeTruthy();

  // Hold back Ben's lesson.
  const boxes = screen.getAllByRole('checkbox');
  fireEvent.press(boxes[1]);
  expect(screen.getByText('Lessons (1/2)')).toBeTruthy();

  fireEvent.press(screen.getByText(/^Finalise · /));
  const [title, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  expect(title).toMatch(/^Finalise claim for R\u00A0/);
  expect(listClaims()).toHaveLength(0); // nothing written before confirming
  act(() => (buttons as { text: string; onPress?: () => void }[]).find(b => b.text === 'Finalise')!.onPress!());
  const claims = listClaims();
  expect(claims).toHaveLength(1);
  expect(claims[0].line_count).toBe(1);
  expect(mockRouter.replace).toHaveBeenCalledWith(`/claim/${claims[0].id}`);
});

test('Claim detail dates a charged no-show by its booked time (it has no ended_at)', async () => {
  const at = new Date(2026, 9, 7, 15, 0, 0); // Wed 7 Oct 2026, local
  seedScheduled('ns1', 's1', at, 30);
  markNoShow('ns1', { charge: true });
  const { claim } = finaliseClaim({ sessionIds: ['ns1'] });
  mockParams = { id: claim.id };

  const screen = render(<ClaimDetailScreen />);
  await flush();
  expect(screen.getByText('07')).toBeTruthy();
  expect(screen.queryByText('—')).toBeNull();
});
