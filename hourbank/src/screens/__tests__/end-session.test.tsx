import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const ENDED_AT = '2026-10-09T10:00:00.000Z';
const minsBefore = (m: number) => new Date(new Date(ENDED_AT).getTime() - m * 60_000).toISOString();

const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockDispatch = jest.fn();
const mockPush = jest.fn();
let mockRootState: unknown = null;
const mockEndTimer = jest.fn();
const mockRefresh = jest.fn();
const mockToast = jest.fn();
let mockSession: Record<string, unknown> | null = null;
let mockTopicsParam: string | undefined = encodeURIComponent('["Algebra"]');

jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({
    id: 'student-1',
    sessionId: 'session-1',
    endedAt: encodeURIComponent('2026-10-09T10:00:00.000Z'),
    mode: 'online',
    topics: mockTopicsParam,
  }),
  useRouter: () => ({ replace: mockReplace, back: mockBack, push: mockPush }),
  useNavigationContainerRef: () => ({ getRootState: () => mockRootState, dispatch: mockDispatch }),
}));
jest.mock('../../db/students', () => ({
  getStudent: () => ({ id: 'student-1', full_name: 'Sam Student', subject: 'Maths', grade: 10, curriculum: 'CAPS' }),
}));
jest.mock('../../db/ledger', () => ({ currentBalance: () => 5 }));
jest.mock('../../db/catalog', () => ({ listTopicsForStudentSubject: () => [{ name: 'Algebra' }] }));
jest.mock('../../db/tutorProfile', () => ({ getOrCreateTutorProfile: () => ({ billing_round_minutes: 15 }) }));
jest.mock('../../db/sessions', () => {
  const actual = jest.requireActual('../../db/sessions');
  return {
    ...actual,
    getSession: () => mockSession,
    endSession: jest.fn(),
    saveLiveTopics: jest.fn(() => true),
  };
});
jest.mock('../../components/Toast', () => ({ useToast: () => ({ show: mockToast, hide: jest.fn() }) }));
jest.mock('../../contexts/SessionTimerContext', () => ({
  useSessionTimer: () => ({ endTimer: mockEndTimer, refreshFromDb: mockRefresh }),
}));

import EndSessionScreen from '../../../app/student/[id]/end-session';
import { endSession, saveLiveTopics, SessionError } from '../../db/sessions';
import { lessonDraftStore } from '../../contexts/SessionTimerContext.helpers';

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    student_id: 'student-1',
    status: 'active',
    started_at: minsBefore(60),
    ended_at: null,
    paused_at: null,
    paused_seconds: 0,
    estimated_duration_minutes: 60,
    scheduled_for: minsBefore(60),
    topics: '[]',
    ...overrides,
  };
}

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const renderScreen = () =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <EndSessionScreen />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  lessonDraftStore.clear('session-1');
  mockSession = session();
  mockTopicsParam = encodeURIComponent('["Algebra"]');
  mockRootState = null;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

test('save commits the lesson, THEN resets the timer and replaces the stack with the summary', () => {
  const order: string[] = [];
  (endSession as jest.Mock).mockImplementation(() => order.push('endSession'));
  mockEndTimer.mockImplementation(() => order.push('endTimer'));

  const screen = renderScreen();
  fireEvent.press(screen.getByText(/Save lesson/));

  expect(endSession).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: 'session-1',
      endedAt: ENDED_AT,
      durationMinutes: 60,
      billedMinutes: 60,
      topics: ['Algebra'],
      sessionNotes: undefined,
    }),
  );
  expect(order).toEqual(['endSession', 'endTimer']);
  expect(mockReplace).toHaveBeenCalledWith('/lesson/session-1?justSaved=1');
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
});

test('paused time is excluded from the actual duration (DB-derived)', () => {
  mockSession = session({ started_at: minsBefore(70), paused_seconds: 10 * 60 });
  const screen = renderScreen();
  fireEvent.press(screen.getByText(/Save lesson/));
  expect(endSession).toHaveBeenCalledWith(expect.objectContaining({ durationMinutes: 60 }));
});

test('billing default: booked length when actual is within 15 min', () => {
  mockSession = session({ started_at: minsBefore(52) });
  const screen = renderScreen();
  fireEvent.press(screen.getByText(/Save lesson/));
  expect(endSession).toHaveBeenCalledWith(expect.objectContaining({ billedMinutes: 60 }));
});

test('billing default: actual rounded to 15 min when far from booking; no warning until tutor changes it', () => {
  mockSession = session({ started_at: minsBefore(80), estimated_duration_minutes: null });
  const screen = renderScreen();
  expect(screen.getByText('1h 15m')).toBeTruthy();
  expect(screen.queryByText(/Billing .* taught/)).toBeNull();

  fireEvent.press(screen.getByLabelText('Bill 15 minutes more'));
  fireEvent.press(screen.getByLabelText('Bill 15 minutes more'));
  expect(screen.getByText('Billing 1h 45m for 1h 20m taught.')).toBeTruthy();

  fireEvent.press(screen.getByText(/Reset to 1h 15m/));
  expect(screen.queryByText(/Billing .* taught/)).toBeNull();
});

test('tap value to type minutes', () => {
  const screen = renderScreen();
  fireEvent.press(screen.getByLabelText(/Tap to type minutes/));
  const input = screen.getByLabelText('Billed minutes');
  fireEvent.changeText(input, '45');
  fireEvent.press(screen.getByText(/Save lesson/));
  expect(endSession).toHaveBeenCalledWith(expect.objectContaining({ billedMinutes: 45 }));
});

test('Back returns to the running timer without resetting it or showing a false promise', () => {
  const screen = renderScreen();
  fireEvent.press(screen.getByLabelText('Back to timer'));
  expect(mockBack).toHaveBeenCalled();
  expect(mockEndTimer).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(screen.queryByText(/won't be lost/)).toBeNull();
  expect(screen.queryByText(/Save draft/)).toBeNull();
});

test('notes survive leaving and re-entering the review', () => {
  const first = renderScreen();
  fireEvent.changeText(first.getByPlaceholderText(/What did you cover/), 'Factorising');
  first.unmount();
  const second = renderScreen();
  expect(second.getByDisplayValue('Factorising')).toBeTruthy();
});

test('failed save keeps the timer running and stays on the screen', () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  (endSession as jest.Mock).mockImplementation(() => {
    throw new Error('disk full');
  });
  const screen = renderScreen();
  fireEvent.press(screen.getByText(/Save lesson/));
  expect(mockEndTimer).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith('Could not save lesson', expect.stringContaining('Nothing was deducted'));
});

test('already-closed lesson (double save) does not reset the timer blindly', () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  (endSession as jest.Mock).mockImplementation(() => {
    throw new SessionError('INVALID_STATE');
  });
  const screen = renderScreen();
  fireEvent.press(screen.getByText(/Save lesson/));
  expect(mockEndTimer).not.toHaveBeenCalled();
  expect(mockRefresh).toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith('Lesson already closed', expect.any(String), expect.any(Array));
});

test('negative balance asks to confirm (nudge, not block)', () => {
  mockSession = session({ started_at: minsBefore(360), estimated_duration_minutes: null });
  const screen = renderScreen();
  fireEvent.press(screen.getByText(/Save lesson/));
  expect(endSession).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith('Balance will go negative', expect.stringContaining('OWES 1h'), expect.any(Array));
});

test('re-entering the review recomputes the auto billing default from the longer elapsed time', () => {
  // First visit after 1 minute → auto default 15m (tutor did not touch it).
  mockSession = session({ started_at: minsBefore(1) });
  const first = renderScreen();
  first.unmount();
  // Back to the timer, keep teaching, End again after 53 minutes.
  mockSession = session({ started_at: minsBefore(53) });
  const second = renderScreen();
  fireEvent.press(second.getByText(/Save lesson/));
  expect(endSession).toHaveBeenCalledWith(expect.objectContaining({ billedMinutes: 60 }));
});

test('a billing amount the tutor changed survives re-entering the review', () => {
  const first = renderScreen();
  fireEvent.press(first.getByLabelText('Bill 15 minutes more'));
  first.unmount();
  const second = renderScreen();
  fireEvent.press(second.getByText(/Save lesson/));
  expect(endSession).toHaveBeenCalledWith(expect.objectContaining({ billedMinutes: 75 }));
});

test('topics: persisted to the in-flight row; restored from it when the param is missing (app was killed)', () => {
  const first = renderScreen();
  expect(saveLiveTopics).toHaveBeenCalledWith('session-1', ['Algebra']);
  first.unmount();

  mockTopicsParam = undefined;
  mockSession = session({ topics: '["Geometry"]' });
  const screen = renderScreen();
  fireEvent.press(screen.getByText(/Save lesson/));
  expect(endSession).toHaveBeenCalledWith(expect.objectContaining({ topics: ['Geometry'] }));
});

test('save from a lesson started on the student page: back to that page, then push the summary', () => {
  mockRootState = {
    index: 2,
    routes: [
      { name: '(app)' },
      { name: 'student', state: { index: 0, routes: [{ name: '[id]/index', params: { id: 'student-1' } }] } },
      {
        name: 'student',
        state: {
          index: 1,
          routes: [
            { name: '[id]/session', params: { id: 'student-1', sessionId: 'session-1' } },
            { name: '[id]/end-session', params: { id: 'student-1', sessionId: 'session-1' } },
          ],
        },
      },
    ],
  };
  (endSession as jest.Mock).mockImplementation(() => {});
  const screen = renderScreen();
  fireEvent.press(screen.getByText(/Save lesson/));
  expect(mockDispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'RESET',
      payload: expect.objectContaining({ index: 1, routes: [expect.anything(), expect.anything()] }),
    }),
  );
  expect(mockPush).toHaveBeenCalledWith('/lesson/session-1?justSaved=1');
  expect(mockReplace).not.toHaveBeenCalled();
});
