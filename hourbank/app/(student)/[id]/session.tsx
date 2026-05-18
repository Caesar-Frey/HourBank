import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { COLORS } from '../../../src/theme/colors';
import { useDarkTabBar } from '../../../src/hooks/useDarkTabBar';
import { getDb } from '../../../src/db/client';
import { getStudent } from '../../../src/db/students';
import { currentBalance } from '../../../src/db/ledger';
import { startSession, cancelSession } from '../../../src/db/sessions';
import { listTopicsForStudentSubject } from '../../../src/db/catalog';
import { TopicChip } from '../../../src/components/TopicChip';
import { F } from '../../../src/theme/fonts';
import { formatDuration, formatHours, formatScheduledTime } from '../../../src/utils/format';
import { Session, Student } from '../../../src/db/schema';
import { useSessionTimer } from '../../../src/contexts/SessionTimerContext';

const PAPER_40 = 'rgba(244,239,230,0.4)';
const PAPER_20 = 'rgba(244,239,230,0.2)';
const PAPER_12 = 'rgba(244,239,230,0.12)';
const PAPER_60 = 'rgba(244,239,230,0.6)';

export default function SessionScreen() {
  const { id, sessionId } = useLocalSearchParams<{ id: string; sessionId: string }>();
  const router = useRouter();

  const [sessionStatus, setSessionStatus] = useState<Session['status'] | null>(null);
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | null>(null);
  const [mode, setMode] = useState<'in_person' | 'online'>('in_person');
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [addingTopic, setAddingTopic] = useState(false);
  const [customTopic, setCustomTopic] = useState('');
  const [student, setStudent] = useState<Student | null>(null);
  const [balance, setBalance] = useState(0);
  const [sessionCount, setSessionCount] = useState(1);
  const [availableTopics, setAvailableTopics] = useState<string[]>([]);

  useEffect(() => {
    try {
      const s = getStudent(id);
      if (!s) return;
      setStudent(s);
      setBalance(currentBalance(id));

      const db = getDb();
      const row = db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM sessions WHERE student_id = ? AND status = 'completed'`,
        [id]
      );
      setSessionCount((row?.count ?? 0) + 1);

      const allTopics = listTopicsForStudentSubject(s.subject).map(t => t.name);
      setAvailableTopics(allTopics);

      const sessionRow = db.getFirstSync<{
        topics: string;
        mode: string;
        status: Session['status'];
        scheduled_for: string | null;
        estimated_duration_minutes: number | null;
      }>(
        'SELECT topics, mode, status, scheduled_for, estimated_duration_minutes FROM sessions WHERE id = ?',
        [sessionId]
      );
      if (sessionRow) {
        setSessionStatus(sessionRow.status);
        setScheduledFor(sessionRow.scheduled_for);
        setEstimatedMinutes(sessionRow.estimated_duration_minutes);
        if (sessionRow.mode === 'online' || sessionRow.mode === 'in_person') {
          setMode(sessionRow.mode as 'in_person' | 'online');
        }
        try {
          const prePicked: string[] = JSON.parse(sessionRow.topics);
          if (Array.isArray(prePicked) && prePicked.length > 0) {
            setSelectedTopics(prePicked);
            setAvailableTopics(prev => {
              const extras = prePicked.filter(t => !prev.includes(t));
              return extras.length > 0 ? [...prev, ...extras] : prev;
            });
          }
        } catch { /* ignore */ }
      }
    } catch (e) {
      console.error('SessionScreen mount error', e);
    }
  }, [id, sessionId]);

  const {
    status: timerStatus,
    sessionId: timerSessionId,
    elapsedSeconds,
    startTimer,
    pauseTimer,
    resumeTimer,
    endTimer,
  } = useSessionTimer();

  useDarkTabBar();

  useEffect(() => {
    if (sessionStatus === 'active') {
      activateKeepAwakeAsync();
    } else {
      deactivateKeepAwake();
    }
    return () => { deactivateKeepAwake(); };
  }, [sessionStatus]);

  const isPaused = timerStatus === 'paused' && timerSessionId === sessionId;
  const elapsedHours = elapsedSeconds / 3600;
  const remainingHours = Math.max(0, balance - elapsedHours);

  function pause() {
    pauseTimer();
  }

  function resume() {
    resumeTimer();
  }

  function handleStartSession() {
    try {
      const session = startSession(sessionId);
      setSessionStatus('active');
      startTimer(sessionId, id, session.started_at!, 0);
    } catch (e) {
      Alert.alert('Error', 'Could not start session. Please try again.');
    }
  }

  function handleCancelScheduled() {
    Alert.alert(
      'Cancel session?',
      'The scheduled session will be removed.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel session',
          style: 'destructive',
          onPress: () => {
            try {
              cancelSession(sessionId);
            } catch (e) {
              console.error(e);
            }
            router.back();
          },
        },
      ]
    );
  }

  function handleReschedule() {
    router.replace(`/student/${id}/schedule?sessionId=${sessionId}`);
  }

  function handleCancelActive() {
    Alert.alert('Cancel session?', 'This session will be discarded.', [
      { text: 'Keep going', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          try {
            const db = getDb();
            db.runSync(
              `UPDATE sessions SET status = 'cancelled' WHERE id = ? AND status = 'active'`,
              [sessionId]
            );
          } catch (e) {
            console.error(e);
          }
          endTimer();
          router.back();
        },
      },
    ]);
  }

  function handleEndSession() {
    if (selectedTopics.length < 1) {
      Alert.alert('Select a topic', 'Select at least one topic before ending the session.');
      return;
    }
    // Read paused_seconds from DB (the authoritative source)
    let pausedSeconds = 0;
    try {
      const db = getDb();
      const row = db.getFirstSync<{ paused_seconds: number }>(
        'SELECT paused_seconds FROM sessions WHERE id = ?',
        [sessionId],
      );
      pausedSeconds = row?.paused_seconds ?? 0;
    } catch (e) {
      console.error('handleEndSession paused_seconds read error', e);
    }
    const topicsParam = encodeURIComponent(JSON.stringify(selectedTopics));
    endTimer();
    router.push(
      `/student/${id}/end-session?sessionId=${sessionId}&elapsedSeconds=${elapsedSeconds}&pausedSeconds=${pausedSeconds}&mode=${mode}&topics=${topicsParam}`
    );
  }

  function toggleTopic(topic: string) {
    setSelectedTopics(prev =>
      prev.includes(topic) ? prev.filter(t => t !== topic) : [...prev, topic]
    );
  }

  function submitCustomTopic() {
    const trimmed = customTopic.trim();
    if (!trimmed) { setAddingTopic(false); setCustomTopic(''); return; }
    if (!availableTopics.includes(trimmed)) {
      setAvailableTopics(prev => [...prev, trimmed]);
    }
    setSelectedTopics(prev => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setCustomTopic('');
    setAddingTopic(false);
  }

  // Loading state
  if (sessionStatus === null) {
    return <View style={{ flex: 1, backgroundColor: COLORS.sessionBg }} />;
  }

  // Pre-start view for scheduled sessions
  if (sessionStatus === 'scheduled') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.sessionBg }} edges={['top']}>
        <View style={{ flex: 1 }}>
          {/* Top bar */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 }}>
            <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.paper, letterSpacing: 0.5 }}>← BACK</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleCancelScheduled} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.crimson, letterSpacing: 0.5 }}>CANCEL</Text>
            </TouchableOpacity>
          </View>

          {/* Student name */}
          <View style={{ alignItems: 'center', paddingTop: 24, paddingBottom: 12, paddingHorizontal: 24 }}>
            <Text style={{ fontFamily: F.serif, fontSize: 26, color: COLORS.paper }}>{student?.full_name ?? ''}</Text>
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: PAPER_60, letterSpacing: 1, marginTop: 6 }}>
              {student ? `GR ${student.grade} ${student.subject.toUpperCase()}` : ''}
            </Text>
          </View>

          {/* Session details card */}
          <View style={{ marginHorizontal: 24, borderWidth: 1, borderColor: PAPER_20, borderRadius: 16, padding: 20, marginBottom: 32 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 10, color: PAPER_60, letterSpacing: 1.5, marginBottom: 16 }}>SCHEDULED SESSION</Text>
            <View style={{ gap: 10 }}>
              {scheduledFor && (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={{ fontFamily: F.mono, fontSize: 12, color: PAPER_60, width: 64 }}>WHEN</Text>
                  <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.paper, flex: 1 }}>{formatScheduledTime(scheduledFor)}</Text>
                </View>
              )}
              {estimatedMinutes && (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={{ fontFamily: F.mono, fontSize: 12, color: PAPER_60, width: 64 }}>DURATION</Text>
                  <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.paper }}>{formatHours(estimatedMinutes / 60)}</Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Text style={{ fontFamily: F.mono, fontSize: 12, color: PAPER_60, width: 64 }}>MODE</Text>
                <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.paper }}>{mode === 'in_person' ? '📍 In-Person' : '💻 Online'}</Text>
              </View>
              {selectedTopics.length > 0 && (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={{ fontFamily: F.mono, fontSize: 12, color: PAPER_60, width: 64 }}>TOPICS</Text>
                  <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.paper, flex: 1 }}>{selectedTopics.join(', ')}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Action buttons */}
          <View style={{ paddingHorizontal: 24, gap: 12 }}>
            <TouchableOpacity
              onPress={handleStartSession}
              style={{ backgroundColor: COLORS.oxblood, borderRadius: 16, paddingVertical: 18, alignItems: 'center' }}
              activeOpacity={0.85}
            >
              <Text style={{ fontFamily: F.mono, fontSize: 15, color: COLORS.paper }}>▶ Start session</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleReschedule}
              style={{ borderWidth: 1, borderColor: PAPER_40, borderRadius: 16, paddingVertical: 14, alignItems: 'center' }}
              activeOpacity={0.75}
            >
              <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.paper }}>↺ Reschedule</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Active timer view
  const parts = formatDuration(elapsedSeconds).split(':');

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: COLORS.sessionBg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Top bar: cancel + mode toggle */}
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingHorizontal: 24,
              paddingTop: 16,
              paddingBottom: 8,
            }}
          >
            <TouchableOpacity
              onPress={handleCancelActive}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.paper, letterSpacing: 0.5 }}>
                × CANCEL
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setMode(m => (m === 'in_person' ? 'online' : 'in_person'))}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.paper }}>
                {mode === 'in_person' ? '📍 IN-PERSON' : '💻 ONLINE'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Student name + session label */}
          <View style={{ alignItems: 'center', paddingTop: 16, paddingBottom: 28 }}>
            <Text style={{ fontFamily: F.serif, fontSize: 26, color: COLORS.paper }}>
              {student?.full_name ?? ''}
            </Text>
            <Text
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                color: PAPER_60,
                letterSpacing: 1,
                marginTop: 6,
              }}
            >
              {student
                ? `GR ${student.grade} ${student.subject.toUpperCase()} · SESSION ${sessionCount}`
                : ''}
            </Text>
          </View>

          {/* Timer circle */}
          <View style={{ alignItems: 'center', marginBottom: 36 }}>
            <View
              style={{
                width: 220,
                height: 220,
                borderRadius: 110,
                borderWidth: 1,
                borderColor: PAPER_20,
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
                  borderRadius: 98,
                  borderWidth: 0.5,
                  borderColor: PAPER_12,
                }}
              />
              <Text
                style={{
                  fontFamily: F.mono,
                  fontSize: 10,
                  color: PAPER_60,
                  letterSpacing: 2,
                  marginBottom: 8,
                }}
              >
                ELAPSED
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <Text
                  style={{
                    fontFamily: F.mono,
                    fontSize: 40,
                    color: COLORS.paper,
                    includeFontPadding: false,
                  }}
                >
                  {parts[0]}:{parts[1]}:
                </Text>
                <Text
                  style={{
                    fontFamily: F.mono,
                    fontSize: 40,
                    color: COLORS.oxblood,
                    includeFontPadding: false,
                  }}
                >
                  {parts[2]}
                </Text>
              </View>
              <Text
                style={{
                  fontFamily: F.mono,
                  fontSize: 11,
                  color: PAPER_60,
                  letterSpacing: 1,
                  marginTop: 10,
                }}
              >
                {isPaused
                  ? '⏸ PAUSED'
                  : `· LIVE · ${formatHours(remainingHours).toUpperCase()} REMAINING`}
              </Text>
            </View>
          </View>

          {/* Topics section */}
          <View style={{ paddingHorizontal: 24, marginBottom: 32 }}>
            <Text
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                color: PAPER_60,
                letterSpacing: 1.5,
                marginBottom: 12,
              }}
            >
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
                  placeholderTextColor={PAPER_40}
                  returnKeyType="done"
                  style={{
                    fontFamily: F.sans,
                    fontSize: 13,
                    color: COLORS.paper,
                    borderWidth: 1,
                    borderColor: PAPER_40,
                    borderRadius: 999,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    minWidth: 120,
                  }}
                />
              ) : (
                <TouchableOpacity
                  onPress={() => setAddingTopic(true)}
                  style={{
                    borderWidth: 1,
                    borderColor: PAPER_40,
                    borderStyle: 'dashed',
                    borderRadius: 999,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={{ fontFamily: F.sans, fontSize: 13, color: PAPER_60 }}>+ add</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Action buttons */}
          <View style={{ flexDirection: 'row', paddingHorizontal: 24, gap: 12 }}>
            <TouchableOpacity
              onPress={isPaused ? resume : pause}
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: PAPER_40,
                borderRadius: 16,
                paddingVertical: 16,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              activeOpacity={0.8}
            >
              <Text style={{ fontFamily: F.mono, fontSize: 14, color: COLORS.paper }}>
                {isPaused ? '▶ Resume' : '▮▮ Pause'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleEndSession}
              style={{
                flex: 2,
                backgroundColor: COLORS.oxblood,
                borderRadius: 16,
                paddingVertical: 16,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              activeOpacity={0.8}
            >
              <Text style={{ fontFamily: F.mono, fontSize: 14, color: COLORS.paper }}>
                End Session ▸
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
