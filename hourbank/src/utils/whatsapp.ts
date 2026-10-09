import { Linking, Share } from 'react-native';

/**
 * Normalise a phone number to WhatsApp's international digits-only form.
 * SA local numbers: "082 123 4567" → "27821234567"; "+27…" / "0027…" kept as 27….
 * Other "+CC…" international numbers are passed through as digits.
 * Returns null when the input cannot be a valid number.
 */
export function normaliseSaPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (digits.length === 0) return null;

  if (!hasPlus && digits.startsWith('00')) digits = digits.slice(2);
  else if (!hasPlus && digits.startsWith('0') && digits.length === 10) digits = `27${digits.slice(1)}`;
  else if (!hasPlus && digits.length === 9 && !digits.startsWith('0')) digits = `27${digits}`;
  // "+27 082…" — trunk 0 kept after the country code
  if (digits.startsWith('270') && digits.length === 12) digits = `27${digits.slice(3)}`;

  if (digits.startsWith('27')) return digits.length === 11 ? digits : null;
  if (hasPlus || trimmed.startsWith('00')) {
    return digits.length >= 8 && digits.length <= 15 ? digits : null;
  }
  return null;
}

/** `whatsapp://send?phone=27…&text=…` (phone omitted when unknown/invalid). */
export function whatsappUrl(phone: string | null | undefined, text: string): string {
  const p = normaliseSaPhone(phone);
  const encoded = encodeURIComponent(text);
  return p ? `whatsapp://send?phone=${p}&text=${encoded}` : `whatsapp://send?text=${encoded}`;
}

export type WhatsAppResult = 'whatsapp' | 'share_sheet' | 'dismissed';

/**
 * Open WhatsApp pre-filled with `text` (to `phone` when valid). If WhatsApp is
 * not installed / the URL cannot be opened, falls back to the system share
 * sheet. Resolves with what happened so the UI can give feedback.
 * Note: 'whatsapp' means WhatsApp was opened — not that the message was sent.
 */
export async function openWhatsApp(phone: string | null | undefined, text: string): Promise<WhatsAppResult> {
  try {
    await Linking.openURL(whatsappUrl(phone, text));
    return 'whatsapp';
  } catch {
    const result = await Share.share({ message: text });
    return result.action === Share.dismissedAction ? 'dismissed' : 'share_sheet';
  }
}
