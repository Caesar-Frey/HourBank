/**
 * recipient.ts — who an outgoing WhatsApp message goes to: the parent or the
 * student (some students handle payments/communication themselves). Pure.
 */
import { normaliseSaPhone } from './whatsapp';
import type { PreferredContact } from '../db/schema';

export type RecipientStudent = {
  full_name: string;
  parent_name?: string | null;
  parent_phone?: string | null;
  student_phone?: string | null;
  preferred_contact?: PreferredContact | null;
};

export type Recipient = {
  /** Normalised WhatsApp digits, or null (WhatsApp then asks for a contact / share sheet). */
  phone: string | null;
  /** Name to greet: parent's name, or the student's first name. */
  name: string | null;
  who: PreferredContact;
};

function firstName(fullName: string | null | undefined): string | null {
  return fullName?.trim().split(/\s+/)[0] || null;
}

function phones(s: RecipientStudent) {
  return { parent: normaliseSaPhone(s.parent_phone), student: normaliseSaPhone(s.student_phone) };
}

function recipientFor(s: RecipientStudent, who: PreferredContact, phone: string | null): Recipient {
  return {
    phone,
    name: who === 'parent' ? s.parent_name?.trim() || null : firstName(s.full_name),
    who,
  };
}

export function resolveRecipient(s: RecipientStudent, override?: PreferredContact | null): Recipient {
  const p = phones(s);
  const preferred: PreferredContact = s.preferred_contact === 'student' ? 'student' : 'parent';
  for (const who of [override, preferred] as Array<PreferredContact | null | undefined>) {
    if (who && p[who]) return recipientFor(s, who, p[who]);
  }
  if (p.parent) return recipientFor(s, 'parent', p.parent);
  if (p.student) return recipientFor(s, 'student', p.student);
  return recipientFor(s, override ?? preferred, null);
}

/** Chooser options — empty unless both numbers are valid (otherwise there is no choice). */
export function recipientOptions(s: RecipientStudent): Array<{ value: PreferredContact; label: string }> {
  const p = phones(s);
  if (!p.parent || !p.student) return [];
  const parentFirst = firstName(s.parent_name);
  const studentFirst = firstName(s.full_name);
  return [
    { value: 'parent', label: parentFirst ? `Parent (${parentFirst})` : 'Parent' },
    { value: 'student', label: studentFirst ? `Student (${studentFirst})` : 'Student' },
  ];
}

/** What to store as preferred_contact given the numbers typed in the form. */
export function defaultPreferredContact(
  parentPhone: string | null | undefined,
  studentPhone: string | null | undefined,
  chosen: PreferredContact
): PreferredContact {
  const hasParent = !!normaliseSaPhone(parentPhone);
  const hasStudent = !!normaliseSaPhone(studentPhone);
  if (hasStudent && !hasParent) return 'student';
  if (hasParent && !hasStudent) return 'parent';
  return chosen;
}
