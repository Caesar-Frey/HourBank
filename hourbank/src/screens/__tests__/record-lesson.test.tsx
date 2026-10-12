import React from 'react';
import { Alert, AlertButton } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const NOW = Date.now();
const iso = (minOffset: number) => new Date(NOW + minOffset * 60_000).toISOString();

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockToast = jest.fn();
let mockSession: Record<string, unknown> | null = null;
let mockInClaim = false;
let mockOverLimit = false;

jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useNavigationContainerRef: () => ({ getRootState: () => null, dispatch: jest.fn() }),
}));
jest.mock('../../db/students', () => ({
  getStudent: () => ({
    id: 'stu-1', full_name: 'Thandi Mokoena', subject: 'Maths', grade: 10, travel_distance_km: 20,
    parent_travel_mode: 'per_km', parent_travel_flat_fee: 0, parent_travel_per_km: 6,
  }),
}));
jest.mock('../../db/subjects', () => ({ getSubjectBalance: () => 0, isSubjectError: () => false }));
jest.mock('../../db/catalog', () => ({ addCustomTopicForSubject: jest.fn() }));
jest.mock('../../components/lesson/lessonFormData', () => ({
  ...jest.requireActual('../../components/lesson/lessonFormData'),
  loadSubjectOptions: () => ({
    options: [{ id: 'ss-1', subject: 'Maths', balance: 3 }, { id: 'ss-2', subject: 'Science', balance: 1 }],
    primaryId: 'ss-1',
  }),
  catalogTopics: (name: string) => (name === 'Science' ? ['Cells'] : ['Algebra']),
  claimLabelForSession: () => 'Sep 2026',
  subjectNameFor: () => null,
}));
jest.mock('../../components/Toast', () => ({ useToast: () => ({ show: mockToast, hide: jest.fn() }) }));
jest.mock('../../db/sessions', () => {
  const actual = jest.requireActual('../../db/sessions');
  return {
    ...actual,
    getSession: () => mockSession,
    recordLesson: jest.fn(() => ({ session: { id: 'sess-new' }, entry: {} })),
    editLesson: jest.fn(() => ({ session: {}, inClaim: mockInClaim })),
    isSessionInClaim: () => mockInClaim,
    checkOweLimit: () => ({ overLimit: mockOverLimit }),
  };
});

import { LessonFormScreen, type LessonFormScreenProps } from '../../components/lesson/LessonFormScreen';
import { editLesson, recordLesson, SessionError } from '../../db/sessions';

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const renderForm = (props: LessonFormScreenProps) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <LessonFormScreen {...props} />
    </SafeAreaProvider>,
  );

let alertSpy: jest.SpyInstance;
function pressAlertButton(text: string) {
  const call = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
  const b = ((call[2] ?? []) as AlertButton[]).find(x => x.text === text);
  if (!b) throw new Error(`No alert button "${text}"`);
  act(() => b.onPress?.());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSession = null;
  mockInClaim = false;
  mockOverLimit = false;
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('record', () => {
  test('booked lesson: prefilled subject/minutes/km, live previews, saves via recordLesson', () => {
    mockSession = {
      id: 'sess-1', student_id: 'stu-1', status: 'scheduled', scheduled_for: iso(-90), estimated_duration_minutes: 90,
      mode: 'in_person', subject_id: 'ss-2', travel_km: 10, topics: '[]', session_notes: null,
    };
    const s = renderForm({ kind: 'record', studentId: 'stu-1', sessionId: 'sess-1' });
    expect(s.getByText('Science balance 1h → owes 30m')).toBeTruthy();
    expect(s.getByText(/Travel R.60\.00 added to travel owed/)).toBeTruthy();
    fireEvent.press(s.getByLabelText('Bill 15 minutes less'));
    expect(s.getByText('Science balance 1h → owes 15m')).toBeTruthy();
    fireEvent.press(s.getByText(/Record lesson · 1h 15m/));
    expect(recordLesson).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'sess-1', studentId: 'stu-1', subjectId: 'ss-2', billedMinutes: 75, mode: 'in_person', travelKm: 10,
      startedAt: iso(-90),
    }));
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/lesson/sess-new?justSaved=1');
  });

  test('unscheduled: primary subject, 60m default, student km; online hides km', () => {
    const s = renderForm({ kind: 'record', studentId: 'stu-1' });
    expect(s.getByText('Maths balance 3h → 2h')).toBeTruthy();
    expect(s.getByText(/Travel R.120\.00/)).toBeTruthy();
    fireEvent.press(s.getByLabelText('Online'));
    expect(s.queryByLabelText('Travel kilometres')).toBeNull();
    expect(s.queryByText(/Travel R/)).toBeNull();
    fireEvent.press(s.getByLabelText(/^Science/));
    expect(s.getByText('Cells')).toBeTruthy();
    fireEvent.press(s.getByText(/Record lesson/));
    expect(recordLesson).toHaveBeenCalledWith(expect.objectContaining({ subjectId: 'ss-2', mode: 'online', travelKm: null, billedMinutes: 60 }));
  });

  test('typed minutes + invalid km blocks saving', () => {
    const s = renderForm({ kind: 'record', studentId: 'stu-1' });
    fireEvent.press(s.getByLabelText(/Tap to type minutes/));
    fireEvent.changeText(s.getByLabelText('Billed minutes'), '45');
    fireEvent.changeText(s.getByLabelText('Travel kilometres'), 'abc');
    fireEvent.press(s.getByText(/Record lesson · 45m/));
    expect(recordLesson).not.toHaveBeenCalled();
    expect(s.getByText(/Enter the km/)).toBeTruthy();
  });

  test('over the owing limit: confirm, then record', () => {
    mockOverLimit = true;
    const s = renderForm({ kind: 'record', studentId: 'stu-1' });
    fireEvent.press(s.getByLabelText(/^Science/));
    fireEvent.press(s.getByLabelText('Bill 15 minutes more'));
    fireEvent.press(s.getByText(/Record lesson/));
    expect(recordLesson).not.toHaveBeenCalled();
    pressAlertButton('Record anyway');
    expect(recordLesson).toHaveBeenCalled();
  });

  test('save failure → friendly toast, stays', () => {
    (recordLesson as jest.Mock).mockImplementationOnce(() => { throw new SessionError('INVALID_STATE', 'x'); });
    const s = renderForm({ kind: 'record', studentId: 'stu-1' });
    fireEvent.press(s.getByText(/Record lesson/));
    expect(mockToast).toHaveBeenCalledWith({ kind: 'error', message: 'That lesson was already recorded or cancelled' });
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  test('already recorded lesson → not-found state', () => {
    mockSession = { id: 'sess-1', student_id: 'stu-1', status: 'completed' };
    const s = renderForm({ kind: 'record', studentId: 'stu-1', sessionId: 'sess-1' });
    expect(s.getByText('That lesson has already been recorded or cancelled.')).toBeTruthy();
  });
});

describe('edit', () => {
  const completed = {
    id: 'sess-1', student_id: 'stu-1', status: 'completed', started_at: iso(-600), ended_at: iso(-540),
    duration_minutes: 60, billed_minutes: 60, mode: 'in_person', subject_id: 'ss-1', travel_km: 20,
    parent_travel_fee: 100, topics: '["Algebra"]', session_notes: 'ok',
  };

  test('untouched → no changes; snapshot travel fee shown', () => {
    mockSession = { ...completed };
    const s = renderForm({ kind: 'edit', sessionId: 'sess-1' });
    expect(s.getByText('Maths balance 3h → 3h')).toBeTruthy();
    expect(s.getByText(/Travel R.100\.00 on travel owed/)).toBeTruthy();
    fireEvent.press(s.getByText('Save changes'));
    expect(editLesson).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({ kind: 'info', message: 'No changes to save' });
  });

  test('changed billed + km → editLesson with only those fields; claim banner shown', () => {
    mockInClaim = true;
    mockSession = { ...completed };
    const s = renderForm({ kind: 'edit', sessionId: 'sess-1' });
    expect(s.getByText(/payout claim for Sep 2026/)).toBeTruthy();
    fireEvent.press(s.getByLabelText('Bill 15 minutes more'));
    fireEvent.changeText(s.getByLabelText('Travel kilometres'), '25');
    expect(s.getByText(/Travel R.150\.00 added to travel owed \(was R.100\.00\)/)).toBeTruthy();
    fireEvent.press(s.getByText('Save changes'));
    expect(editLesson).toHaveBeenCalledWith('sess-1', { billedMinutes: 75, travelKm: 25 });
    expect(mockRouter.back).toHaveBeenCalled();
  });

  test('not completed → cannot edit', () => {
    mockSession = { ...completed, status: 'scheduled' };
    const s = renderForm({ kind: 'edit', sessionId: 'sess-1' });
    expect(s.getByText('Only recorded lessons can be edited.')).toBeTruthy();
  });

  test('charged no-show: no date/mode/travel/topics; saves billed + subject + notes only', () => {
    mockSession = {
      id: 'sess-1', student_id: 'stu-1', status: 'cancelled', cancel_reason: 'no_show', scheduled_for: iso(-120),
      started_at: null, ended_at: null, billed_minutes: 60, mode: 'in_person', subject_id: 'ss-1', travel_km: null,
      parent_travel_fee: null, topics: '[]', session_notes: null,
    };
    const s = renderForm({ kind: 'edit', sessionId: 'sess-1' });
    expect(s.getByText('★ EDIT NO-SHOW')).toBeTruthy();
    expect(s.queryByLabelText('Lesson date')).toBeNull();
    expect(s.queryByLabelText('Online')).toBeNull();
    expect(s.queryByLabelText('Travel kilometres')).toBeNull();
    expect(s.queryByText(/Travel R/)).toBeNull();
    fireEvent.press(s.getByLabelText('Bill 15 minutes less'));
    fireEvent.press(s.getByLabelText(/^Science/));
    fireEvent.changeText(s.getByLabelText('Lesson notes'), 'Parent forgot');
    fireEvent.press(s.getByText('Save changes'));
    expect(editLesson).toHaveBeenCalledWith('sess-1', { billedMinutes: 45, subjectId: 'ss-2', notes: 'Parent forgot' });
  });

  test('uncharged no-show → cannot edit', () => {
    mockSession = { ...completed, status: 'cancelled', cancel_reason: 'no_show', billed_minutes: null };
    const s = renderForm({ kind: 'edit', sessionId: 'sess-1' });
    expect(s.getByText('Only recorded lessons can be edited.')).toBeTruthy();
  });
});
