import { resolveRecipient, recipientOptions, defaultPreferredContact } from '../recipient';

const both = {
  full_name: 'Amahle Dlamini',
  parent_name: 'Thandi Dlamini',
  parent_phone: '082 123 4567',
  student_phone: '083 111 2222',
  preferred_contact: 'parent' as const,
};

describe('resolveRecipient', () => {
  it('uses the preferred contact when both numbers exist', () => {
    expect(resolveRecipient(both)).toEqual({ phone: '27821234567', name: 'Thandi Dlamini', who: 'parent' });
    expect(resolveRecipient({ ...both, preferred_contact: 'student' })).toEqual({
      phone: '27831112222',
      name: 'Amahle',
      who: 'student',
    });
  });

  it('honours an override when that number exists', () => {
    expect(resolveRecipient(both, 'student')).toMatchObject({ who: 'student', phone: '27831112222', name: 'Amahle' });
  });

  it('falls back to whichever number exists', () => {
    expect(resolveRecipient({ ...both, parent_phone: null }, 'parent')).toMatchObject({ who: 'student', phone: '27831112222' });
    expect(resolveRecipient({ ...both, student_phone: '', preferred_contact: 'student' })).toMatchObject({
      who: 'parent',
      phone: '27821234567',
    });
  });

  it('treats invalid numbers as missing', () => {
    expect(resolveRecipient({ ...both, student_phone: '12', preferred_contact: 'student' })).toMatchObject({ who: 'parent' });
  });

  it('with no numbers: preferred audience, null phone (share sheet fallback)', () => {
    expect(resolveRecipient({ full_name: 'Liam', parent_name: null, parent_phone: null, student_phone: null })).toEqual({
      phone: null,
      name: null,
      who: 'parent',
    });
    expect(
      resolveRecipient({ full_name: 'Liam Smith', parent_phone: null, student_phone: null, preferred_contact: 'student' })
    ).toEqual({ phone: null, name: 'Liam', who: 'student' });
  });

  it('blank parent name → null name', () => {
    expect(resolveRecipient({ ...both, parent_name: '  ' }).name).toBeNull();
  });
});

describe('recipientOptions', () => {
  it('lists both with labels when both numbers exist', () => {
    expect(recipientOptions(both)).toEqual([
      { value: 'parent', label: 'Parent (Thandi)' },
      { value: 'student', label: 'Student (Amahle)' },
    ]);
  });

  it('falls back to a plain "Parent" label without a name', () => {
    expect(recipientOptions({ ...both, parent_name: null })[0].label).toBe('Parent');
  });

  it('is empty when fewer than two numbers exist (no choice to make)', () => {
    expect(recipientOptions({ ...both, student_phone: null })).toEqual([]);
  });
});

describe('defaultPreferredContact', () => {
  it('student when only the student number is valid', () => {
    expect(defaultPreferredContact('', '0831112222', 'parent')).toBe('student');
  });
  it('parent when only the parent number is valid', () => {
    expect(defaultPreferredContact('0821234567', '', 'student')).toBe('parent');
  });
  it('keeps the chosen value when both or neither exist', () => {
    expect(defaultPreferredContact('0821234567', '0831112222', 'student')).toBe('student');
    expect(defaultPreferredContact('', '', 'student')).toBe('student');
  });
});
