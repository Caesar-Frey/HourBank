import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { F } from '../../src/theme/fonts';
import { StudentCard } from '../../src/components/StudentCard';
import { useStudents } from '../../src/hooks/useStudents';
import { sessionsThisWeekCount } from '../../src/db/sessions';
import { formatHours, formatDuration } from '../../src/utils/format';
import { useSessionTimer } from '../../src/contexts/SessionTimerContext';
import { COLORS } from '../../src/theme/colors';

const SORT_KEY = '@hourbank/roster_sort';
type SortMode = 'balance' | 'next_session' | 'name' | 'grade';

function getDateEyebrow(): string {
  const d = new Date();
  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const day = days[d.getDay()];
  const date = String(d.getDate()).padStart(2, '0');
  const month = months[d.getMonth()];
  return `${day} · ${date} ${month}`;
}

export default function HomeScreen() {
  const { students, loading } = useStudents();
  const { status: timerStatus, sessionId: liveSessionId, studentId: liveStudentId, elapsedSeconds } = useSessionTimer();
  const [sortMode, setSortMode] = useState<SortMode>('balance');
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState('');
  const [weekLessons, setWeekLessons] = useState(0);

  // Load sort preference once on mount
  useEffect(() => {
    AsyncStorage.getItem(SORT_KEY).then(v => {
      if (v) setSortMode(v as SortMode);
    });
  }, []);

  // Refresh lesson count whenever the screen is focused
  useFocusEffect(
    useCallback(() => {
      try {
        setWeekLessons(sessionsThisWeekCount());
      } catch {
        setWeekLessons(0);
      }
    }, [])
  );

  const sorted = useMemo(() => {
    const arr = [...students];
    switch (sortMode) {
      case 'balance':
        return arr.sort((a, b) => a.current_balance - b.current_balance);
      case 'next_session':
        return arr.sort((a, b) => {
          const aTime = a.next_session?.scheduled_for ?? 'z';
          const bTime = b.next_session?.scheduled_for ?? 'z';
          return aTime.localeCompare(bTime);
        });
      case 'name':
        return arr.sort((a, b) => a.full_name.localeCompare(b.full_name));
      case 'grade':
        return arr.sort((a, b) => a.grade - b.grade);
      default:
        return arr;
    }
  }, [students, sortMode]);

  const filtered = useMemo(() => {
    if (!showAll || !search.trim()) return sorted;
    const q = search.toLowerCase();
    return sorted.filter(s =>
      s.full_name.toLowerCase().includes(q) ||
      s.subject.toLowerCase().includes(q)
    );
  }, [sorted, showAll, search]);

  const displayed = showAll ? filtered : sorted.slice(0, 5);

  function handleSort() {
    const options: { label: string; value: SortMode }[] = [
      { label: 'Balance ↑', value: 'balance' },
      { label: 'Next session', value: 'next_session' },
      { label: 'Name A–Z', value: 'name' },
      { label: 'Grade', value: 'grade' },
    ];
    Alert.alert(
      'Sort roster',
      undefined,
      [
        ...options.map(o => ({
          text: o.label + (sortMode === o.value ? ' ✓' : ''),
          onPress: () => {
            setSortMode(o.value);
            AsyncStorage.setItem(SORT_KEY, o.value);
          },
        })),
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  const activeCount = students.length;
  const totalCredits = useMemo(() => students.reduce((sum, s) => sum + s.current_balance, 0), [students]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F4EFE6' }} edges={['top']}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Brand row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Text style={{ fontFamily: F.serif, fontSize: 22, color: '#1B1714' }}>Hour</Text>
            <Text style={{ fontFamily: F.serifItalic, fontSize: 22, color: '#7A2530' }}>Bank</Text>
          </View>
          <TouchableOpacity activeOpacity={0.7}>
            <Feather name="settings" size={20} color="#8A7E72" />
          </TouchableOpacity>
        </View>

        {/* Date eyebrow */}
        <Text style={{ fontFamily: F.mono, fontSize: 11, color: '#8A7E72', marginBottom: 16 }}>
          {getDateEyebrow()}
        </Text>

        {/* Live session pill */}
        {timerStatus === 'active' && liveSessionId && liveStudentId && (
          <TouchableOpacity
            onPress={() => router.push(`/student/${liveStudentId}/session?sessionId=${liveSessionId}`)}
            activeOpacity={0.85}
            style={{
              backgroundColor: COLORS.sessionBg,
              borderRadius: 14,
              paddingHorizontal: 16,
              paddingVertical: 12,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
            }}
          >
            <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.paper }}>
              {'● LIVE · ' + formatDuration(elapsedSeconds)}
            </Text>
            <Feather name="arrow-right" size={14} color={COLORS.paper} />
          </TouchableOpacity>
        )}

        {/* Stat tiles */}
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 24 }}>
          {/* This week */}
          <View style={{
            flex: 1,
            borderWidth: 1,
            borderColor: '#D9CFBF',
            borderRadius: 16,
            backgroundColor: 'rgba(255,255,255,0.4)',
            padding: 16,
          }}>
            <Text style={{ fontFamily: F.mono, fontSize: 9, color: '#8A7E72', textTransform: 'uppercase', marginBottom: 4 }}>
              LESSONS
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <Text style={{ fontFamily: F.mono, fontSize: 18, color: '#1B1714' }}>
                {weekLessons}
              </Text>
              <Text style={{ fontFamily: F.serifItalic, fontSize: 13, color: '#4A413A' }}>lessons</Text>
            </View>
          </View>

          {/* Active */}
          <View style={{
            flex: 1,
            borderWidth: 1,
            borderColor: '#D9CFBF',
            borderRadius: 16,
            backgroundColor: 'rgba(255,255,255,0.4)',
            padding: 16,
          }}>
            <Text style={{ fontFamily: F.mono, fontSize: 9, color: '#8A7E72', textTransform: 'uppercase', marginBottom: 4 }}>
              ACTIVE
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <Text style={{ fontFamily: F.mono, fontSize: 18, color: '#1B1714' }}>
                {activeCount}
              </Text>
              <Text style={{ fontFamily: F.serifItalic, fontSize: 13, color: '#4A413A' }}>students</Text>
            </View>
          </View>

          {/* Total credits */}
          <View style={{
            flex: 1,
            borderWidth: 1,
            borderColor: '#D9CFBF',
            borderRadius: 16,
            backgroundColor: 'rgba(255,255,255,0.4)',
            padding: 16,
          }}>
            <Text style={{ fontFamily: F.mono, fontSize: 9, color: '#8A7E72', textTransform: 'uppercase', marginBottom: 4 }}>
              TOTAL CRED
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <Text style={{ fontFamily: F.mono, fontSize: 18, color: '#1B1714' }}>
                {formatHours(totalCredits)}
              </Text>
            </View>
          </View>
        </View>

        {/* Section header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ fontFamily: F.mono, fontSize: 11, color: '#1B1714', textTransform: 'uppercase', flex: 1 }}>
            ROSTER
          </Text>
          <TouchableOpacity onPress={handleSort} activeOpacity={0.7} style={{ marginRight: 16 }}>
            <Feather name="sliders" size={16} color="#8A7E72" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setShowAll(v => !v); setSearch(''); }}
            activeOpacity={0.7}
          >
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: '#7A2530' }}>
              {showAll ? '← Limited' : 'All →'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/student/new')}
            activeOpacity={0.7}
            style={{ marginLeft: 16 }}
          >
            <Feather name="plus-circle" size={20} color="#7A2530" />
          </TouchableOpacity>
        </View>

        {/* Search bar — only in All mode */}
        {showAll && (
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search students..."
            placeholderTextColor="#8A7E72"
            style={{
              borderWidth: 1,
              borderColor: '#D9CFBF',
              borderRadius: 12,
              paddingHorizontal: 16,
              paddingVertical: 8,
              marginBottom: 12,
              fontFamily: F.sans,
              fontSize: 14,
              color: '#1B1714',
              backgroundColor: 'rgba(255,255,255,0.4)',
            }}
          />
        )}

        {/* Student list */}
        {loading ? (
          <Text style={{ fontFamily: F.mono, fontSize: 12, color: '#8A7E72', textAlign: 'center', marginTop: 24 }}>
            Loading...
          </Text>
        ) : displayed.length === 0 ? (
          <Text style={{ fontFamily: F.mono, fontSize: 12, color: '#8A7E72', textAlign: 'center', marginTop: 24 }}>
            No students yet. Tap + to add one.
          </Text>
        ) : (
          <View style={{ gap: 12 }}>
            {displayed.map(student => {
              // Adapt next_session: StudentCard expects scheduled_for as string (non-null)
              const adaptedStudent = {
                ...student,
                next_session: student.next_session?.scheduled_for
                  ? {
                      scheduled_for: student.next_session.scheduled_for,
                      mode: student.next_session.mode,
                    }
                  : null,
              };
              return (
                <StudentCard
                  key={student.id}
                  student={adaptedStudent}
                  onPress={() => router.push(`/student/${student.id}`)}
                />
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
