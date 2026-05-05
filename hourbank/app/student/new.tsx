import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  SafeAreaView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { F } from '../../src/theme/fonts';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { createStudent } from '../../src/db/students';
import { SUBJECT_SUGGESTIONS } from '../../src/config';
import { Student } from '../../src/db/schema';

const CURRICULA: Student['curriculum'][] = ['CAPS', 'IEB', 'Cambridge', 'Other'];
const GRADES = Array.from({ length: 12 }, (_, i) => i + 1);

const LABEL_STYLE = {
  fontFamily: F.mono,
  fontSize: 11,
  color: '#8A7E72',
  textTransform: 'uppercase' as const,
  marginBottom: 4,
};

const INPUT_STYLE = {
  fontFamily: F.sans,
  fontSize: 16,
  color: '#1B1714',
  borderBottomWidth: 1,
  borderBottomColor: '#D9CFBF',
  paddingVertical: 12,
  marginBottom: 24,
};

export default function NewStudentScreen() {
  const [fullName, setFullName] = useState('');
  const [grade, setGrade] = useState<number | null>(null);
  const [subject, setSubject] = useState('');
  const [showSubjectSuggestions, setShowSubjectSuggestions] = useState(false);
  const [curriculum, setCurriculum] = useState<Student['curriculum']>('CAPS');

  function handleSubmit() {
    if (!fullName.trim()) {
      Alert.alert('Required', 'Please enter the student\'s full name.');
      return;
    }
    if (grade === null) {
      Alert.alert('Required', 'Please select a grade.');
      return;
    }
    if (!subject.trim()) {
      Alert.alert('Required', 'Please enter a subject.');
      return;
    }

    createStudent({
      fullName: fullName.trim(),
      grade,
      subject: subject.trim(),
      curriculum,
    });

    router.back();
  }

  const filteredSuggestions = SUBJECT_SUGGESTIONS.filter(s =>
    s.toLowerCase().includes(subject.toLowerCase()) && s !== subject
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F4EFE6' }}>
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
          <Text style={{ fontFamily: F.mono, fontSize: 11, color: '#7A2530', textTransform: 'uppercase', marginBottom: 6 }}>
            ★ ADD STUDENT
          </Text>
          <Text style={{ fontFamily: F.serif, fontSize: 28, color: '#1B1714', lineHeight: 32 }}>
            How many
          </Text>
          <Text style={{ fontFamily: F.serifItalic, fontSize: 28, color: '#7A2530', lineHeight: 32 }}>
            details?
          </Text>
        </View>

        {/* Full name */}
        <Text style={LABEL_STYLE}>Full Name</Text>
        <TextInput
          value={fullName}
          onChangeText={setFullName}
          placeholder="e.g. Amahle Dlamini"
          placeholderTextColor="#8A7E72"
          style={INPUT_STYLE}
          autoCapitalize="words"
          returnKeyType="next"
        />

        {/* Grade */}
        <Text style={LABEL_STYLE}>Grade</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginBottom: 24 }}
          contentContainerStyle={{ gap: 8 }}
        >
          {GRADES.map(g => (
            <TouchableOpacity
              key={g}
              onPress={() => setGrade(g)}
              activeOpacity={0.7}
              style={{
                borderWidth: 1,
                borderColor: grade === g ? '#7A2530' : '#D9CFBF',
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 8,
                backgroundColor: grade === g ? '#7A2530' : 'rgba(255,255,255,0.4)',
              }}
            >
              <Text style={{
                fontFamily: F.mono,
                fontSize: 13,
                color: grade === g ? '#F4EFE6' : '#4A413A',
              }}>
                {g}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Subject */}
        <Text style={LABEL_STYLE}>Subject</Text>
        <TextInput
          value={subject}
          onChangeText={v => {
            setSubject(v);
            setShowSubjectSuggestions(v.length > 0);
          }}
          onFocus={() => setShowSubjectSuggestions(subject.length > 0 || true)}
          onBlur={() => {
            // Small delay to allow tap on suggestion
            setTimeout(() => setShowSubjectSuggestions(false), 150);
          }}
          placeholder="e.g. Mathematics"
          placeholderTextColor="#8A7E72"
          style={{ ...INPUT_STYLE, marginBottom: showSubjectSuggestions && filteredSuggestions.length > 0 ? 4 : 24 }}
          autoCapitalize="words"
        />

        {/* Subject suggestions */}
        {showSubjectSuggestions && filteredSuggestions.length > 0 && (
          <View style={{
            borderWidth: 1,
            borderColor: '#D9CFBF',
            borderRadius: 8,
            backgroundColor: '#F4EFE6',
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
                  borderTopColor: '#D9CFBF',
                }}
              >
                <Text style={{ fontFamily: F.sans, fontSize: 14, color: '#1B1714' }}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Curriculum */}
        <Text style={LABEL_STYLE}>Curriculum</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 40 }}>
          {CURRICULA.map(c => (
            <TouchableOpacity
              key={c}
              onPress={() => setCurriculum(c)}
              activeOpacity={0.7}
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: curriculum === c ? '#7A2530' : '#D9CFBF',
                borderRadius: 8,
                paddingVertical: 10,
                alignItems: 'center',
                backgroundColor: curriculum === c ? '#7A2530' : 'rgba(255,255,255,0.4)',
              }}
            >
              <Text style={{
                fontFamily: F.mono,
                fontSize: 10,
                color: curriculum === c ? '#F4EFE6' : '#4A413A',
                textTransform: 'uppercase',
              }}>
                {c}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Submit button */}
        <TouchableOpacity
          onPress={handleSubmit}
          activeOpacity={0.8}
          style={{
            backgroundColor: '#7A2530',
            borderRadius: 12,
            paddingVertical: 16,
            alignItems: 'center',
          }}
        >
          <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: '#F4EFE6' }}>
            Add student ▸
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
