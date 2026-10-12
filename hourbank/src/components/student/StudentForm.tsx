/**
 * Shared fields for New / Edit student — one catalog source, one validation
 * model (flowLogic.validateStudentForm), inline errors. Subjects are edited
 * with SubjectsEditor (each subject has its own balance); saving lives in
 * studentSave.ts.
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
import { formatRand, parseDecimal } from '../../utils/format';
import { FieldError, FieldHint, SectionLabel } from './ui';
import {
  phoneFieldState,
  showPreferredContactChoice,
  StudentFormErrors,
  StudentFormValues,
} from './flowLogic';
import { SegmentedControl } from '../calendar/SegmentedControl';
import type { ParentTravelMode, PreferredContact } from '../../db/schema';
import { SubjectsEditor } from './SubjectsEditor';
import { newSubjectDraft, SubjectDraft } from './subjectLogic';

const ALL_GRADES = Array.from({ length: 12 }, (_, i) => i + 1);
const HS_GRADES = [8, 9, 10, 11, 12];
const DEFAULT_CURRICULA: Student['curriculum'][] = ['CAPS', 'IEB', 'Cambridge', 'Other'];

export type StudentFormOptions = {
  grades: number[];
  subjects: string[];
  curricula: Student['curriculum'][];
  /** Tutor's PAYOUT travel mode (claims). */
  travelMode: 'flat' | 'distance';
  /** Tutor's per-km rate — default for a new student's parent per-km charge. */
  perKmRate: number;
};

/** Blank form; parent travel terms default from the tutor's travel settings. */
export function emptyStudentForm(options: Pick<StudentFormOptions, 'travelMode' | 'perKmRate'>): StudentFormValues {
  return {
    fullName: '',
    grade: null,
    curriculum: 'CAPS',
    subjects: [newSubjectDraft()],
    parentName: '',
    parentPhone: '',
    studentPhone: '',
    preferredContact: 'parent',
    travelFlatFee: '',
    travelDistanceKm: '',
    parentTravelMode: options.travelMode === 'distance' ? 'per_km' : 'flat',
    parentTravelFlatFee: '',
    parentTravelPerKm: options.perKmRate > 0 ? String(options.perKmRate) : '',
  };
}

function amountText(n: number | null | undefined): string {
  return n ? String(n) : '';
}

export function studentToFormValues(s: Student, subjects: SubjectDraft[]): StudentFormValues {
  return {
    fullName: s.full_name,
    grade: s.grade,
    curriculum: s.curriculum,
    subjects,
    parentName: s.parent_name ?? '',
    parentPhone: s.parent_phone ?? '',
    studentPhone: s.student_phone ?? '',
    preferredContact: s.preferred_contact === 'student' ? 'student' : 'parent',
    travelFlatFee: amountText(s.travel_flat_fee),
    travelDistanceKm: amountText(s.travel_distance_km),
    parentTravelMode: s.parent_travel_mode ?? 'flat',
    parentTravelFlatFee: amountText(s.parent_travel_flat_fee),
    parentTravelPerKm: amountText(s.parent_travel_per_km),
  };
}

function readTutorTravel(): { travelMode: 'flat' | 'distance'; perKmRate: number } {
  try {
    const p = getTutorProfile();
    return { travelMode: p?.travel_mode === 'distance' ? 'distance' : 'flat', perKmRate: p?.per_km_rate ?? 0 };
  } catch {
    return { travelMode: 'flat', perKmRate: 0 };
  }
}

/** Catalog subjects/curricula, grade range preference and tutor travel config. */
export function useStudentFormOptions(): StudentFormOptions {
  const [showAllGrades, setShowAllGrades] = useState(false);
  const [subjects, setSubjects] = useState<string[]>(SUBJECT_SUGGESTIONS);
  const [curricula, setCurricula] = useState<Student['curriculum'][]>(DEFAULT_CURRICULA);
  // Read synchronously so the New form's parent-travel defaults are right on first render.
  const [travel] = useState(readTutorTravel);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(SHOW_ALL_GRADES_KEY)
      .then(v => { if (!cancelled) setShowAllGrades(v === 'true'); })
      .catch(() => {});
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

  return { grades: showAllGrades ? ALL_GRADES : HS_GRADES, subjects, curricula, ...travel };
}

const INPUT: TextStyle = {
  fontFamily: F.sans,
  fontSize: 16,
  color: COLORS.ink,
  borderBottomWidth: 1,
  borderBottomColor: COLORS.paperEdge,
  paddingVertical: 10,
};

const PARENT_TRAVEL_OPTIONS: Array<{ value: ParentTravelMode; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'flat', label: 'Flat fee per lesson' },
  { value: 'per_km', label: 'Per km' },
];

/** "R 120.00 per in-person lesson" preview for the chosen parent travel terms. */
function parentTravelPreview(v: StudentFormValues, travelMode: 'flat' | 'distance'): string | null {
  if (v.parentTravelMode === 'flat') {
    const fee = parseDecimal(v.parentTravelFlatFee) ?? (travelMode === 'flat' ? parseDecimal(v.travelFlatFee) : null);
    return fee !== null && fee > 0 ? `${formatRand(fee)} per in-person lesson` : null;
  }
  if (v.parentTravelMode === 'per_km') {
    const rate = parseDecimal(v.parentTravelPerKm);
    const km = parseDecimal(v.travelDistanceKm);
    if (rate === null || rate <= 0) return null;
    return km && km > 0 ? `${formatRand(rate * km)} per lesson at ${km} km` : `${formatRand(rate)} per km`;
  }
  return null;
}

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
  const grades = values.grade !== null && !options.grades.includes(values.grade)
    ? [...options.grades, values.grade].sort((a, b) => a - b)
    : options.grades;
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
  const travelPreview = parentTravelPreview(values, options.travelMode);
  const payoutFlatPlaceholder =
    options.travelMode === 'flat' && parseDecimal(values.travelFlatFee) ? values.travelFlatFee.trim() : '0';

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

      <SubjectsEditor
        subjects={values.subjects}
        onChange={next => onChange({ subjects: next })}
        suggestions={options.subjects}
        grades={grades}
        curricula={curricula}
        error={errors.subjects}
      />

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

      <Field label="Distance to lessons (km)" error={errors.travelKm}>
        <TextInput
          value={values.travelDistanceKm}
          onChangeText={v => onChange({ travelDistanceKm: v })}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={COLORS.inkFaint}
          accessibilityLabel="Default distance per in-person lesson in kilometres"
          style={{ ...INPUT, fontFamily: F.mono, borderBottomColor: errors.travelKm ? COLORS.crimson : COLORS.paperEdge }}
        />
        <FieldHint>Default km for in-person lessons — you can change it per lesson.</FieldHint>
      </Field>

      {options.travelMode === 'flat' ? (
        <Field label="Your travel payout per lesson (R)" error={errors.travel}>
          <TextInput
            value={values.travelFlatFee}
            onChangeText={v => onChange({ travelFlatFee: v })}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={COLORS.inkFaint}
            accessibilityLabel="Flat travel payout in rand"
            style={{ ...INPUT, fontFamily: F.mono, borderBottomColor: errors.travel ? COLORS.crimson : COLORS.paperEdge }}
          />
        </Field>
      ) : null}

      <Field label="Parent pays for travel" error={errors.parentTravel}>
        <SegmentedControl
          options={PARENT_TRAVEL_OPTIONS}
          value={values.parentTravelMode}
          onChange={v => onChange({ parentTravelMode: v })}
          accessibilityLabel="How the parent pays for travel"
        />
        {values.parentTravelMode === 'flat' ? (
          <TextInput
            value={values.parentTravelFlatFee}
            onChangeText={v => onChange({ parentTravelFlatFee: v })}
            keyboardType="decimal-pad"
            placeholder={`R per lesson, e.g. ${payoutFlatPlaceholder === '0' ? '50' : payoutFlatPlaceholder}`}
            placeholderTextColor={COLORS.inkFaint}
            accessibilityLabel="Parent travel fee per lesson in rand"
            style={{ ...INPUT, fontFamily: F.mono, marginTop: 8 }}
          />
        ) : null}
        {values.parentTravelMode === 'per_km' ? (
          <TextInput
            value={values.parentTravelPerKm}
            onChangeText={v => onChange({ parentTravelPerKm: v })}
            keyboardType="decimal-pad"
            placeholder="R per km, e.g. 4,50"
            placeholderTextColor={COLORS.inkFaint}
            accessibilityLabel="Parent travel rate in rand per kilometre"
            style={{ ...INPUT, fontFamily: F.mono, marginTop: 8 }}
          />
        ) : null}
        {travelPreview ? <FieldHint tone="good">{travelPreview}</FieldHint> : null}
        <FieldHint>Charged to the parent after in-person lessons; changes apply to future lessons only.</FieldHint>
      </Field>
    </View>
  );
}
