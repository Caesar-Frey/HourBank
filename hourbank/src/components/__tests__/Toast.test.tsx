import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Error: 'error' },
}));

import * as Haptics from 'expo-haptics';
import { ToastProvider, useToast, ToastOptions } from '../Toast';

function Trigger({ opts }: { opts: ToastOptions }) {
  const toast = useToast();
  return (
    <TouchableOpacity onPress={() => toast.show(opts)}>
      <Text>trigger</Text>
    </TouchableOpacity>
  );
}

function renderWith(opts: ToastOptions) {
  return render(
    <ToastProvider>
      <Trigger opts={opts} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

test('shows message and fires light haptic on success', () => {
  const screen = renderWith({ kind: 'success', message: 'Top-up added' });
  expect(screen.queryByText('Top-up added')).toBeNull();
  fireEvent.press(screen.getByText('trigger'));
  expect(screen.getByText('Top-up added')).toBeTruthy();
  expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
});

test('error toast fires error notification haptic and is assertive', () => {
  const screen = renderWith({ kind: 'error', message: 'Could not save' });
  fireEvent.press(screen.getByText('trigger'));
  expect(Haptics.notificationAsync).toHaveBeenCalledWith('error');
  expect(screen.getByTestId('toast').props.accessibilityLiveRegion).toBe('assertive');
});

test('action button calls onAction and dismisses', () => {
  const onAction = jest.fn();
  const screen = renderWith({ kind: 'info', message: 'Lesson cancelled', actionLabel: 'Undo', onAction });
  fireEvent.press(screen.getByText('trigger'));
  fireEvent.press(screen.getByText('Undo'));
  expect(onAction).toHaveBeenCalledTimes(1);
  act(() => {
    jest.runAllTimers();
  });
  expect(screen.queryByText('Lesson cancelled')).toBeNull();
});

test('auto-dismisses after durationMs', () => {
  const screen = renderWith({ kind: 'info', message: 'Saved', durationMs: 1000 });
  fireEvent.press(screen.getByText('trigger'));
  expect(screen.getByText('Saved')).toBeTruthy();
  act(() => {
    jest.advanceTimersByTime(1000);
  });
  act(() => {
    jest.runAllTimers();
  });
  expect(screen.queryByText('Saved')).toBeNull();
});

test('useToast outside provider is a safe no-op', () => {
  const screen = render(<Trigger opts={{ kind: 'success', message: 'x' }} />);
  expect(() => fireEvent.press(screen.getByText('trigger'))).not.toThrow();
});
