import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}),
}));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({
    id: 'student-1', sessionId: 'session-1', elapsedSeconds: '3600',
    pausedSeconds: '0', mode: 'online', topics: encodeURIComponent('["Algebra"]'),
  }),
  useRouter: () => ({ replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('../../db/students', () => ({ getStudent: () => ({ id: 'student-1', full_name: 'Sam Student', subject: 'Maths' }) }));
jest.mock('../../db/ledger', () => ({ currentBalance: () => 5 }));
jest.mock('../../db/catalog', () => ({ listTopicsForStudentSubject: () => [{ name: 'Algebra' }] }));
jest.mock('../../db/sessions', () => ({ getSession: () => ({ scheduled_for: null }), endSession: jest.fn() }));
jest.mock('../../utils/notifications', () => ({ sendReceipt: jest.fn(async () => {}) }));

import EndSessionScreen from '../../../app/student/[id]/end-session';
import { endSession } from '../../db/sessions';
import { sendReceipt } from '../../utils/notifications';

// Settings (profile.tsx) save-feedback tests moved to
// src/components/settings/__tests__/SettingsScreen.test.tsx (autosave + toast model).

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

test('session action promises saving and preserves completion without claiming receipt delivery', () => {
  const screen = render(<EndSessionScreen />);
  fireEvent.press(screen.getByText(/Save session/));
  expect(endSession).toHaveBeenCalledWith(expect.objectContaining({
    sessionId: 'session-1', durationMinutes: 60, billedMinutes: 60,
    pausedSeconds: 0, topics: ['Algebra'], sessionNotes: '',
  }));
  expect(sendReceipt).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith('Session saved.', '', expect.any(Array));
});
