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
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { F } from '../../src/theme/fonts';
import { StudentCard } from '../../src/components/StudentCard';
import { listActiveStudents, listPausedStudents } from '../../src/db/students';
import { sessionsThisWeekCount } from '../../src/db/sessions';
import { formatHours, formatDuration } from '../../src/utils/format';
import { useSessionTimer } from '../../src/contexts/SessionTimerContext';
import { COLORS } from '../../src/theme/colors';
import { Student, Session } from '../../src/db/schema';
import { getLastBackupAt, shouldShowNudge, getCurrentNudgeTier, BACKUP_NUDGE_DISMISSED_TIER_KEY } from '../../src/utils/backup';

const SORT_KEY = '@hourbank/roster_sort';
type SortMode = 'balance' | 'next_session' | 'name' | 'grade';

type RosterStudent = Student & { current_balance: number; next_session: Session | null };

function getDateEyebrow(): string {
  const d = new Date();
  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const day = days[d.getDay()];
  const date = String(d.getDate()).padStart(2, '0');
  const month = months[d.getMonth()];
  return `${day} · ${date} ${month}`;
}

function adaptStudent(student: RosterStudent) {
  return {
    ...student,
    next_session: student.next_session?.scheduled_for
      ? {
          scheduled_for: student.next_session.scheduled_for,
          mode: student.next_session.mode,
        }
      : null,
  };
}

export default function HomeScreen() {
  const router = useRouter();
  const { status: timerStatus, sessionId: liveSessionId, studentId: liveStudentId, elapsedSeconds } = useSessionTimer();
  const [sortMode, setSortMode] = useState<SortMode>('balance');
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState('');
  const [weekLessons, setWeekLessons] = useState(0);
  const [activeStudents, setActiveStudents] = useState<RosterStudent[]>([]);
  const [pausedStudents, setPausedStudents] = useState<RosterStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBackupNudge, setShowBackupNudge] = useState(false);
  const [dismissedTier, setDismissedTier] = useState<number | null>(null);
  const [daysSinceBackup, setDaysSinceBackup] = useState(0);

  // Load sort preference once on mount
  useEffect(() => {
    AsyncStorage.getItem(SORT_KEY).then(v => {
      if (v) setSortMode(v as SortMode);
    });
  }, []);

  // Reload all roster data on focus
  useFocusEffect(
    useCallback(() => {
      try {
        setActiveStudents(listActiveStudents());
        setPausedStudents(listPausedStudents());
        setLoading(false);
      } catch {
        setLoading(false);
      }
      try {
        setWeekLessons(sessionsThisWeekCount());
      } catch {
        setWeekLessons(0);
      }
      // Check backup staleness (async, fire-and-forget)
      Promise.all([
        getLastBackupAt(),
        AsyncStorage.getItem(BACKUP_NUDGE_DISMISSED_TIER_KEY),
      ]).then(([lastBackup, storedTier]) => {
        const dismissed = storedTier ? Number(storedTier) : null;
        setDismissedTier(dismissed);
        if (!lastBackup) {
          setDaysSinceBackup(999);
          setShowBackupNudge(shouldShowNudge(999, dismissed));
          return;
        }
        const daysSince = (Date.now() - new Date(lastBackup).getTime()) / (1000 * 60 * 60 * 24);
        setDaysSinceBackup(daysSince);
        setShowBackupNudge(shouldShowNudge(daysSince, dismissed));
      }).catch(() => setShowBackupNudge(false));
    }, [])
  );

  const sorted = useMemo(() => {
    const arr = [...activeStudents];
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
  }, [activeStudents, sortMode]);

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

  const activeCount = activeStudents.length;
  const totalCredits = useMemo(() => {
    const sumPositive = (xs: typeof activeStudents) =>
      xs.reduce((sum, s) => sum + Math.max(s.current_balance ?? 0, 0), 0);
    return sumPositive(activeStudents) + sumPositive(pausedStudents);
  }, [activeStudents, pausedStudents]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Brand row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Text style={{ fontFamily: F.serif, fontSize: 22, color: COLORS.ink }}>Hour</Text>
            <Text style={{ fontFamily: F.serifItalic, fontSize: 22, color: COLORS.oxblood }}>Bank</Text>
          </View>
          <TouchableOpacity activeOpacity={0.7} onPress={() => router.push('/profile')}>
            <Feather name="settings" size={20} color={COLORS.inkFaint} />
          </TouchableOpacity>
        </View>

        {/* Date eyebrow */}
        <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint, marginBottom: 16 }}>
          {getDateEyebrow()}
        </Text>

        {/* Stale backup nudge */}
        {showBackupNudge && (
          <View
            style={{
              backgroundColor: COLORS.warnFill,
              borderWidth: 1,
              borderColor: COLORS.amber,
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 10,
              marginBottom: 12,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <TouchableOpacity
              onPress={() => router.push('/profile')}
              activeOpacity={0.8}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
            >
              <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft, flex: 1 }}>
                {'Database not backed up in 14+ days. Go to Settings → Export.'}
              </Text>
              <Feather name="chevron-right" size={14} color={COLORS.inkSoft} style={{ marginLeft: 8 }} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => {
                const tier = getCurrentNudgeTier(daysSinceBackup);
                if (tier !== null) {
                  await AsyncStorage.setItem(BACKUP_NUDGE_DISMISSED_TIER_KEY, String(tier));
                  setDismissedTier(tier);
                }
                setShowBackupNudge(false);
              }}
              activeOpacity={0.7}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={{ paddingLeft: 12, paddingVertical: 4 }}
            >
              <Feather name="x" size={14} color={COLORS.inkFaint} />
            </TouchableOpacity>
          </View>
        )}

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
            borderColor: COLORS.paperEdge,
            borderRadius: 16,
            backgroundColor: 'rgba(255,255,255,0.4)',
            padding: 16,
          }}>
            <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>
              THIS WEEK
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <Text style={{ fontFamily: F.mono, fontSize: 18, color: COLORS.ink }}>
                {weekLessons}
              </Text>
              <Text style={{ fontFamily: F.serifItalic, fontSize: 13, color: COLORS.inkSoft }}>lessons</Text>
            </View>
          </View>

          {/* Active */}
          <View style={{
            flex: 1,
            borderWidth: 1,
            borderColor: COLORS.paperEdge,
            borderRadius: 16,
            backgroundColor: 'rgba(255,255,255,0.4)',
            padding: 16,
          }}>
            <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>
              ACTIVE
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <Text style={{ fontFamily: F.mono, fontSize: 18, color: COLORS.ink }}>
                {activeCount}
              </Text>
              <Text style={{ fontFamily: F.serifItalic, fontSize: 13, color: COLORS.inkSoft }}>students</Text>
            </View>
          </View>

          {/* Total credits */}
          <View style={{
            flex: 1,
            borderWidth: 1,
            borderColor: COLORS.paperEdge,
            borderRadius: 16,
            backgroundColor: 'rgba(255,255,255,0.4)',
            padding: 16,
          }}>
            <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>
              HOURS BANKED
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <Text style={{ fontFamily: F.mono, fontSize: 18, color: COLORS.ink }}>
                {formatHours(totalCredits)}
              </Text>
            </View>
          </View>
        </View>

        {/* ── ACTIVE section ─────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.ink, textTransform: 'uppercase', flex: 1 }}>
            ACTIVE
          </Text>
          <TouchableOpacity onPress={handleSort} activeOpacity={0.7} style={{ marginRight: 16 }}>
            <Feather name="sliders" size={16} color={COLORS.inkFaint} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setShowAll(v => !v); setSearch(''); }}
            activeOpacity={0.7}
          >
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.oxblood }}>
              {showAll ? '← Limited' : 'All →'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/student/new')}
            activeOpacity={0.7}
            style={{ marginLeft: 16 }}
          >
            <Feather name="plus-circle" size={20} color={COLORS.oxblood} />
          </TouchableOpacity>
        </View>

        {/* Search bar — only in All mode */}
        {showAll && (
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search students..."
            placeholderTextColor={COLORS.inkFaint}
            style={{
              borderWidth: 1,
              borderColor: COLORS.paperEdge,
              borderRadius: 12,
              paddingHorizontal: 16,
              paddingVertical: 8,
              marginBottom: 12,
              fontFamily: F.sans,
              fontSize: 14,
              color: COLORS.ink,
              backgroundColor: 'rgba(255,255,255,0.4)',
            }}
          />
        )}

        {loading ? (
          <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, textAlign: 'center', marginTop: 24 }}>
            Loading...
          </Text>
        ) : displayed.length === 0 ? (
          <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, textAlign: 'center', marginTop: 8, marginBottom: 24 }}>
            No active students. Tap + to add one.
          </Text>
        ) : (
          <View style={{ gap: 12, marginBottom: 24 }}>
            {displayed.map(student => (
              <View key={student.id}>
                <StudentCard
                  student={adaptStudent(student)}
                  onPress={() => router.push(`/student/${student.id}`)}
                />
                {student.current_balance < 0 && (
                  <Text
                    style={{
                      fontFamily: F.mono,
                      fontSize: 10,
                      color: COLORS.crimson,
                      textTransform: 'uppercase',
                      letterSpacing: 0.3,
                      marginTop: -2,
                      marginLeft: 16,
                    }}
                  >
                    owes {Math.abs(student.current_balance).toFixed(1)}h
                  </Text>
                )}
              </View>
            ))}
          </View>
        )}

        {/* ── PAUSED section ─────────────────────────────────────────────── */}
        {pausedStudents.length > 0 && (
          <View style={{ marginBottom: 24 }}>
            <Text style={{
              fontFamily: F.mono,
              fontSize: 11,
              color: COLORS.inkFaint,
              textTransform: 'uppercase',
              marginBottom: 12,
            }}>
              PAUSED
            </Text>
            <View style={{ gap: 10 }}>
              {pausedStudents.map(student => (
                <TouchableOpacity
                  key={student.id}
                  onPress={() => router.push(`/student/${student.id}`)}
                  activeOpacity={0.7}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderWidth: 1,
                    borderColor: COLORS.paperEdge,
                    borderRadius: 14,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    backgroundColor: 'rgba(255,255,255,0.25)',
                  }}
                >
                  <View>
                    <Text style={{ fontFamily: F.serifItalic, fontSize: 15, color: COLORS.inkFaint }}>
                      {student.full_name}
                    </Text>
                    <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, marginTop: 2 }}>
                      {`GR ${student.grade} · ${student.subject} · ON HIATUS`}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.inkFaint }}>
                    {formatHours(student.current_balance)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* ── ARCHIVED count ─────────────────────────────────────────────── */}
        {/* Archived students are not listed — just a static muted count line */}
        {/* This placeholder renders nothing; archived count can be added in Phase 2 */}
      </ScrollView>
    </SafeAreaView>
  );
}
