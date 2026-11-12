import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const R = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn(), setParams: jest.fn(), navigate: jest.fn() }),
    useLocalSearchParams: () => ({}),
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

const mockToast = jest.fn();
jest.mock('../../Toast', () => ({ useToast: () => ({ show: mockToast, hide: jest.fn() }) }));

const mockEndTimer = jest.fn();
jest.mock('../../../contexts/SessionTimerContext', () => ({
  useSessionTimer: () => ({ status: 'idle', endTimer: mockEndTimer }),
}));

const mockProfile = {
  id: 'p1', full_name: 'Tutor', hourly_rate: 300, parent_hourly_price: 450, currency: 'ZAR', max_owe_hours: 0,
  tier_system_enabled: 1, travel_mode: 'flat', per_km_rate: 0, payment_details: null, billing_round_minutes: 15,
  package_tiers: JSON.stringify([{ hours: 10, price: 5500, label: 'Best Value', sort_order: 0 }]),
  last_backup_at: null, selected_subject_ids: '[]', created_at: '', updated_at: '',
  rates_confirmed_at: '2026-01-01T00:00:00.000Z',
};
jest.mock('../../../db/tutorProfile', () => ({
  getOrCreateTutorProfile: jest.fn(() => mockProfile),
  upsertTutorProfile: jest.fn((patch: object) => ({ ...mockProfile, ...patch })),
}));
jest.mock('../../../db/seed', () => ({ seedDemoData: jest.fn(), resetDb: jest.fn() }));
jest.mock('../../../db/migrations', () => ({ ALL_MIGRATIONS: [{ version: '001' }] }));
jest.mock('../../../utils/backup', () => ({
  exportDatabase: jest.fn(),
  getLastBackupAt: jest.fn(async () => null),
  importBackup: jest.fn(),
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('../../../db/students', () => ({
  listActiveStudents: jest.fn(() => [{ id: 'stu-1', full_name: 'Sipho Ndlovu' }]),
}));

import SettingsScreen from '../../../../app/(app)/profile';
import { upsertTutorProfile } from '../../../db/tutorProfile';
import { exportDatabase, importBackup } from '../../../utils/backup';
import * as DocumentPicker from 'expo-document-picker';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('parent price autosaves on blur with SA decimal input and a Saved toast', () => {
  const screen = render(<SettingsScreen />);
  const field = screen.getByTestId('parent-price');
  fireEvent.changeText(field, '450,50');
  expect(screen.getByText('= R 450.50')).toBeTruthy();
  fireEvent(field, 'blur');
  expect(upsertTutorProfile).toHaveBeenCalledWith({ parent_hourly_price: 450.5 });
  expect(mockToast).toHaveBeenCalledWith({ kind: 'success', message: 'Saved' });
});

test('payment reference: live preview from first student, chips insert + autosave, long warning', () => {
  const screen = render(<SettingsScreen />);
  const field = screen.getByTestId('payment-reference-template');
  expect(screen.getByText('Preview: Sipho Ndlovu')).toBeTruthy();

  fireEvent.changeText(field, '{SURNAME}{initial}');
  expect(screen.getByText('Preview: NDLOVUS')).toBeTruthy();
  fireEvent(field, 'blur');
  expect(upsertTutorProfile).toHaveBeenCalledWith({ payment_reference_template: '{SURNAME}{initial}' });
  expect(mockToast).toHaveBeenCalledWith({ kind: 'success', message: 'Saved' });

  fireEvent.press(screen.getByLabelText('Insert Month'));
  expect(upsertTutorProfile).toHaveBeenLastCalledWith({ payment_reference_template: '{SURNAME}{initial} {month}' });

  fireEvent.changeText(field, '{first} {surname} {month} {id}');
  expect(screen.getByText(/Most banks allow/)).toBeTruthy();
});

test('payment reference: blank resets to the default', () => {
  const screen = render(<SettingsScreen />);
  const field = screen.getByTestId('payment-reference-template');
  fireEvent.changeText(field, '   ');
  fireEvent(field, 'blur');
  expect(upsertTutorProfile).toHaveBeenCalledWith({ payment_reference_template: '{first} {surname}' });
});

test('payout rate is a separate column', () => {
  const screen = render(<SettingsScreen />);
  fireEvent.changeText(screen.getByTestId('payout-rate'), '320');
  fireEvent(screen.getByTestId('payout-rate'), 'blur');
  expect(upsertTutorProfile).toHaveBeenCalledWith({ hourly_rate: 320 });
});

test('invalid amount shows an inline error and never saves 0', () => {
  const screen = render(<SettingsScreen />);
  fireEvent.changeText(screen.getByTestId('max-owe'), 'abc');
  fireEvent(screen.getByTestId('max-owe'), 'blur');
  expect(screen.getByText(/Enter a number/)).toBeTruthy();
  expect(upsertTutorProfile).not.toHaveBeenCalled();
});

test('unchanged blur does not write or toast', () => {
  const screen = render(<SettingsScreen />);
  fireEvent(screen.getByTestId('parent-price'), 'blur');
  expect(upsertTutorProfile).not.toHaveBeenCalled();
  expect(mockToast).not.toHaveBeenCalled();
});

test('failed write shows an error toast, not Saved', () => {
  (upsertTutorProfile as jest.Mock).mockImplementationOnce(() => { throw new Error('disk full'); });
  const screen = render(<SettingsScreen />);
  fireEvent.changeText(screen.getByTestId('parent-price'), '500');
  fireEvent(screen.getByTestId('parent-price'), 'blur');
  expect(mockToast).toHaveBeenCalledWith({ kind: 'error', message: expect.stringContaining("Couldn't save") });
  expect(mockToast).not.toHaveBeenCalledWith({ kind: 'success', message: 'Saved' });
});

test('a 0h package is rejected on blur', () => {
  const screen = render(<SettingsScreen />);
  const hours = screen.getByLabelText('Package hours');
  fireEvent.changeText(hours, '0');
  fireEvent(hours, 'blur');
  expect(screen.getByText('Must be more than 0')).toBeTruthy();
  expect(upsertTutorProfile).not.toHaveBeenCalled();
});

test('deleting a package asks first', () => {
  const screen = render(<SettingsScreen />);
  fireEvent.press(screen.getByLabelText('Delete 10h package'));
  expect(Alert.alert).toHaveBeenCalledWith('Delete package?', expect.stringContaining('10h package'), expect.any(Array));
  expect(upsertTutorProfile).not.toHaveBeenCalled();
  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
  act(() => buttons.find((b: { text: string }) => b.text === 'Delete').onPress());
  expect(upsertTutorProfile).toHaveBeenCalledWith({ package_tiers: '[]' });
});

test('Back up now ignores a double tap', async () => {
  let resolve!: () => void;
  (exportDatabase as jest.Mock).mockImplementation(() => new Promise<void>(r => { resolve = r; }));
  const screen = render(<SettingsScreen />);
  fireEvent.press(screen.getByText('Back up now'));
  fireEvent.press(screen.getByText('Preparing backup…'));
  expect(exportDatabase).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
});

test('restore: pick → summary → type RESTORE → restore, reset timer, go home', async () => {
  const restore = jest.fn(async () => ({ proofImages: 0 }));
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///b.db' }] });
  (importBackup as jest.Mock).mockResolvedValue({
    summary: {
      students: 4, activeStudents: 3, sessions: 20, ledgerRows: 30, lastEntryAt: null,
      proofImages: 0, exportedAt: null, migrationVersions: [],
    },
    restore,
    cancel: jest.fn(async () => {}),
  });
  const screen = render(<SettingsScreen />);
  fireEvent.press(screen.getByText('Restore from a backup file…'));
  await waitFor(() => screen.getByText('Restore this backup?'));
  expect(importBackup).toHaveBeenCalledWith('file:///b.db', [{ version: '001' }]);
  expect(screen.getByText('4 (3 active)')).toBeTruthy();

  fireEvent.press(screen.getByText('Restore'));
  expect(restore).not.toHaveBeenCalled();

  fireEvent.changeText(screen.getByLabelText('Type RESTORE to confirm'), 'RESTORE');
  await act(async () => {
    fireEvent.press(screen.getByText('Restore'));
  });
  expect(restore).toHaveBeenCalledTimes(1);
  expect(mockEndTimer).toHaveBeenCalled();
  expect(mockReplace).toHaveBeenCalledWith('/');
  expect(mockToast).toHaveBeenCalledWith({ kind: 'success', message: 'Backup restored — 4 students.' });
});

test('restore: cancelled picker does nothing; bad file gets friendly copy', async () => {
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({ canceled: true, assets: null });
  const screen = render(<SettingsScreen />);
  await act(async () => {
    fireEvent.press(screen.getByText('Restore from a backup file…'));
  });
  expect(importBackup).not.toHaveBeenCalled();

  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///x.pdf' }] });
  (importBackup as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'BackupError', code: 'NOT_SQLITE' }));
  await act(async () => {
    fireEvent.press(screen.getByText('Restore from a backup file…'));
  });
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'error',
    message: expect.stringContaining("isn't an HourBank backup"),
    detail: 'NOT_SQLITE',
  }));
});
