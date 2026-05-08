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
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SHOW_ALL_GRADES_KEY } from '../../profile';
import { F } from '../../../../src/theme/fonts';
import { ScreenHeader } from '../../../../src/components/ScreenHeader';
import { getStudent, updateStudent, archiveStudent } from '../../../../src/db/students';
import { SUBJECT_SUGGESTIONS } from '../../../../src/config';
import { Student } from '../../../../src/db/schema';

const CURRICULA: Student['curriculum'][] = ['CAPS', 'IEB', 'Cambridge', 'Other'];
const ALL_GRADES = Array.from({ length: 12 }, (_, i) => i + 1);
const HS_GRADES = [8, 9, 10, 11, 12];

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

export default function EditStudentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [fullName, setFullName] = useState('');
  const [grade, setGrade] = useState<number | null>(null);
  const [subject, setSubject] = useState('');
  const [showSubjectSuggestions, setShowSubjectSuggestions] = useState(false);
  const [curriculum, setCurriculum] = useState<Student['curriculum']>('CAPS');
  const [showAllGrades, setShowAllGrades] = useState(false);

  const grades = showAllGrades ? ALL_GRADES : HS_GRADES;

  useEffect(() => {
    AsyncStorage.getItem(SHOW_ALL_GRADES_KEY).then(v => {
      setShowAllGrades(v === 'true');
    });
  }, []);

  useEffect(() => {
    const s = getStudent(id);
    if (s) {
      setFullName(s.full_name);
      setGrade(s.grade);
      setSubject(s.subject);
      setCurriculum(s.curriculum);
    }
  }, [id]);

  function handleSubmit() {
    if (!fullName.trim()) {
      Alert.alert('Required', "Please enter the student's full name.");
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

    try {
      updateStudent(id, {
        fullName: fullName.trim(),
        grade,
        subject: subject.trim(),
        curriculum,
      });
      router.back();
    } catch (e) {
      Alert.alert('Error', 'Could not save changes. Please try again.');
    }
  }

  function handleArchive() {
    Alert.alert(
      `Archive ${fullName.trim() || 'student'}?`,
      'This student will be hidden from the roster. Their ledger history is preserved.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: () => {
            try {
              archiveStudent(id);
              router.replace('/(app)');
            } catch (e) {
              Alert.alert('Error', 'Could not archive student.');
            }
          },
        },
      ]
    );
  }

  const filteredSuggestions = SUBJECT_SUGGESTIONS.filter(
    s => s.toLowerCase().includes(subject.toLowerCase()) && s !== subject
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F4EFE6' }} edges={['top']}>
      <ScreenHeader backLabel="BACK" onBack={() => router.back()} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Heading */}
        <View style={{ marginBottom: 32 }}>
          <Text style={{ fontFamily: F.mono, fontSize: 11, color: '#7A2530', textTransform: 'uppercase', marginBottom: 6 }}>
            ★ EDIT STUDENT
          </Text>
          <Text style={{ fontFamily: F.serif, fontSize: 28, color: '#1B1714', lineHeight: 32 }}>
            Update
          </Text>
          <Text style={{ fontFamily: F.serifItalic, fontSize: 28, color: '#7A2530', lineHeight: 32 }}>
            details.
          </Text>
        </View>

        {/* Full name */}
        <Text style={LABEL_STYLE}>Full Name</Text>
        <TextInput
          value={fullName}
          onChangeText={setFullName}
          placeholder="e.g. Amara Nkosi"
          placeholderTextColor="#8A7E72"
          style={INPUT_STYLE}
          autoCapitalize="words"
          autoCorrect={false}
        />

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
          onFocus={() => setShowSubjectSuggestions(subject.length > 0)}
          onBlur={() => setTimeout(() => setShowSubjectSuggestions(false), 150)}
          placeholder="e.g. Mathematics"
          placeholderTextColor="#8A7E72"
          style={{ ...INPUT_STYLE, marginBottom: showSubjectSuggestions && filteredSuggestions.length > 0 ? 4 : 24 }}
          autoCapitalize="words"
        />

        {showSubjectSuggestions && filteredSuggestions.length > 0 && (
          <View style={{
            borderWidth: 1,
            borderColor: '#D9CFBF',
            borderRadius: 8,
            backgroundColor: '#F4EFE6',
            marginBottom: 24,
            overflow: 'hidden',
          }}>
            {filteredSuggestions.slice(0, 5).map((s, i) => (
              <TouchableOpacity
                key={s}
                onPress={() => { setSubject(s); setShowSubjectSuggestions(false); }}
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
                fontSize: 11,
                color: curriculum === c ? '#F4EFE6' : '#4A413A',
              }}>
                {c}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Save button */}
        <TouchableOpacity
          onPress={handleSubmit}
          activeOpacity={0.85}
          style={{
            backgroundColor: '#7A2530',
            borderRadius: 16,
            paddingVertical: 16,
            alignItems: 'center',
            marginBottom: 16,
          }}
        >
          <Text style={{ fontFamily: F.sansMed, fontSize: 16, color: '#F4EFE6' }}>
            Save changes ▸
          </Text>
        </TouchableOpacity>

        {/* Archive */}
        <TouchableOpacity
          onPress={handleArchive}
          activeOpacity={0.7}
          style={{ alignItems: 'center', paddingVertical: 12 }}
        >
          <Text style={{ fontFamily: F.mono, fontSize: 12, color: '#8A7E72', textDecorationLine: 'underline' }}>
            Archive student
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
