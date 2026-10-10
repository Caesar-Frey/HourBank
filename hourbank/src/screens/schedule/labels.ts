/**
 * Display labels shared by Schedule (agenda + calendar) and Start lesson.
 * Never render raw enum values such as "test_prep" or "in_person".
 */

export type SessionTypeKey = 'general' | 'review' | 'test_prep' | 'exam_prep';
export type LessonModeKey = 'in_person' | 'online';

export const SESSION_TYPE_OPTIONS: { value: SessionTypeKey; label: string }[] = [
  { value: 'general',   label: 'General' },
  { value: 'review',    label: 'Review' },
  { value: 'test_prep', label: 'Test prep' },
  { value: 'exam_prep', label: 'Exam prep' },
];

export const MODE_OPTIONS: { value: LessonModeKey; label: string }[] = [
  { value: 'in_person', label: 'In person' },
  { value: 'online',    label: 'Online' },
];

/** "test_prep" → "Test prep". Unknown values are humanised, never shown raw. */
export function sessionTypeLabel(type: string | null | undefined): string {
  if (!type) return 'General';
  const hit = SESSION_TYPE_OPTIONS.find(o => o.value === type);
  if (hit) return hit.label;
  const words = type.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "in_person" → "In person". */
export function modeLabel(mode: string | null | undefined): string {
  return mode === 'online' ? 'Online' : 'In person';
}

/** EFT / Cash / Card / Other. */
export function paymentMethodLabel(method: string | null | undefined): string {
  switch (method) {
    case 'eft':   return 'EFT';
    case 'cash':  return 'Cash';
    case 'card':  return 'Card';
    case 'other': return 'Other';
    default:      return '';
  }
}
