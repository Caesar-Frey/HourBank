import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const R = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
    useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]),
  };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}),
}));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));

const mockStartTimer = jest.fn();
jest.mock('../../../contexts/SessionTimerContext', () => ({
  useSessionTimer: () => ({ status: 'idle', sessionId: null, studentId: null, elapsedSeconds: 0, startTimer: mockStartTimer }),
}));
jest.mock('../../../utils/backup', () => ({
  ...jest.requireActual('../../../utils/backup'),
  getLastBackupAt: jest.fn(async () => null),
}));
jest.mock('../../../db/reports', () => ({
  getWeekLessonStats: () => ({ completedCount: 0, completedHours: 0, scheduledCount: 0, scheduledHours: 0 }),
}));
jest.mock('../../../db/students', () => ({
  listActiveStudents: jest.fn(() => []),
  listPausedStudents: jest.fn(() => []),
  listArchivedStudents: jest.fn(() => []),
}));
jest.mock('../../../db/sessions', () => {
  const actual = jest.requireActual('../../../db/sessions');
  return {
    ...actual,
    listAgenda: jest.fn(() => ({ inProgress: [], overdue: [], today: [], upcoming: [] })),
    startSession: jest.fn(),
    getActiveOrPausedSession: jest.fn(() => null),
  };
});

import HomeScreen from '../../../../app/(app)/index';
import { listActiveStudents } from '../../../db/students';
import { listAgenda, startSession, SessionError } from '../../../db/sessions';

function todayAt(h: number): string {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
}

const nextLesson = {
  id: 'sess-1', student_id: 'stu-1', mode: 'online', scheduled_for: todayAt(23), estimated_duration_minutes: 60,
  status: 'scheduled', student_full_name: 'Thandi M', student_subject: 'Maths', student_status: 'active',
  started_at: null, paused_at: null, paused_seconds: 0, ended_at: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('empty roster shows the add-first-student call to action', async () => {
  const screen = render(<HomeScreen />);
  await waitFor(() => screen.getByText('Add your first student'));
  fireEvent.press(screen.getByText('Add your first student'));
  expect(mockPush).toHaveBeenCalledWith('/student/new');
  expect(screen.queryByText(/Needs attention/)).toBeNull();
});

test('load failure shows an error state, not "no students"', async () => {
  (listActiveStudents as jest.Mock).mockImplementationOnce(() => { throw new Error('db'); });
  const screen = render(<HomeScreen />);
  await waitFor(() => screen.getByText("Couldn't load your students."));
  expect(screen.queryByText('No students yet')).toBeNull();
});

test('Start on the next lesson: over-owe nudge retries with allowOverOwe', async () => {
  (listAgenda as jest.Mock).mockReturnValue({ inProgress: [], overdue: [], today: [nextLesson], upcoming: [] });
  (startSession as jest.Mock)
    .mockImplementationOnce(() => {
      throw new SessionError('OVER_OWE_LIMIT', 'x', {
        balanceHours: 0.5, projectedBalanceHours: -0.5, maxOweHours: 0, lessonMinutes: 60,
      });
    })
    .mockImplementationOnce(() => ({ id: 'sess-1', student_id: 'stu-1', started_at: new Date().toISOString(), paused_seconds: 0 }));

  const screen = render(<HomeScreen />);
  await waitFor(() => screen.getByText('Start lesson'));
  fireEvent.press(screen.getByText('Start lesson'));

  expect(Alert.alert).toHaveBeenCalledWith(
    'Start anyway?',
    'Thandi M has 30m left. This 1h lesson will leave them owing 30m.',
    expect.any(Array)
  );
  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
  act(() => buttons.find((b: { text: string }) => b.text === 'Start anyway').onPress());

  expect(startSession).toHaveBeenLastCalledWith('sess-1', { allowOverOwe: true });
  expect(mockStartTimer).toHaveBeenCalledWith('sess-1', 'stu-1', expect.any(String), 0);
  expect(mockPush).toHaveBeenCalledWith('/student/stu-1/session?sessionId=sess-1');
});

test('Start while another lesson runs opens the live lesson', async () => {
  (listAgenda as jest.Mock).mockReturnValue({ inProgress: [], overdue: [], today: [nextLesson], upcoming: [] });
  (startSession as jest.Mock).mockImplementationOnce(() => {
    throw new SessionError('ALREADY_ACTIVE', 'x', { activeSessionId: 'live-9', activeStudentId: 'stu-9' });
  });
  const screen = render(<HomeScreen />);
  await waitFor(() => screen.getByText('Start lesson'));
  fireEvent.press(screen.getByText('Start lesson'));
  expect(mockPush).toHaveBeenCalledWith('/student/stu-9/session?sessionId=live-9');
});

test('overdue lesson appears under Needs attention and links to the lesson screen', async () => {
  const overdue = { ...nextLesson, id: 'old-1', scheduled_for: '2026-01-05T09:00:00.000Z' };
  (listAgenda as jest.Mock).mockReturnValue({ inProgress: [], overdue: [overdue], today: [], upcoming: [] });
  const screen = render(<HomeScreen />);
  await waitFor(() => screen.getByText('Needs attention · 1'));
  fireEvent.press(screen.getByLabelText(/Thandi M: Not logged/));
  expect(mockPush).toHaveBeenCalledWith('/lesson/old-1');
});
