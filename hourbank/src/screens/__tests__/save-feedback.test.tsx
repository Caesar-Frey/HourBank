import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}),
}));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('../../db/tutorProfile', () => ({
  getOrCreateTutorProfile: jest.fn(() => ({
    full_name: 'Tutor', hourly_rate: 600, currency: 'ZAR', max_owe_hours: 0,
    tier_system_enabled: 0, travel_mode: 'flat', per_km_rate: 0, package_tiers: '[]',
  })),
  upsertTutorProfile: jest.fn(),
}));
jest.mock('../../db/seed', () => ({ seedDemoData: jest.fn(), resetDb: jest.fn() }));
jest.mock('../../utils/backup', () => ({ exportDatabase: jest.fn() }));

import ProfileScreen from '../../../app/(app)/profile';
import { upsertTutorProfile } from '../../db/tutorProfile';

beforeEach(() => {
  jest.clearAllMocks();
  (upsertTutorProfile as jest.Mock).mockReset();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

test('failed settings write reports failure without a saved confirmation', () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  (upsertTutorProfile as jest.Mock).mockImplementation(() => { throw new Error('disk full'); });
  const screen = render(<ProfileScreen />);
  fireEvent.press(screen.getByText('Save settings'));
  expect(Alert.alert).toHaveBeenCalledWith('Error', expect.stringContaining('Could not save settings'));
  expect(Alert.alert).not.toHaveBeenCalledWith('Saved', 'Settings saved.');
});

test('successful settings write retains the saved confirmation', () => {
  const screen = render(<ProfileScreen />);
  fireEvent.press(screen.getByText('Save settings'));
  expect(upsertTutorProfile).toHaveBeenCalledWith(expect.objectContaining({ full_name: 'Tutor' }));
  expect(Alert.alert).toHaveBeenCalledWith('Saved', 'Settings saved.');
});

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

// End-of-lesson save behaviour lives in end-session.test.tsx (WS-3).
