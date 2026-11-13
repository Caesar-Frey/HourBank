import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { F, MIN_TOUCH, hitSlopFor } from '../../src/theme/fonts';
import { COLORS } from '../../src/theme/colors';
import { TabHeader } from '../../src/components/ScreenHeader';
import { ActionSheet, ActionSheetItem } from '../../src/components/ActionSheet';
import { useToast } from '../../src/components/Toast';
import { RosterStudentCard } from '../../src/components/home/RosterStudentCard';
import { TodayCard, LiveLessonPill } from '../../src/components/home/TodayCard';
import { NeedsAttentionCard } from '../../src/components/home/NeedsAttentionCard';
import { SetupCard } from '../../src/components/home/SetupCard';
import { StudentPickerSheet } from '../../src/components/calendar/StudentPickerSheet';
import { getOrCreateTutorProfile, getSetupStatus, type SetupStatus } from '../../src/db/tutorProfile';
import {
  RosterStudent,
  SortMode,
  SORT_OPTIONS,
  isSortMode,
  sortRoster,
  rosterHeading,
  rosterSummary,
  splitToday,
  buildNeedsAttention,
  overOweMessage,
  backupNudge,
  rosterHoursTotals,
  rosterMatchesSearch,
} from '../../src/components/home/homeLogic';
import { listActiveStudents, listPausedStudents, listArchivedStudents } from '../../src/db/students';
import {
  listAgenda,
  startSession,
  isSessionError,
  getActiveOrPausedSession,
  computeElapsedSeconds,
  Agenda,
  AgendaItem,
  OweCheck,
} from '../../src/db/sessions';
import { getWeekLessonStats, WeekLessonStats } from '../../src/db/reports';
import { formatHours, pluralize } from '../../src/utils/format';
import { useSessionTimer } from '../../src/contexts/SessionTimerContext';
import { getLastBackupAt, BACKUP_NUDGE_DISMISSED_TIER_KEY } from '../../src/utils/backup';

const SORT_KEY = '@hourbank/roster_sort';
const ROSTER_LIMIT = 5;
const EMPTY_WEEK: WeekLessonStats = { completedCount: 0, completedHours: 0, scheduledCount: 0, scheduledHours: 0 };

type HomeData = {
  active: RosterStudent[];
  paused: RosterStudent[];
  agenda: Agenda;
  archivedCount: number;
};

function getDateEyebrow(): string {
  const d = new Date();
  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${days[d.getDay()]} · ${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]}`;
}

const SECTION_LABEL = {
  fontFamily: F.mono,
  fontSize: 12,
  color: COLORS.ink,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
} as const;

const TILE = {
  flex: 1,
  borderWidth: 1,
  borderColor: COLORS.paperEdge,
  borderRadius: 16,
  backgroundColor: COLORS.cardFill,
  padding: 16,
} as const;
const TILE_LABEL = { fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 4 } as const;
const TILE_NUMBER = { fontFamily: F.mono, fontSize: 18, color: COLORS.ink } as const;
const TILE_UNIT = { fontFamily: F.serifItalic, fontSize: 13, color: COLORS.inkSoft } as const;
const TILE_SUB = { fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, marginTop: 2 } as const;

export default function HomeScreen() {
  const router = useRouter();
  const toast = useToast();
  const {
    status: timerStatus,
    sessionId: timerSessionId,
    elapsedSeconds: timerElapsed,
    startTimer,
  } = useSessionTimer();

  // null until AsyncStorage answers → the roster never renders in the wrong order first.
  const [sortMode, setSortMode] = useState<SortMode | null>(null);
  const [bookPicker, setBookPicker] = useState(false);
  const [sortSheetVisible, setSortSheetVisible] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState('');
  const [data, setData] = useState<HomeData | null>(null);
  const [setup, setSetup] = useState<{ status: SetupStatus; rate: number } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [weekStats, setWeekStats] = useState<WeekLessonStats>(EMPTY_WEEK);
  const [nudge, setNudge] = useState<{ show: boolean; tier: number | null; message: string }>({
    show: false,
    tier: null,
    message: '',
  });
  const [starting, setStarting] = useState<string | null>(null);
  const startingRef = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(SORT_KEY)
      .then(v => setSortMode(isSortMode(v) ? v : 'balance'))
      .catch(() => setSortMode('balance'));
  }, []);

  const load = useCallback(() => {
    let hasStudents = false;
    try {
      const p = getOrCreateTutorProfile();
      setSetup({ status: getSetupStatus(p), rate: p.hourly_rate });
    } catch {
      setSetup(null);
    }
    try {
      const active = listActiveStudents();
      const paused = listPausedStudents();
      const agenda = listAgenda();
      let archivedCount = 0;
      try {
        archivedCount = listArchivedStudents().length;
      } catch {
        archivedCount = 0;
      }
      hasStudents = active.length + paused.length > 0;
      setData({ active, paused, agenda, archivedCount });
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
    try {
      setWeekStats(getWeekLessonStats());
    } catch {
      setWeekStats(EMPTY_WEEK);
    }
    Promise.all([getLastBackupAt(), AsyncStorage.getItem(BACKUP_NUDGE_DISMISSED_TIER_KEY)])
      .then(([lastBackup, storedTier]) => {
        const dismissedTier = storedTier ? Number(storedTier) : null;
        const daysSince = lastBackup ? (Date.now() - new Date(lastBackup).getTime()) / 86_400_000 : null;
        setNudge(backupNudge({ daysSince, hasStudents, dismissedTier }));
      })
      .catch(() => setNudge(n => ({ ...n, show: false })));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Keep the live pill / Today card in step when a lesson starts, pauses or ends elsewhere.
  // (Skips the mount run — useFocusEffect already loaded.)
  const timerSyncMounted = useRef(false);
  useEffect(() => {
    if (!timerSyncMounted.current) {
      timerSyncMounted.current = true;
      return;
    }
    load();
  }, [timerStatus, timerSessionId, load]);

  // ── Derived ────────────────────────────────────────────────────────────
  const active = data?.active ?? [];
  const paused = data?.paused ?? [];

  const sorted = useMemo(() => sortRoster(active, sortMode ?? 'balance'), [active, sortMode]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!showAll || !q) return sorted;
    return sorted.filter(s => rosterMatchesSearch(s, q));
  }, [sorted, showAll, search]);
  const displayed = showAll ? filtered : sorted.slice(0, ROSTER_LIMIT);

  const today = useMemo(() => (data ? splitToday(data.agenda) : null), [data]);
  const attention = useMemo(
    () => (data ? buildNeedsAttention({ agenda: data.agenda, students: [...data.active, ...data.paused] }) : []),
    [data]
  );

  const { hoursBanked, hoursOwed } = useMemo(() => {
    // Per subject: credit in one subject doesn't hide hours owed in another.
    const t = rosterHoursTotals([...active, ...paused]);
    return { hoursBanked: t.banked, hoursOwed: t.owed };
  }, [active, paused]);

  // Live pill: the context ticks for the session it owns; otherwise derive from the DB row.
  const live = today?.live ?? null;
  const liveOwnedByTimer = live !== null && timerSessionId === live.id && timerStatus !== 'idle';
  const liveView: AgendaItem | null = live
    ? { ...live, status: liveOwnedByTimer ? (timerStatus === 'paused' ? 'paused' : 'active') : live.status }
    : null;
  const liveElapsed = live ? (liveOwnedByTimer ? timerElapsed : computeElapsedSeconds(live)) : 0;

  // ── Actions ────────────────────────────────────────────────────────────
  const openLive = useCallback(
    (sessionId: string, studentId: string) => router.push(`/student/${studentId}/session?sessionId=${sessionId}`),
    [router]
  );

  function startLesson(item: AgendaItem, allowOverOwe = false) {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(item.id);
    try {
      const s = startSession(item.id, { allowOverOwe });
      startTimer(s.id, s.student_id, s.started_at!, s.paused_seconds ?? 0);
      openLive(s.id, s.student_id);
    } catch (e) {
      if (isSessionError(e, 'OVER_OWE_LIMIT')) {
        const msg = overOweMessage(item.student_full_name, e.details as unknown as OweCheck);
        Alert.alert(msg.title, msg.body, [
          { text: 'Not now', style: 'cancel' },
          { text: 'Start anyway', onPress: () => startLesson(item, true) },
        ]);
      } else if (isSessionError(e, 'ALREADY_ACTIVE')) {
        const d = e.details as { activeSessionId?: string; activeStudentId?: string } | undefined;
        const running =
          d?.activeSessionId && d.activeStudentId
            ? { id: d.activeSessionId, student_id: d.activeStudentId }
            : getActiveOrPausedSession();
        toast.show({ kind: 'info', message: 'Another lesson is in progress — finish or discard it first.' });
        if (running) openLive(running.id, running.student_id);
      } else if (isSessionError(e, 'NOT_STARTABLE')) {
        toast.show({ kind: 'error', message: "This lesson can't be started any more." });
        load();
      } else {
        toast.show({ kind: 'error', message: "Couldn't start the lesson. Try again." });
      }
    } finally {
      startingRef.current = false;
      setStarting(null);
    }
  }

  async function dismissNudge() {
    setNudge(n => ({ ...n, show: false }));
    if (nudge.tier !== null) {
      try {
        await AsyncStorage.setItem(BACKUP_NUDGE_DISMISSED_TIER_KEY, String(nudge.tier));
      } catch {
        // dismissal is a convenience; it will just show again next time
      }
    }
  }

  const sortItems: ActionSheetItem[] = SORT_OPTIONS.map(o => ({
    label: o.label + (sortMode === o.value ? '  ✓' : ''),
    onPress: () => {
      setSortMode(o.value);
      AsyncStorage.setItem(SORT_KEY, o.value).catch(() => {});
      setSortSheetVisible(false);
    },
  }));

  const ready = data !== null && sortMode !== null;
  const noStudents = ready && active.length === 0 && paused.length === 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
      <TabHeader title="Hour" titleAccent="Bank" subtitle={getDateEyebrow()} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Stale backup nudge */}
        {nudge.show && (
          <View
            style={{
              backgroundColor: COLORS.warnFill,
              borderWidth: 1,
              borderColor: COLORS.amber,
              borderRadius: 12,
              paddingLeft: 14,
              marginBottom: 16,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <TouchableOpacity
              onPress={() => router.push('/profile')}
              activeOpacity={0.8}
              accessibilityRole="button"
              style={{ flex: 1, minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', paddingVertical: 10 }}
            >
              <Feather name="shield" size={14} color={COLORS.amber} style={{ marginRight: 8 }} />
              <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft, flex: 1 }}>{nudge.message}</Text>
              <Feather name="chevron-right" size={14} color={COLORS.inkSoft} style={{ marginLeft: 8 }} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={dismissNudge}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Dismiss backup reminder"
              style={{ width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}
            >
              <Feather name="x" size={14} color={COLORS.inkFaint} />
            </TouchableOpacity>
          </View>
        )}

        {/* Live / paused lesson */}
        {liveView && (
          <LiveLessonPill
            lesson={liveView}
            elapsedSeconds={liveElapsed}
            onPress={() => openLive(liveView.id, liveView.student_id)}
          />
        )}

        {/* Finish setting up (A5) — above Today */}
        {setup ? (
          <SetupCard
            status={setup.status}
            starterRate={setup.rate}
            onOpen={target => router.navigate(`/profile?focus=${target}`)}
          />
        ) : null}

        {/* Today */}
        {today && (
          <TodayCard
            today={today}
            starting={starting}
            onStart={item => startLesson(item)}
            onOpenLesson={item => router.push(`/lesson/${item.id}`)}
          />
        )}

        {/* Record / book from Home (C2): both pick the student first. */}
        {ready && !noStudents ? (
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
            <HomeAction icon="check" label="Record a lesson" onPress={() => router.push('/start-lesson')} testID="home-record" />
            <HomeAction icon="calendar" label="Book a lesson" onPress={() => setBookPicker(true)} testID="home-book" />
          </View>
        ) : null}

        {/* Needs attention (collapses when empty) */}
        <NeedsAttentionCard items={attention} onPress={item => router.push(item.href)} />

        {/* Stat tiles — 2×2 */}
        <View style={{ gap: 12, marginBottom: 24 }}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={TILE}>
              <Text style={TILE_LABEL}>THIS WEEK · DONE</Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                <Text style={TILE_NUMBER}>{weekStats.completedCount}</Text>
                <Text style={TILE_UNIT}>{pluralize(weekStats.completedCount, 'lesson')}</Text>
              </View>
              <Text style={TILE_SUB}>{formatHours(weekStats.completedHours)}</Text>
            </View>
            <View style={TILE}>
              <Text style={TILE_LABEL}>THIS WEEK · BOOKED</Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                <Text style={TILE_NUMBER}>{weekStats.scheduledCount}</Text>
                <Text style={TILE_UNIT}>{pluralize(weekStats.scheduledCount, 'lesson')}</Text>
              </View>
              <Text style={TILE_SUB}>{formatHours(weekStats.scheduledHours)}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={TILE}>
              <Text style={TILE_LABEL}>ACTIVE</Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                <Text style={TILE_NUMBER}>{active.length}</Text>
                <Text style={TILE_UNIT}>{pluralize(active.length, 'student')}</Text>
              </View>
              {paused.length > 0 && <Text style={TILE_SUB}>{`+${paused.length} paused`}</Text>}
            </View>
            <View style={TILE}>
              <Text style={TILE_LABEL}>HOURS BANKED</Text>
              <Text style={TILE_NUMBER}>{formatHours(hoursBanked)}</Text>
              {hoursOwed > 0 && (
                <Text style={[TILE_SUB, { color: COLORS.oxblood }]}>{`OWED ${formatHours(hoursOwed)}`}</Text>
              )}
            </View>
          </View>
        </View>

        {/* ── Students ─────────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <Text style={[SECTION_LABEL, { flex: 1 }]} numberOfLines={1}>{rosterHeading(sortMode ?? 'balance')}</Text>
          {active.length > 1 && (
            <TouchableOpacity
              onPress={() => setSortSheetVisible(true)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Sort students"
              style={{
                minHeight: MIN_TOUCH,
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 10,
              }}
            >
              <Feather name="arrow-down" size={13} color={COLORS.inkSoft} />
              <Feather name="arrow-up" size={13} color={COLORS.inkSoft} style={{ marginLeft: -3 }} />
              <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: COLORS.inkSoft, marginLeft: 4 }}>Sort</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => router.push('/student/new')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Add student"
            style={{ minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', paddingLeft: 10 }}
          >
            <Feather name="plus-circle" size={18} color={COLORS.oxblood} />
            <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: COLORS.oxblood, marginLeft: 4 }}>Add</Text>
          </TouchableOpacity>
        </View>

        {showAll && active.length > 0 && (
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search students…"
            placeholderTextColor={COLORS.inkFaint}
            style={{
              minHeight: MIN_TOUCH,
              borderWidth: 1,
              borderColor: COLORS.paperEdge,
              borderRadius: 12,
              paddingHorizontal: 16,
              marginBottom: 12,
              fontFamily: F.sans,
              fontSize: 14,
              color: COLORS.ink,
              backgroundColor: COLORS.cardFill,
            }}
          />
        )}

        {loadError ? (
          <View style={{ borderWidth: 1, borderColor: COLORS.crimson, borderRadius: 16, padding: 16, marginBottom: 24 }}>
            <Text style={{ fontFamily: F.serifItalic, fontSize: 16, color: COLORS.ink }}>Couldn't load your students.</Text>
            <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft, marginTop: 4 }}>
              Your data is still on this phone. Try again, or restart the app.
            </Text>
            <TouchableOpacity
              onPress={load}
              activeOpacity={0.8}
              accessibilityRole="button"
              style={{
                minHeight: MIN_TOUCH,
                alignSelf: 'flex-start',
                justifyContent: 'center',
                paddingHorizontal: 16,
                marginTop: 12,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: COLORS.ink,
              }}
            >
              <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.ink }}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : !ready ? (
          <ActivityIndicator color={COLORS.inkFaint} style={{ marginVertical: 24 }} />
        ) : noStudents ? (
          <View
            style={{
              borderWidth: 1,
              borderColor: COLORS.paperEdge,
              borderRadius: 16,
              backgroundColor: COLORS.cardFill,
              padding: 20,
              alignItems: 'center',
              marginBottom: 24,
            }}
          >
            <Text style={{ fontFamily: F.serifItalic, fontSize: 20, color: COLORS.ink }}>No students yet</Text>
            <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft, marginTop: 6, textAlign: 'center' }}>
              Add a student, top up their hours, and HourBank keeps the balance for you.
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/student/new')}
              activeOpacity={0.85}
              accessibilityRole="button"
              style={{
                minHeight: 48,
                justifyContent: 'center',
                paddingHorizontal: 20,
                marginTop: 16,
                borderRadius: 14,
                backgroundColor: COLORS.oxblood,
              }}
            >
              <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.paper }}>Add your first student</Text>
            </TouchableOpacity>
          </View>
        ) : active.length === 0 ? (
          <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft, marginBottom: 16 }}>
            No active students — everyone is paused.
          </Text>
        ) : displayed.length === 0 ? (
          <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft, marginBottom: 16 }}>
            {`No students match “${search.trim()}”.`}
          </Text>
        ) : (
          <View style={{ gap: 12 }}>
            {displayed.map(student => (
              <RosterStudentCard
                key={student.id}
                student={student}
                onPress={() => router.push(`/student/${student.id}?from=HOME`)}
              />
            ))}
          </View>
        )}

        {ready && !loadError && active.length > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 20 }}>
            <Text style={{ flex: 1, fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint }}>
              {rosterSummary(displayed.length, active.length, sortMode ?? 'balance')}
            </Text>
            {active.length > ROSTER_LIMIT && (
              <TouchableOpacity
                onPress={() => {
                  setShowAll(v => !v);
                  setSearch('');
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                hitSlop={hitSlopFor(20)}
                style={{ minHeight: MIN_TOUCH, justifyContent: 'center', paddingLeft: 12 }}
              >
                <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.oxblood }}>
                  {showAll ? 'Show fewer' : `All ${active.length} →`}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Paused ───────────────────────────────────────────────────── */}
        {paused.length > 0 && (
          <View style={{ marginBottom: 20 }}>
            <Text style={[SECTION_LABEL, { color: COLORS.inkFaint, marginBottom: 12 }]}>{`Paused · ${paused.length}`}</Text>
            <View style={{ gap: 12 }}>
              {paused.map(student => (
                <RosterStudentCard
                  key={student.id}
                  student={student}
                  paused
                  onPress={() => router.push(`/student/${student.id}?from=HOME`)}
                />
              ))}
            </View>
          </View>
        )}

        {/* ── Archived ─────────────────────────────────────────────────── */}
        {(data?.archivedCount ?? 0) > 0 && (
          <TouchableOpacity
            onPress={() => router.push('/student/archived')}
            activeOpacity={0.7}
            accessibilityRole="button"
            style={{
              minHeight: MIN_TOUCH,
              flexDirection: 'row',
              alignItems: 'center',
              borderTopWidth: 1,
              borderTopColor: COLORS.paperEdge,
              paddingTop: 4,
            }}
          >
            <Feather name="archive" size={14} color={COLORS.inkFaint} />
            <Text style={{ flex: 1, fontFamily: F.sans, fontSize: 14, color: COLORS.inkSoft, marginLeft: 8 }}>
              Archived students
            </Text>
            <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, marginRight: 6 }}>
              {data?.archivedCount}
            </Text>
            <Feather name="chevron-right" size={14} color={COLORS.inkFaint} />
          </TouchableOpacity>
        )}
      </ScrollView>

      <StudentPickerSheet
        visible={bookPicker}
        title="Book a lesson"
        students={[...active, ...paused]}
        onClose={() => setBookPicker(false)}
        onPick={sid => {
          setBookPicker(false);
          router.push(`/student/${sid}/schedule`);
        }}
        onAddStudent={() => {
          setBookPicker(false);
          router.push('/student/new');
        }}
      />
      <ActionSheet visible={sortSheetVisible} onDismiss={() => setSortSheetVisible(false)} items={sortItems} />
    </SafeAreaView>
  );
}

function HomeAction({ icon, label, onPress, testID }: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={{
        flex: 1, minHeight: 48, borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 14,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 8,
      }}
    >
      <Feather name={icon} size={15} color={COLORS.oxblood} />
      <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.ink }} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}
