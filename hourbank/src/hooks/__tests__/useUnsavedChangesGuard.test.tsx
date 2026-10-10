import { Alert } from 'react-native';
import { renderHook } from '@testing-library/react-native';

type Listener = (e: { preventDefault: () => void; data: { action: unknown } }) => void;
let mockListener: Listener | null = null;
const mockDispatch = jest.fn();
const mockNavigation = {
  addListener: (_: string, l: Listener) => {
    mockListener = l;
    return () => { mockListener = null; };
  },
  dispatch: mockDispatch,
};
jest.mock('expo-router', () => ({ useNavigation: () => mockNavigation }));

import { useUnsavedChangesGuard } from '../useUnsavedChangesGuard';

const COPY = { message: 'This student has not been added yet.' };

function leave() {
  const e = { preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } };
  mockListener!(e);
  return e;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListener = null;
});

test('clean form: back goes straight through', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  renderHook(() => useUnsavedChangesGuard(false, COPY));
  const e = leave();
  expect(e.preventDefault).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
});

test('dirty form: back is stopped and a discard prompt is shown; Discard continues', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  renderHook(() => useUnsavedChangesGuard(true, COPY));
  const e = leave();
  expect(e.preventDefault).toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith('Discard changes?', COPY.message, expect.any(Array));
  const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
  expect(buttons.map(b => b.text)).toEqual(['Keep editing', 'Discard']);
  buttons[1].onPress!();
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
});

test('dirty form after allowLeave (saved): navigation is not blocked', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const { result } = renderHook(() => useUnsavedChangesGuard(true, COPY));
  result.current.allowLeave();
  const e = leave();
  expect(e.preventDefault).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
});

test('tracks the latest dirty value without re-subscribing', () => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const { rerender } = renderHook(({ d }: { d: boolean }) => useUnsavedChangesGuard(d, COPY), { initialProps: { d: false } });
  rerender({ d: true });
  expect(leave().preventDefault).toHaveBeenCalled();
});
