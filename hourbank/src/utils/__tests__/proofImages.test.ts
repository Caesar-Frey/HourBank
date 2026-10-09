jest.mock('expo-file-system/legacy', () => ({
  __esModule: true,
  documentDirectory: 'file:///doc/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  makeDirectoryAsync: jest.fn(async () => {}),
  copyAsync: jest.fn(async () => {}),
}));

import * as FileSystem from 'expo-file-system/legacy';
import { persistProofImage, fileExtension } from '../proofImages';

describe('persistProofImage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('copies a cache image into documentDirectory/proofs and returns the new URI', async () => {
    const out = await persistProofImage('file:///cache/ImagePicker/abc.JPEG');
    expect(out).toMatch(/^file:\/\/\/doc\/proofs\/[0-9a-f-]{36}\.jpeg$/);
    expect(FileSystem.makeDirectoryAsync).toHaveBeenCalledWith('file:///doc/proofs/', { intermediates: true });
    expect(FileSystem.copyAsync).toHaveBeenCalledWith({ from: 'file:///cache/ImagePicker/abc.JPEG', to: out });
  });

  it('returns already-persisted URIs unchanged', async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValueOnce({ exists: true });
    await expect(persistProofImage('file:///doc/proofs/x.png')).resolves.toBe('file:///doc/proofs/x.png');
    expect(FileSystem.copyAsync).not.toHaveBeenCalled();
  });

  it('fileExtension strips queries and defaults to jpg', () => {
    expect(fileExtension('content://media/1?x=y')).toBe('jpg');
    expect(fileExtension('file:///a/b.png?v=2')).toBe('png');
  });
});
