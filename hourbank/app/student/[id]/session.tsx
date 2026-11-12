import React, { useState, useEffect, useCallback, useRef } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { COLORS } from '../../../src/theme/colors';
import { F, MIN_TOUCH } from '../../../src/theme/fonts';
import { useDarkTabBar } from '../../../src/hooks/useDarkTabBar';
import { useStartLesson } from '../../../src/hooks/useStartLesson';
import { getDb } from '../../../src/db/client';
import { getStudent } from '../../../src/db/students';
import { currentBalance } from '../../../src/db/ledger';
import { getPrimarySubjectId, getSubjectBalance } from '../../../src/db/subjects';
import {
  cancelScheduled,
  computeElapsedSeconds,
  discardSession,
  getSession,
  parseSessionTopics,
  saveLiveTopics,
  setInFlightMode,
} from '../../../src/db/sessions';
import { listTopicsForStudentSubject } from '../../../src/db/catalog';
import { subjectNameFor } from '../../../src/components/lesson/lessonFormData';
import { TopicChip } from '../../../src/components/TopicChip';
import { ActionSheet } from '../../../src/components/ActionSheet';
import { useToast } from '../../../src/components/Toast';
import { formatDuration, formatHours, formatScheduledTime } from '../../../src/utils/format';
import { Session, Student } from '../../../src/db/schema';
import { useSessionTimer } from '../../../src/contexts/SessionTimerContext';
import { lessonDraftStore, remainingInfo } from '../../../src/contexts/SessionTimerContext.helpers';

const SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

export default function SessionScreen() {
  const { id, sessionId } = useLocalSearchParams<{ id: string; sessionId: string }>();
  const router = useRouter();
  const toast = useToast();
  const startLesson = useStartLesson();

  const [row, setRow] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<'in_person' | 'online'>('in_person');
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const selectedTopicsRef = useRef<string[]>([]);
  selectedTopicsRef.current = selectedTopics;
  const [addingTopic, setAddingTopic] = useState(false);
  const [customTopic, setCustomTopic] = useState('');
  const [student, setStudent] = useState<Student | null>(null);
  /** The LESSON's subject (multi-subject students); falls back to students.subject. */
  const [lessonSubject, setLessonSubject] = useState<string | null>(null);
  const [balance, setBalance] = useState(0);
  const [sessionCount, setSessionCount] = useState(1);
  const [availableTopics, setAvailableTopics] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  const {
    status: timerStatus,
    sessionId: timerSessionId,
    elapsedSeconds: timerElapsed,
    pauseTimer,
    resumeTimer,
    refreshFromDb,
    endTimer,
  } = useSessionTimer();

  useDarkTabBar();
  // Short phones (≈640dp): tighter spacing + smaller dial so Pause/End sit on screen.
  const { height: windowHeight } = useWindowDimensions();
  const compact = windowHeight < 720;
  const dial = compact ? 212 : 232;
  const digits = compact ? 34 : 40;

  // One-time load: student, topics, prefilled lesson details.
  useEffect(() => {
    try {
      const s = getStudent(id);
      if (s) {
        setStudent(s);
        const db = getDb();
        const c = db.getFirstSync<{ count: number }>(
          `SELECT COUNT(*) AS count FROM sessions WHERE student_id = ? AND status = 'completed'`,
          [id],
        );
        setSessionCount((c?.count ?? 0) + 1);
      }
      const sess = getSession(sessionId);
      let subjectName = s?.subject ?? null;
      try {
        subjectName = subjectNameFor(sess?.subject_id) ?? subjectName;
      } catch { /* keep student subject */ }
      setLessonSubject(subjectName);
      if (s && subjectName) setAvailableTopics(listTopicsForStudentSubject(subjectName).map(t => t.name));
      if (sess) {
        if (sess.mode === 'online' || sess.mode === 'in_person') setMode(sess.mode);
        // Planned topics (scheduled) or live picks persisted before an app kill.
        const picked = parseSessionTopics(sess.topics);
        if (picked.length > 0) showTopics(picked);
      }
    } catch (e) {
      console.error('SessionScreen mount error', e);
    }
  }, [id, sessionId]);

  // Every focus (incl. Back from end-session): status + balance + elapsed from the DB.
  const reload = useCallback(() => {
    try {
      const fresh = getSession(sessionId);
      setRow(fresh);
      // In-flight lesson: the row's topics are the persisted live picks (also
      // edited on end-session) — the DB is the source of truth.
      if (fresh && (fresh.status === 'active' || fresh.status === 'paused')) {
        showTopics(parseSessionTopics(fresh.topics));
      }
      // The lesson deducts from its own subject — show that balance, not the
      // student's total across subjects (NULL subject_id = primary subject).
      const subjectId = fresh?.subject_id ?? getPrimarySubjectId(id);
      setBalance(subjectId ? getSubjectBalance(id, subjectId) : currentBalance(id));
      refreshFromDb();
    } catch (e) {
      console.error('SessionScreen reload error', e);
    } finally {
      setLoaded(true);
    }
  }, [id, sessionId, refreshFromDb]);

  useFocusEffect(reload);

  const status = row?.status ?? null;

  /** Select `picked`, adding any not already offered as chips. */
  function showTopics(picked: string[]) {
    setSelectedTopics(picked);
    setAvailableTopics(prev => {
      const extras = picked.filter(t => !prev.includes(t));
      return extras.length > 0 ? [...prev, ...extras] : prev;
    });
  }

  /** Update picks and write them to the in-flight session row (survives an app kill). */
  function updateTopics(next: string[]) {
    selectedTopicsRef.current = next;
    setSelectedTopics(next);
    try {
      saveLiveTopics(sessionId, next);
    } catch (e) {
      console.error('saveLiveTopics error', e);
    }
  }

  /** In-person ⇄ online, saved on the lesson row at once so ending prices travel from it (A1). */
  function toggleMode() {
    const prev = mode;
    const next = prev === 'in_person' ? 'online' : 'in_person';
    setMode(next);
    try {
      if (!setInFlightMode(sessionId, next)) throw new Error('lesson not in flight');
    } catch (e) {
      console.error('setInFlightMode error', e);
      setMode(prev);
      toast.show({ kind: 'error', message: "Couldn't switch the lesson mode — try again" });
    }
  }

  // A finished/discarded lesson has nothing to time — show its summary instead.
  useEffect(() => {
    if (status === 'completed' || status === 'cancelled') {
      router.replace(`/lesson/${sessionId}`);
    }
  }, [status, sessionId, router]);

  const isTracked = timerSessionId === sessionId && timerStatus !== 'idle';
  const isPaused = isTracked ? timerStatus === 'paused' : status === 'paused';
  const elapsedSeconds = isTracked ? timerElapsed : row ? computeElapsedSeconds(row) : 0;

  useEffect(() => {
    if (status === 'active' && !isPaused) {
      activateKeepAwakeAsync();
    } else {
      deactivateKeepAwake();
    }
    return () => { deactivateKeepAwake(); };
  }, [status, isPaused]);

  // ── Actions ──────────────────────────────────────────────────────────────

  function minimise() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  function togglePause() {
    const ok = isPaused ? resumeTimer() : pauseTimer();
    if (!ok) toast.show({ kind: 'error', message: isPaused ? "Couldn't resume the lesson" : "Couldn't pause the lesson" });
    reload();
  }

  function handleStart() {
    startLesson(sessionId, {
      studentName: student?.full_name,
      onStarted: () => {
        // Keep anything picked before Start (the row was 'scheduled' until now).
        try {
          saveLiveTopics(sessionId, selectedTopicsRef.current);
        } catch (e) {
          console.error('saveLiveTopics error', e);
        }
        reload();
      },
    });
  }

  function handleCancelScheduled() {
    Alert.alert('Cancel this lesson?', 'It will be marked as cancelled. No hours are deducted.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel lesson',
        style: 'destructive',
        onPress: () => {
          try {
            cancelScheduled(sessionId);
            toast.show({ kind: 'success', message: 'Lesson cancelled' });
            minimise();
          } catch (e) {
            console.error('cancelScheduled error', e);
            toast.show({ kind: 'error', message: "Couldn't cancel — the lesson may have changed" });
            reload();
          }
        },
      },
    ]);
  }

  function handleReschedule() {
    router.replace(`/student/${id}/schedule?sessionId=${sessionId}`);
  }

  function confirmDiscard() {
    Alert.alert(
      'Discard this lesson?',
      `Nothing will be saved and no hours deducted for ${student?.full_name ?? 'this student'}. This can't be undone.`,
      [
        { text: 'Keep teaching', style: 'cancel' },
        {
          text: 'Discard lesson',
          style: 'destructive',
          onPress: () => {
            try {
              discardSession(sessionId);
              lessonDraftStore.clear(sessionId);
              endTimer();
              toast.show({ kind: 'info', message: 'Lesson discarded — no hours deducted' });
              minimise();
            } catch (e) {
              console.error('discardSession error', e);
              toast.show({ kind: 'error', message: "Couldn't discard the lesson" });
              reload();
            }
          },
        },
      ],
    );
  }

  function handleEndSession() {
    if (selectedTopics.length < 1) {
      Alert.alert('Select a topic', 'Select at least one topic before ending the lesson.');
      return;
    }
    // Timer keeps running: Back from the review returns to a live timer.
    // The end time is frozen here so the review time isn't billed.
    const topicsParam = encodeURIComponent(JSON.stringify(selectedTopics));
    const endedAt = encodeURIComponent(new Date().toISOString());
    router.push(
      `/student/${id}/end-session?sessionId=${sessionId}&endedAt=${endedAt}&mode=${mode}&topics=${topicsParam}`,
    );
  }

  function toggleTopic(topic: string) {
    const prev = selectedTopicsRef.current;
    updateTopics(prev.includes(topic) ? prev.filter(t => t !== topic) : [...prev, topic]);
  }

  function submitCustomTopic() {
    const trimmed = customTopic.trim();
    if (!trimmed) { setAddingTopic(false); setCustomTopic(''); return; }
    if (!availableTopics.includes(trimmed)) {
      setAvailableTopics(prev => [...prev, trimmed]);
    }
    const prev = selectedTopicsRef.current;
    if (!prev.includes(trimmed)) updateTopics([...prev, trimmed]);
    setCustomTopic('');
    setAddingTopic(false);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const statusBar = <StatusBar barStyle="light-content" backgroundColor={COLORS.sessionBg} />;

  if (!loaded || status === 'completed' || status === 'cancelled') {
    return <View style={{ flex: 1, backgroundColor: COLORS.sessionBg }}>{statusBar}</View>;
  }

  if (!row) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.sessionBg }} edges={['top', 'bottom']}>
        {statusBar}
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <TouchableOpacity onPress={minimise} hitSlop={SLOP} style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.paper }}>← BACK</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Text style={{ fontFamily: F.serif, fontSize: 22, color: COLORS.paper, marginBottom: 8 }}>Lesson not found</Text>
          <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.paper60, textAlign: 'center' }}>
            It may have been removed. Go back and pick it again.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Pre-start view for scheduled lessons
  if (status === 'scheduled') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.sessionBg }} edges={['top', 'bottom']}>
        {statusBar}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 }}>
            <TouchableOpacity onPress={minimise} hitSlop={SLOP} style={{ minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, justifyContent: 'center' }}>
              <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.paper, letterSpacing: 0.5 }}>← BACK</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleCancelScheduled} hitSlop={SLOP} style={{ minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, justifyContent: 'center', alignItems: 'flex-end' }}>
              <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.crimson, letterSpacing: 0.5 }}>CANCEL LESSON</Text>
            </TouchableOpacity>
          </View>

          <View style={{ alignItems: 'center', paddingTop: 24, paddingBottom: 12, paddingHorizontal: 24 }}>
            <Text style={{ fontFamily: F.serif, fontSize: 26, color: COLORS.paper }}>{student?.full_name ?? ''}</Text>
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.paper60, letterSpacing: 1, marginTop: 6 }}>
              {student ? `GR ${student.grade} ${(lessonSubject ?? student.subject).toUpperCase()}` : ''}
            </Text>
          </View>

          <View style={{ marginHorizontal: 24, borderWidth: 1, borderColor: COLORS.paper20, borderRadius: 16, padding: 20, marginBottom: 32 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.paper60, letterSpacing: 1.5, marginBottom: 16 }}>SCHEDULED LESSON</Text>
            <View style={{ gap: 10 }}>
              {row.scheduled_for && (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.paper60, width: 72 }}>WHEN</Text>
                  <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.paper, flex: 1 }}>{formatScheduledTime(row.scheduled_for)}</Text>
                </View>
              )}
              {row.estimated_duration_minutes ? (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.paper60, width: 72 }}>LENGTH</Text>
                  <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.paper }}>{formatHours(row.estimated_duration_minutes / 60)}</Text>
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.paper60, width: 72 }}>MODE</Text>
                <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.paper }}>{mode === 'in_person' ? '📍 In-person' : '💻 Online'}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.paper60, width: 72 }}>CREDIT</Text>
                <Text style={{ fontFamily: F.mono, fontSize: 12, color: balance < 0 ? COLORS.crimson : COLORS.paper }}>
                  {balance < 0 ? `OWES ${formatHours(-balance)}` : formatHours(balance)}
                </Text>
              </View>
              {selectedTopics.length > 0 && (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.paper60, width: 72 }}>TOPICS</Text>
                  <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.paper, flex: 1 }}>{selectedTopics.join(', ')}</Text>
                </View>
              )}
            </View>
          </View>

          <View style={{ paddingHorizontal: 24, gap: 12 }}>
            <TouchableOpacity
              onPress={handleStart}
              style={{ backgroundColor: COLORS.oxblood, borderRadius: 16, minHeight: 56, alignItems: 'center', justifyContent: 'center' }}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.paper }}>▶ Start lesson</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleReschedule}
              style={{ borderWidth: 1, borderColor: COLORS.paper40, borderRadius: 16, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
              activeOpacity={0.75}
              accessibilityRole="button"
            >
              <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.paper }}>↺ Reschedule</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Active / paused timer view
  const parts = formatDuration(elapsedSeconds).split(':');
  const remaining = remainingInfo({
    elapsedSeconds,
    bookedMinutes: row.estimated_duration_minutes,
    balanceHours: balance,
  });
  const remainingColour =
    remaining.tone === 'crimson' ? COLORS.crimson : remaining.tone === 'amber' ? COLORS.amber : COLORS.paper60;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: COLORS.sessionBg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {statusBar}
      {/* Bottom edge too: under edge-to-edge the scroll content otherwise ends behind the nav bar. */}
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {/* Top bar: minimise · mode · menu */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingHorizontal: 12,
            paddingTop: 4,
            paddingBottom: 4,
          }}
        >
          <TouchableOpacity
            onPress={minimise}
            hitSlop={SLOP}
            accessibilityRole="button"
            accessibilityLabel="Minimise — the lesson keeps running"
            style={{ minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 }}
          >
            <Feather name="chevron-down" size={20} color={COLORS.paper} />
            <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.paper, letterSpacing: 0.5 }}>MINIMISE</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity
              onPress={toggleMode}
              hitSlop={SLOP}
              accessibilityRole="button"
              accessibilityLabel={`Mode: ${mode === 'in_person' ? 'in-person' : 'online'}. Tap to switch.`}
              style={{ minHeight: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: 8 }}
            >
              <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.paper }}>
                {mode === 'in_person' ? '📍 IN-PERSON' : '💻 ONLINE'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setMenuOpen(true)}
              hitSlop={SLOP}
              accessibilityRole="button"
              accessibilityLabel="Lesson options"
              style={{ minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}
            >
              <Feather name="more-vertical" size={20} color={COLORS.paper} />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Student name + lesson label */}
          <View style={{ alignItems: 'center', paddingTop: compact ? 4 : 12, paddingBottom: compact ? 14 : 28 }}>
            <Text style={{ fontFamily: F.serif, fontSize: 26, color: COLORS.paper }}>
              {student?.full_name ?? ''}
            </Text>
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.paper60, letterSpacing: 1, marginTop: 6 }}>
              {student ? `GR ${student.grade} ${(lessonSubject ?? student.subject).toUpperCase()} · LESSON ${sessionCount}` : ''}
            </Text>
          </View>

          {/* Timer circle */}
          <View style={{ alignItems: 'center', marginBottom: compact ? 18 : 36 }}>
            <View
              style={{
                width: dial,
                height: dial,
                borderRadius: dial / 2,
                borderWidth: 1,
                borderColor: remaining.tone === 'normal' ? COLORS.paper20 : remainingColour,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: 12,
                  left: 12,
                  right: 12,
                  bottom: 12,
                  borderRadius: dial / 2 - 12,
                  borderWidth: 0.5,
                  borderColor: COLORS.paper12,
                }}
              />
              <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.paper60, letterSpacing: 2, marginBottom: 8 }}>
                {isPaused ? 'PAUSED' : 'ELAPSED'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', opacity: isPaused ? 0.6 : 1 }}>
                <Text style={{ fontFamily: F.mono, fontSize: digits, color: COLORS.paper, includeFontPadding: false }}>
                  {parts[0]}:{parts[1]}:
                </Text>
                <Text style={{ fontFamily: F.mono, fontSize: digits, color: COLORS.oxblood, includeFontPadding: false }}>
                  {parts[2]}
                </Text>
              </View>
              <Text
                accessibilityLiveRegion="polite"
                style={{ fontFamily: F.monoMed, fontSize: 12, color: remainingColour, letterSpacing: 1, marginTop: 10 }}
              >
                {isPaused ? '▮▮ ' : '· '}
                {remaining.label}
              </Text>
              <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.paper40, letterSpacing: 1, marginTop: 4 }}>
                {remaining.caption}
              </Text>
            </View>
          </View>

          {/* Topics section */}
          <View style={{ paddingHorizontal: 24 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.paper60, letterSpacing: 1.5, marginBottom: compact ? 8 : 12 }}>
              TOPICS COVERED
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {availableTopics.map(topic => (
                <TopicChip
                  key={topic}
                  label={topic}
                  selected={selectedTopics.includes(topic)}
                  onPress={() => toggleTopic(topic)}
                  dark={true}
                />
              ))}
              {addingTopic ? (
                <TextInput
                  autoFocus
                  value={customTopic}
                  onChangeText={setCustomTopic}
                  onSubmitEditing={submitCustomTopic}
                  onBlur={submitCustomTopic}
                  placeholder="Topic name…"
                  placeholderTextColor={COLORS.paper40}
                  returnKeyType="done"
                  style={{
                    fontFamily: F.sans,
                    fontSize: 13,
                    color: COLORS.paper,
                    borderWidth: 1,
                    borderColor: COLORS.paper40,
                    borderRadius: 999,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    minWidth: 120,
                  }}
                />
              ) : (
                <TouchableOpacity
                  onPress={() => setAddingTopic(true)}
                  hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  style={{
                    borderWidth: 1,
                    borderColor: COLORS.paper40,
                    borderStyle: 'dashed',
                    borderRadius: 999,
                    paddingHorizontal: 12,
                    minHeight: 36,
                    justifyContent: 'center',
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.paper60 }}>+ add</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </ScrollView>

        {/* Controls pinned below the scroll area: always visible, even at 640dp. */}
        <View style={{ paddingTop: compact ? 8 : 12, paddingBottom: compact ? 4 : 8, borderTopWidth: 1, borderTopColor: COLORS.paper12 }}>
          <View style={{ flexDirection: 'row', paddingHorizontal: 24, gap: 12 }}>
            <TouchableOpacity
              onPress={togglePause}
              accessibilityRole="button"
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: COLORS.paper40,
                borderRadius: 16,
                minHeight: 56,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              activeOpacity={0.8}
            >
              <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.paper }}>
                {isPaused ? '▶ Resume' : '▮▮ Pause'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleEndSession}
              accessibilityRole="button"
              style={{
                flex: 2,
                backgroundColor: COLORS.oxblood,
                borderRadius: 16,
                minHeight: 56,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              activeOpacity={0.8}
            >
              <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.paper }}>End lesson ▸</Text>
            </TouchableOpacity>
          </View>
          <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.paper40, textAlign: 'center', marginTop: compact ? 6 : 10, paddingHorizontal: 24 }}>
            Minimise keeps the lesson running in the background.
          </Text>
        </View>
      </SafeAreaView>

      <ActionSheet
        visible={menuOpen}
        onDismiss={() => setMenuOpen(false)}
        theme="dark"
        items={[
          {
            label: 'Minimise (keeps running)',
            icon: 'chevron-down',
            onPress: () => {
              setMenuOpen(false);
              minimise();
            },
          },
          {
            label: 'Discard lesson…',
            icon: 'trash-2',
            destructive: true,
            onPress: () => {
              setMenuOpen(false);
              // Let the sheet close before the system alert appears.
              setTimeout(confirmDiscard, 250);
            },
          },
        ]}
      />
    </KeyboardAvoidingView>
  );
}
