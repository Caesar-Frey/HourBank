import * as FileSystem from 'expo-file-system/legacy';
import { randomUUID } from 'expo-crypto';

/**
 * Proof-of-payment photos. Image pickers return URIs in the cache directory,
 * which the OS may purge at any time — persist them under
 * documentDirectory/proofs/ before storing the URI on a credit package.
 */

export function proofsDirectory(): string {
  if (!FileSystem.documentDirectory) throw new Error('No document directory available for proof images.');
  return `${FileSystem.documentDirectory}proofs/`;
}

/** Lower-case file extension of a URI (query/fragment stripped), default "jpg". */
export function fileExtension(uri: string): string {
  const path = uri.split(/[?#]/)[0];
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(path);
  return match ? match[1].toLowerCase() : 'jpg';
}

export async function ensureProofsDirectory(): Promise<string> {
  const dir = proofsDirectory();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

/**
 * Copy a (cache) image into permanent app storage and return the new URI.
 * Already-persisted URIs are returned unchanged.
 */
export async function persistProofImage(sourceUri: string): Promise<string> {
  const dir = await ensureProofsDirectory();
  if (sourceUri.startsWith(dir)) return sourceUri;
  const dest = `${dir}${randomUUID()}.${fileExtension(sourceUri)}`;
  await FileSystem.copyAsync({ from: sourceUri, to: dest });
  return dest;
}
