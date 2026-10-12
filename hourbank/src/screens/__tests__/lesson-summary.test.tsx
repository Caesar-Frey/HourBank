import React from 'react';
import { Alert, AlertButton, Share } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const NOW = Date.now();
const iso = (minOffset: number) => new Date(NOW + minOffset * 60_000).toISOString();

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockToast = jest.fn();
let mockSession: Record<string, unknown> | null = null;
let mockEntry: Record<string, unknown> | null = null;
let mockStudent: Record<string, unknown> | null = null;

jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('expo-router', () => {
  const R = jest.requireActual('react');
  return {
    useLocalSearchParams: () => ({ sessionId: 'sess-1' }),
    useRouter: () => mockRouter,
    useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]),
  };
});
jest.mock('../../db/students', () => ({ getStudent: () => mockStudent }));
jest.mock('../../db/ledger', () => ({ currentBalance: () => 0.5, getSessionDeduction: () => mockEntry }));
jest.mock('../../db/subjects', () => ({
  getPrimarySubjectId: () => 'ss-1',
  getStudentSubject: (id: string) => ({ id, subject: id === 'ss-2' ? 'Science' : 'Maths' }),
  getSubjectBalance: () => 0.5,
}));
jest.mock('../../utils/receipt', () => ({
  getLessonReceiptText: jest.fn(() => 'Lesson summary text'),
  getSessionReceipt: jest.fn(() => null),
  shareSessionReceipt: jest.fn(async () => ({ shared: true, uri: 'file://r.pdf' })),
}));
jest.mock('../../utils/whatsapp', () => ({
  ...jest.requireActual('../../utils/whatsapp'),
  openWhatsApp: jest.fn(async () => 'whatsapp'),
}));
jest.mock('../../components/Toast', () => ({ useToast: () => ({ show: mockToast, hide: jest.fn() }) }));
jest.mock('../../contexts/SessionTimerContext', () => ({ useSessionTimer: () => ({ refreshFromDb: jest.fn() }) }));
jest.mock('../../db/sessions', () => {
  const actual = jest.requireActual('../../db/sessions');
  return {
    ...actual,
    getSession: () => mockSession,
    cancelScheduled: jest.fn(),
    markNoShow: jest.fn(),
    startSession: jest.fn(),
  };
});

import LessonScreen from '../../../app/lesson/[sessionId]';
import { cancelScheduled, markNoShow, startSession, SessionError } from '../../db/sessions';
import { openWhatsApp } from '../../utils/whatsapp';

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const renderScreen = () =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <LessonScreen />
    </SafeAreaProvider>,
  );

function base(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    student_id: 'stu-1',
    mode: 'in_person',
    session_type: 'general',
    status: 'completed',
    cancel_reason: null,
    scheduled_for: iso(-120),
    started_at: iso(-120),
    ended_at: iso(-60),
    estimated_duration_minutes: 60,
    duration_minutes: 60,
    billed_minutes: 60,
    paused_seconds: 0,
    topics: '["Algebra"]',
    session_notes: null,
    ...overrides,
  };
}

let alertSpy: jest.SpyInstance;
function pressAlertButton(text: string) {
  const call = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
  const buttons = (call[2] ?? []) as AlertButton[];
  const b = buttons.find(x => x.text === text);
  if (!b) throw new Error(`No alert button "${text}" in ${JSON.stringify(buttons.map(x => x.text))}`);
  act(() => b.onPress?.());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStudent = { id: 'stu-1', full_name: 'Thandi Mokoena', subject: 'Maths', grade: 10, parent_name: 'Mrs Mokoena', parent_phone: '082 123 4567' };
  mockEntry = { id: 'le-1', hours_delta: -1, balance_after: -1 };
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('not found shows a back button (no dead end)', () => {
  mockSession = null;
  const s = renderScreen();
  expect(s.getByText('Lesson not found')).toBeTruthy();
  fireEvent.press(s.getByText('Go back'));
  expect(mockRouter.back).toHaveBeenCalled();
});

test('completed: badge, 2×2 tiles with OWES, time range', () => {
  mockSession = base();
  const s = renderScreen();
  expect(s.getByText('COMPLETED')).toBeTruthy();
  expect(s.getByText('Duration')).toBeTruthy();
  expect(s.getByText('Billed')).toBeTruthy();
  expect(s.getByText('Balance before')).toBeTruthy();
  expect(s.getByText('OWES 1h')).toBeTruthy();
  expect(s.getByText(/\d\d:\d\d–\d\d:\d\d/)).toBeTruthy();
});

test('completed: lesson subject, edited stamp and Edit lesson action', () => {
  mockSession = base({ subject_id: 'ss-2', edited_at: iso(-10), travel_km: 12, parent_travel_fee: 72 });
  const s = renderScreen();
  expect(s.getByText(/Science/)).toBeTruthy();
  expect(s.getByText(/^Edited /)).toBeTruthy();
  expect(s.getByText(/12 km · R.72[.]00 to parent/)).toBeTruthy();
  fireEvent.press(s.getByText('Edit lesson'));
  expect(mockRouter.push).toHaveBeenCalledWith('/lesson/edit/sess-1');
});

test('future booking still offers Record lesson as the primary action', () => {
  mockEntry = null;
  mockSession = base({ status: 'scheduled', scheduled_for: iso(120), started_at: null, ended_at: null, duration_minutes: null, billed_minutes: null });
  const s = renderScreen();
  expect(s.getByText('Record lesson')).toBeTruthy();
  expect(s.queryByText('No-show…')).toBeNull();
});

test('Send via WhatsApp uses the parent number and reflects the outcome', async () => {
  mockSession = base();
  const s = renderScreen();
  fireEvent.press(s.getByText('Send to Mrs Mokoena via WhatsApp'));
  await waitFor(() => expect(s.getByText(/Opened in WhatsApp \d\d:\d\d · Send again/)).toBeTruthy());
  expect(openWhatsApp).toHaveBeenCalledWith('27821234567', 'Lesson summary text');
});

test('no parent phone → system share sheet; dismissal does not mark as sent', async () => {
  mockSession = base();
  mockStudent = { ...mockStudent, parent_phone: null };
  const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction } as never);
  const s = renderScreen();
  fireEvent.press(s.getByText('Share lesson summary'));
  await waitFor(() => expect(shareSpy).toHaveBeenCalledWith({ message: 'Lesson summary text' }));
  expect(s.queryByText(/✓/)).toBeNull();
  expect(openWhatsApp).not.toHaveBeenCalled();
});

test('no-show / cancelled badges', () => {
  mockSession = base({ status: 'cancelled', cancel_reason: 'no_show', billed_minutes: null });
  mockEntry = null;
  const s = renderScreen();
  expect(s.getByText('NO-SHOW')).toBeTruthy();
  expect(s.getByText(/not charged/)).toBeTruthy();
});

describe('overdue lesson = action hub', () => {
  beforeEach(() => {
    mockEntry = null;
    mockSession = base({ status: 'scheduled', started_at: null, ended_at: null, duration_minutes: null, billed_minutes: null });
  });

  test('shows OVERDUE and every action', () => {
    const s = renderScreen();
    expect(s.getByText('OVERDUE')).toBeTruthy();
    ['Record lesson', '▶ Start timer', 'No-show…', 'Reschedule', 'Cancel lesson'].forEach(l => expect(s.getByText(l)).toBeTruthy());
    expect(s.getByText('After lesson')).toBeTruthy();
  });

  test('Record lesson / Reschedule route per contract', () => {
    const s = renderScreen();
    fireEvent.press(s.getByText('Record lesson'));
    expect(mockRouter.push).toHaveBeenCalledWith('/student/stu-1/log-past?sessionId=sess-1&from=lesson');
    fireEvent.press(s.getByText('Reschedule'));
    expect(mockRouter.push).toHaveBeenCalledWith('/student/stu-1/schedule?sessionId=sess-1&from=lesson');
  });

  test('Cancel requires confirm then calls cancelScheduled', () => {
    const s = renderScreen();
    fireEvent.press(s.getByText('Cancel lesson'));
    expect(cancelScheduled).not.toHaveBeenCalled();
    pressAlertButton('Cancel lesson');
    expect(cancelScheduled).toHaveBeenCalledWith('sess-1');
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });

  test('Start now: OVER_OWE_LIMIT → confirm → retry with allowOverOwe → timer', () => {
    (startSession as jest.Mock)
      .mockImplementationOnce(() => {
        throw new SessionError('OVER_OWE_LIMIT', 'x', { projectedBalanceHours: -0.5, maxOweHours: 0, lessonMinutes: 60 });
      })
      .mockImplementationOnce(() => ({ id: 'sess-1', student_id: 'stu-1', status: 'active' }));
    const s = renderScreen();
    fireEvent.press(s.getByText('▶ Start timer'));
    expect(alertSpy).toHaveBeenLastCalledWith('Start anyway?', expect.stringContaining('owe 30m'), expect.any(Array));
    pressAlertButton('Start anyway');
    expect(startSession).toHaveBeenLastCalledWith('sess-1', { allowOverOwe: true });
    expect(mockRouter.replace).toHaveBeenCalledWith('/student/stu-1/session?sessionId=sess-1');
  });

  test('Start now: ALREADY_ACTIVE offers to open the running lesson', () => {
    (startSession as jest.Mock).mockImplementationOnce(() => {
      throw new SessionError('ALREADY_ACTIVE', 'x', { activeSessionId: 'other', activeStudentId: 'stu-9' });
    });
    const s = renderScreen();
    fireEvent.press(s.getByText('▶ Start timer'));
    pressAlertButton('Open live lesson');
    expect(mockRouter.push).toHaveBeenCalledWith('/student/stu-9/session?sessionId=other');
  });

  test('No-show sheet: charge toggle + minutes → markNoShow', () => {
    const s = renderScreen();
    fireEvent.press(s.getByText('No-show…'));
    fireEvent(s.getByLabelText('Charge for this lesson'), 'valueChange', true);
    fireEvent.press(s.getByText('Mark no-show · deduct 1h'));
    expect(markNoShow).toHaveBeenCalledWith('sess-1', { charge: true, minutes: 60 });
  });

  test('No-show without charge', () => {
    const s = renderScreen();
    fireEvent.press(s.getByText('No-show…'));
    fireEvent.press(s.getByText('Mark no-show · no charge'));
    expect(markNoShow).toHaveBeenCalledWith('sess-1', { charge: false, minutes: undefined });
  });
});
