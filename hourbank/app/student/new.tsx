import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { F } from '../../src/theme/fonts';
import { COLORS } from '../../src/theme/colors';
import { SHOW_ALL_GRADES_KEY } from '../(app)/profile';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { createStudent } from '../../src/db/students';
import { getTutorProfile } from '../../src/db/tutorProfile';
import { listSubjects, listCurricula } from '../../src/db/catalog';
import { Student } from '../../src/db/schema';
const ALL_GRADES = Array.from({ length: 12 }, (_, i) => i + 1);
const HS_GRADES = [8, 9, 10, 11, 12];

const LABEL_STYLE = {
  fontFamily: F.mono,
  fontSize: 11,
  color: COLORS.inkFaint,
  textTransform: 'uppercase' as const,
  marginBottom: 4,
};

const INPUT_STYLE = {
  fontFamily: F.sans,
  fontSize: 16,
  color: COLORS.ink,
  borderBottomWidth: 1,
  borderBottomColor: COLORS.paperEdge,
  paddingVertical: 12,
  marginBottom: 24,
};

const MONO_INPUT_STYLE = {
  ...INPUT_STYLE,
  fontFamily: F.mono,
};

const SECTION_LABEL_STYLE = {
  fontFamily: F.mono,
  fontSize: 11,
  color: COLORS.inkFaint,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  marginBottom: 12,
};

export default function NewStudentScreen() {
  const [fullName, setFullName] = useState('');
  const [grade, setGrade] = useState<number | null>(null);
  const [subject, setSubject] = useState('');
  const [showSubjectSuggestions, setShowSubjectSuggestions] = useState(false);
  const [curriculum, setCurriculum] = useState<Student['curriculum']>('CAPS');
  const [showAllGrades, setShowAllGrades] = useState(false);
  const [subjectSuggestions, setSubjectSuggestions] = useState<string[]>([]);
  const [curriculaOptions, setCurriculaOptions] = useState<Student['curriculum'][]>(['CAPS', 'IEB', 'Cambridge', 'Other']);
  const [nameError, setNameError] = useState('');
  const [gradeError, setGradeError] = useState('');
  const [subjectError, setSubjectError] = useState('');
  // Tutor travel mode decides which travel field is surfaced (flat fee vs distance).
  const [tutorTravelMode, setTutorTravelMode] = useState<'flat' | 'distance'>('flat');
  const [travelFlatFee, setTravelFlatFee] = useState('');
  const [travelDistanceKm, setTravelDistanceKm] = useState('');

  useEffect(() => {
    AsyncStorage.getItem(SHOW_ALL_GRADES_KEY).then(v => {
      setShowAllGrades(v === 'true');
    });
    try {
      const profile = getTutorProfile();
      if (profile) setTutorTravelMode(profile.travel_mode === 'distance' ? 'distance' : 'flat');
    } catch {
      // Fall back to 'flat'
    }
    try {
      const dbSubjects = listSubjects();
      if (dbSubjects.length > 0) {
        setSubjectSuggestions(dbSubjects.map(s => s.name));
      }
      const dbCurricula = listCurricula();
      if (dbCurricula.length > 0) {
        const validCurricula = dbCurricula
          .map(c => c.name)
          .filter((n): n is Student['curriculum'] =>
            n === 'CAPS' || n === 'IEB' || n === 'Cambridge' || n === 'Other'
          );
        if (validCurricula.length > 0) setCurriculaOptions(validCurricula);
      }
    } catch {
      // Fall back to defaults already set in state
    }
  }, []);

  const grades = showAllGrades ? ALL_GRADES : HS_GRADES;

  function handleSubmit() {
    let valid = true;
    if (!fullName.trim()) {
      setNameError('Please enter the student\'s full name.');
      valid = false;
    } else {
      setNameError('');
    }
    if (grade === null) {
      setGradeError('Please select a grade.');
      valid = false;
    } else {
      setGradeError('');
    }
    if (!subject.trim()) {
      setSubjectError('Please enter a subject.');
      valid = false;
    } else {
      setSubjectError('');
    }
    if (!valid) return;

    try {
      createStudent({
        fullName: fullName.trim(),
        grade: grade!,
        subject: subject.trim(),
        curriculum,
        travelFlatFee: parseFloat(travelFlatFee) || 0,
        travelDistanceKm: parseFloat(travelDistanceKm) || 0,
        // payout_rate_override intentionally omitted — ships dormant this phase (stays NULL).
      });
      router.back();
    } catch (e) {
      Alert.alert('Error', 'Could not save student. Please try again.');
    }
  }

  const filteredSuggestions = subjectSuggestions.filter(s =>
    s.toLowerCase().includes(subject.toLowerCase()) && s !== subject
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
      <ScreenHeader
        backLabel="ROSTER"
        onBack={() => router.back()}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Heading */}
        <View style={{ marginBottom: 32 }}>
          <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.oxblood, textTransform: 'uppercase', marginBottom: 6 }}>
            ★ ADD STUDENT
          </Text>
          <Text style={{ fontFamily: F.serif, fontSize: 28, color: COLORS.ink, lineHeight: 32 }}>
            How many
          </Text>
          <Text style={{ fontFamily: F.serifItalic, fontSize: 28, color: COLORS.oxblood, lineHeight: 32 }}>
            details?
          </Text>
        </View>

        {/* Full name */}
        <Text style={LABEL_STYLE}>Full Name</Text>
        <TextInput
          value={fullName}
          onChangeText={v => { setFullName(v); if (v.trim()) setNameError(''); }}
          placeholder="e.g. Amahle Dlamini"
          placeholderTextColor={COLORS.inkFaint}
          style={INPUT_STYLE}
          autoCapitalize="words"
          returnKeyType="next"
        />
        {nameError ? (
          <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.crimson, marginTop: -20, marginBottom: 16 }}>
            {nameError}
          </Text>
        ) : null}

        {/* Grade */}
        <Text style={LABEL_STYLE}>Grade</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginBottom: 24 }}
          contentContainerStyle={{ gap: 8 }}
        >
          {grades.map(g => (
            <TouchableOpacity
              key={g}
              onPress={() => { setGrade(g); setGradeError(''); }}
              activeOpacity={0.7}
              style={{
                borderWidth: 1,
                borderColor: grade === g ? COLORS.oxblood : COLORS.paperEdge,
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 8,
                backgroundColor: grade === g ? COLORS.oxblood : 'rgba(255,255,255,0.4)',
              }}
            >
              <Text style={{
                fontFamily: F.mono,
                fontSize: 13,
                color: grade === g ? COLORS.paper : COLORS.inkSoft,
              }}>
                {g}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        {gradeError ? (
          <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.crimson, marginTop: -20, marginBottom: 16 }}>
            {gradeError}
          </Text>
        ) : null}

        {/* Subject */}
        <Text style={LABEL_STYLE}>Subject</Text>
        <TextInput
          value={subject}
          onChangeText={v => {
            setSubject(v);
            setShowSubjectSuggestions(v.length > 0);
            if (v.trim()) setSubjectError('');
          }}
          onFocus={() => setShowSubjectSuggestions(subject.length > 0 || true)}
          onBlur={() => {
            // Small delay to allow tap on suggestion
            setTimeout(() => setShowSubjectSuggestions(false), 150);
          }}
          placeholder="e.g. Mathematics"
          placeholderTextColor={COLORS.inkFaint}
          style={{ ...INPUT_STYLE, marginBottom: showSubjectSuggestions && filteredSuggestions.length > 0 ? 4 : 24 }}
          autoCapitalize="words"
        />

        {/* Subject suggestions */}
        {showSubjectSuggestions && filteredSuggestions.length > 0 && (
          <View style={{
            borderWidth: 1,
            borderColor: COLORS.paperEdge,
            borderRadius: 8,
            backgroundColor: COLORS.paper,
            marginBottom: 24,
            overflow: 'hidden',
          }}>
            {filteredSuggestions.map((s, i) => (
              <TouchableOpacity
                key={s}
                onPress={() => {
                  setSubject(s);
                  setShowSubjectSuggestions(false);
                }}
                activeOpacity={0.7}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderTopWidth: i > 0 ? 1 : 0,
                  borderTopColor: COLORS.paperEdge,
                }}
              >
                <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.ink }}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {subjectError ? (
          <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.crimson, marginBottom: 16 }}>
            {subjectError}
          </Text>
        ) : null}

        {/* Curriculum */}
        <Text style={LABEL_STYLE}>Curriculum</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 40 }}>
          {curriculaOptions.map(c => (
            <TouchableOpacity
              key={c}
              onPress={() => setCurriculum(c)}
              activeOpacity={0.7}
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: curriculum === c ? COLORS.oxblood : COLORS.paperEdge,
                borderRadius: 8,
                paddingVertical: 10,
                alignItems: 'center',
                backgroundColor: curriculum === c ? COLORS.oxblood : 'rgba(255,255,255,0.4)',
              }}
            >
              <Text style={{
                fontFamily: F.mono,
                fontSize: 10,
                color: curriculum === c ? COLORS.paper : COLORS.inkSoft,
                textTransform: 'uppercase',
              }}>
                {c}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Travel */}
        <Text style={SECTION_LABEL_STYLE}>Travel</Text>
        {tutorTravelMode === 'flat' ? (
          <>
            <Text style={LABEL_STYLE}>Flat travel fee</Text>
            <TextInput
              value={travelFlatFee}
              onChangeText={setTravelFlatFee}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={COLORS.inkFaint}
              style={MONO_INPUT_STYLE}
            />
          </>
        ) : (
          <>
            <Text style={LABEL_STYLE}>Distance (km)</Text>
            <TextInput
              value={travelDistanceKm}
              onChangeText={setTravelDistanceKm}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={COLORS.inkFaint}
              style={MONO_INPUT_STYLE}
            />
          </>
        )}

        {/* payout_rate_override — built but hidden this phase; ships dormant (stays NULL). */}

        {/* Submit button */}
        <TouchableOpacity
          onPress={handleSubmit}
          activeOpacity={0.8}
          style={{
            backgroundColor: COLORS.oxblood,
            borderRadius: 12,
            paddingVertical: 16,
            alignItems: 'center',
          }}
        >
          <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.paper }}>
            Add student ▸
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
