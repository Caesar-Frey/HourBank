/**
 * Shared fields for New / Edit student — one catalog source, one validation
 * model (flowLogic.validateStudentForm), inline errors.
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, TextStyle, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { F, hitSlopFor } from '../../theme/fonts';
import { COLORS } from '../../theme/colors';
import { getTutorProfile } from '../../db/tutorProfile';
import { listCurricula, listSubjects } from '../../db/catalog';
import { SHOW_ALL_GRADES_KEY, SUBJECT_SUGGESTIONS } from '../../config';
import { Student } from '../../db/schema';
import { parseDecimal } from '../../utils/format';
import { FieldError, FieldHint, SectionLabel } from './ui';
import {
  phoneFieldState,
  showPreferredContactChoice,
  studentContactPayload,
  StudentFormErrors,
  StudentFormValues,
} from './flowLogic';
import { SegmentedControl } from '../calendar/SegmentedControl';
import type { PreferredContact } from '../../db/schema';


const ALL_GRADES =Array.from({ length: 12 }, (_, i) => i + 1);
const HS_GRADES = [8, 9, 10, 11, 12];
const DEFAULT_CURRICULA: Student['curriculum'][] = ['CAPS', 'IEB', 'Cambridge', 'Other'];

export const EMPTY_STUDENT_FORM: StudentFormValues = {
  fullName: '',
  grade: null,
  subject: '',
  curriculum: 'CAPS',
  parentName: '',
  parentPhone: '',
  studentPhone: '',
  preferredContact: 'parent',
  travelFlatFee: '',
  travelDistanceKm: '',
};

export function studentToFormValues(s: Student): StudentFormValues {
  return {
    fullName: s.full_name,
    grade: s.grade,
    subject: s.subject,
    curriculum: s.curriculum,
    parentName: s.parent_name ?? '',
    parentPhone: s.parent_phone ?? '',
    studentPhone: s.student_phone ?? '',
    preferredContact: s.preferred_contact === 'student' ? 'student' : 'parent',
    travelFlatFee: s.travel_flat_fee ? String(s.travel_flat_fee) : '',
    travelDistanceKm: s.travel_distance_km ? String(s.travel_distance_km) : '',
  };
}

/** Values → createStudent/updateStudent payload (assumes validation passed). */
export function formValuesToPayload(v: StudentFormValues) {
  return {
    fullName: v.fullName.trim(),
    grade: v.grade as number,
    subject: v.subject.trim(),
    curriculum: v.curriculum as Student['curriculum'],
    travelFlatFee: parseDecimal(v.travelFlatFee) ?? 0,
    travelDistanceKm: parseDecimal(v.travelDistanceKm) ?? 0,
    ...studentContactPayload(v),
  };
}

export type StudentFormOptions = {
  grades: number[];
  subjects: string[];
  curricula: Student['curriculum'][];
  travelMode: 'flat' | 'distance';
};

/** Catalog subjects/curricula, grade range preference and travel mode. */
export function useStudentFormOptions(): StudentFormOptions {
  const [showAllGrades, setShowAllGrades] = useState(false);
  const [subjects, setSubjects] = useState<string[]>(SUBJECT_SUGGESTIONS);
  const [curricula, setCurricula] = useState<Student['curriculum'][]>(DEFAULT_CURRICULA);
  const [travelMode, setTravelMode] = useState<'flat' | 'distance'>('flat');

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(SHOW_ALL_GRADES_KEY)
      .then(v => { if (!cancelled) setShowAllGrades(v === 'true'); })
      .catch(() => {});
    try {
      const p = getTutorProfile();
      if (p) setTravelMode(p.travel_mode === 'distance' ? 'distance' : 'flat');
    } catch { /* default flat */ }
    try {
      const dbSubjects = listSubjects().map(s => s.name);
      if (dbSubjects.length > 0) {
        setSubjects([...dbSubjects, ...SUBJECT_SUGGESTIONS.filter(s => !dbSubjects.includes(s))]);
      }
      const valid = listCurricula()
        .map(c => c.name)
        .filter((n): n is Student['curriculum'] => (DEFAULT_CURRICULA as string[]).includes(n));
      if (valid.length > 0) setCurricula(valid);
    } catch { /* defaults */ }
    return () => { cancelled = true; };
  }, []);

  return { grades: showAllGrades ? ALL_GRADES : HS_GRADES, subjects, curricula, travelMode };
}

const INPUT: TextStyle = {
  fontFamily: F.sans,
  fontSize: 16,
  color: COLORS.ink,
  borderBottomWidth: 1,
  borderBottomColor: COLORS.paperEdge,
  paddingVertical: 10,
};

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 22 }}>
      <SectionLabel>{label}</SectionLabel>
      {children}
      <FieldError message={error} />
    </View>
  );
}

interface Props {
  values: StudentFormValues;
  onChange: (patch: Partial<StudentFormValues>) => void;
  errors: StudentFormErrors;
  options: StudentFormOptions;
}

export function StudentFormFields({ values, onChange, errors, options }: Props) {
  const [subjectFocused, setSubjectFocused] = useState(false);
  const grades = values.grade !== null && !options.grades.includes(values.grade)
    ? [...options.grades, values.grade].sort((a, b) => a - b)
    : options.grades;
  const suggestions = options.subjects
    .filter(s => s.toLowerCase().includes(values.subject.trim().toLowerCase()) && s !== values.subject)
    .slice(0, 6);
  const phone = phoneFieldState(values.parentPhone);
  const studentPhone = phoneFieldState(values.studentPhone);
  const showContactChoice = showPreferredContactChoice(values);
  const parentFirst = values.parentName.trim().split(/\s+/)[0];
  const studentFirst = values.fullName.trim().split(/\s+/)[0];
  const contactOptions: Array<{ value: PreferredContact; label: string }> = [
    { value: 'parent', label: parentFirst ? `Parent (${parentFirst})` : 'Parent' },
    { value: 'student', label: studentFirst ? `Student (${studentFirst})` : 'Student' },
  ];
  const curricula = options.curricula.includes(values.curriculum as Student['curriculum'])
    ? options.curricula
    : [...options.curricula, values.curriculum as Student['curriculum']];

  const pill = (active: boolean) => ({
    borderWidth: 1,
    borderColor: active ? COLORS.oxblood : COLORS.paperEdge,
    borderRadius: 8,
    backgroundColor: active ? COLORS.oxblood : COLORS.cardFill,
    minHeight: 40,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  });

  return (
    <View>
      <Field label="Full name" error={errors.fullName}>
        <TextInput
          value={values.fullName}
          onChangeText={v => onChange({ fullName: v })}
          placeholder="e.g. Amahle Dlamini"
          placeholderTextColor={COLORS.inkFaint}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="next"
          accessibilityLabel="Full name"
          style={{ ...INPUT, borderBottomColor: errors.fullName ? COLORS.crimson : COLORS.paperEdge }}
        />
      </Field>

      <Field label="Grade" error={errors.grade}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
          {grades.map(g => (
            <TouchableOpacity
              key={g}
              onPress={() => onChange({ grade: g })}
              activeOpacity={0.7}
              hitSlop={hitSlopFor(40)}
              accessibilityRole="radio"
              accessibilityState={{ selected: values.grade === g }}
              accessibilityLabel={`Grade ${g}`}
              style={{ ...pill(values.grade === g), minWidth: 44, paddingHorizontal: 12 }}
            >
              <Text style={{ fontFamily: F.mono, fontSize: 14, color: values.grade === g ? COLORS.paper : COLORS.inkSoft }}>{g}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Field>

      <Field label="Subject" error={errors.subject}>
        <TextInput
          value={values.subject}
          onChangeText={v => onChange({ subject: v })}
          onFocus={() => setSubjectFocused(true)}
          onBlur={() => setTimeout(() => setSubjectFocused(false), 150)}
          placeholder="e.g. Mathematics"
          placeholderTextColor={COLORS.inkFaint}
          autoCapitalize="words"
          accessibilityLabel="Subject"
          style={{ ...INPUT, borderBottomColor: errors.subject ? COLORS.crimson : COLORS.paperEdge }}
        />
        {subjectFocused && suggestions.length > 0 ? (
          <View style={{ borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 8, marginTop: 4, overflow: 'hidden' }}>
            {suggestions.map((s, i) => (
              <TouchableOpacity
                key={s}
                onPress={() => { onChange({ subject: s }); setSubjectFocused(false); }}
                activeOpacity={0.7}
                accessibilityRole="button"
                style={{ paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', borderTopWidth: i > 0 ? 1 : 0, borderTopColor: COLORS.paperEdge }}
              >
                <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.ink }}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </Field>

      <Field label="Curriculum">
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {curricula.map(c => (
            <TouchableOpacity
              key={c}
              onPress={() => onChange({ curriculum: c })}
              activeOpacity={0.7}
              accessibilityRole="radio"
              accessibilityState={{ selected: values.curriculum === c }}
              accessibilityLabel={c}
              style={{ ...pill(values.curriculum === c), flex: 1 }}
            >
              <Text style={{ fontFamily: F.mono, fontSize: 11, color: values.curriculum === c ? COLORS.paper : COLORS.inkSoft, textTransform: 'uppercase' }}>
                {c}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </Field>

      <Text style={{ fontFamily: F.serifItalic, fontSize: 18, color: COLORS.ink, marginTop: 8, marginBottom: 12 }}>Contacts</Text>

      <Field label="Parent name (optional)">
        <TextInput
          value={values.parentName}
          onChangeText={v => onChange({ parentName: v })}
          placeholder="e.g. Thandi Dlamini"
          placeholderTextColor={COLORS.inkFaint}
          autoCapitalize="words"
          autoCorrect={false}
          accessibilityLabel="Parent name"
          style={INPUT}
        />
      </Field>

      <Field label="Parent WhatsApp number (optional)" error={errors.parentPhone}>
        <TextInput
          value={values.parentPhone}
          onChangeText={v => onChange({ parentPhone: v })}
          placeholder="e.g. 082 123 4567"
          placeholderTextColor={COLORS.inkFaint}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          accessibilityLabel="Parent WhatsApp number"
          style={{ ...INPUT, fontFamily: F.mono, borderBottomColor: errors.parentPhone ? COLORS.crimson : COLORS.paperEdge }}
        />
        {!errors.parentPhone && phone.preview ? <FieldHint tone="good">{phone.preview}</FieldHint> : null}
        {!errors.parentPhone && !phone.preview ? (
          <FieldHint>Used for lesson receipts and top-up reminders.</FieldHint>
        ) : null}
      </Field>

      <Field label="Student's WhatsApp number (optional)" error={errors.studentPhone}>
        <TextInput
          value={values.studentPhone}
          onChangeText={v => onChange({ studentPhone: v })}
          placeholder="e.g. 083 111 2222"
          placeholderTextColor={COLORS.inkFaint}
          keyboardType="phone-pad"
          autoComplete="off"
          accessibilityLabel="Student's WhatsApp number"
          style={{ ...INPUT, fontFamily: F.mono, borderBottomColor: errors.studentPhone ? COLORS.crimson : COLORS.paperEdge }}
        />
        {!errors.studentPhone && studentPhone.preview ? <FieldHint tone="good">{studentPhone.preview}</FieldHint> : null}
        {!errors.studentPhone && !studentPhone.preview ? (
          <FieldHint>For students who handle payments or messages themselves.</FieldHint>
        ) : null}
      </Field>

      {showContactChoice ? (
        <Field label="Send messages to">
          <SegmentedControl
            options={contactOptions}
            value={values.preferredContact}
            onChange={v => onChange({ preferredContact: v })}
            accessibilityLabel="Send messages to"
          />
          <FieldHint>Receipts and reminders default to this person. You can switch per message.</FieldHint>
        </Field>
      ) : null}

      <Text style={{ fontFamily: F.serifItalic, fontSize: 18, color: COLORS.ink, marginTop: 8, marginBottom: 12 }}>Travel</Text>
      {options.travelMode === 'flat' ? (
        <Field label="Flat travel fee (R)" error={errors.travel}>
          <TextInput
            value={values.travelFlatFee}
            onChangeText={v => onChange({ travelFlatFee: v })}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={COLORS.inkFaint}
            accessibilityLabel="Flat travel fee in rand"
            style={{ ...INPUT, fontFamily: F.mono }}
          />
        </Field>
      ) : (
        <Field label="Distance (km)" error={errors.travel}>
          <TextInput
            value={values.travelDistanceKm}
            onChangeText={v => onChange({ travelDistanceKm: v })}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={COLORS.inkFaint}
            accessibilityLabel="Distance in kilometres"
            style={{ ...INPUT, fontFamily: F.mono }}
          />
        </Field>
      )}
    </View>
  );
}
