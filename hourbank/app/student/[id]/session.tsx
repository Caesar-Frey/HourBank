import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getDb } from '../../../src/db/client';
import { getStudent } from '../../../src/db/students';
import { currentBalance } from '../../../src/db/ledger';
import { DEFAULT_TOPICS } from '../../../src/config';
import { TopicChip } from '../../../src/components/TopicChip';
import { F } from '../../../src/theme/fonts';
import { formatDuration, formatHours } from '../../../src/utils/format';
import { useActiveSession } from '../../../src/hooks/useActiveSession';
import { Student } from '../../../src/db/schema';

const PAPER = '#F4EFE6';
const OXBLOOD = '#7A2530';
const BG = '#1B1714';
const PAPER_40 = 'rgba(244,239,230,0.4)';
const PAPER_20 = 'rgba(244,239,230,0.2)';
const PAPER_12 = 'rgba(244,239,230,0.12)';
const PAPER_60 = 'rgba(244,239,230,0.6)';

export default function SessionScreen() {
  const { id, sessionId } = useLocalSearchParams<{ id: string; sessionId: string }>();
  const router = useRouter();

  const [mode, setMode] = useState<'in_person' | 'online'>('in_person');
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [addingTopic, setAddingTopic] = useState(false);
  const [customTopic, setCustomTopic] = useState('');
  const [student, setStudent] = useState<Student | null>(null);
  const [balance, setBalance] = useState(0);
  const [sessionCount, setSessionCount] = useState(1);
  const [availableTopics, setAvailableTopics] = useState<string[]>([]);

  // Load student, balance, session count, and initial topics on mount
  useEffect(() => {
    try {
      const s = getStudent(id);
      if (!s) return;
      setStudent(s);

      const bal = currentBalance(id);
      setBalance(bal);

      // Session count (completed + pending, +1 for current)
      const db = getDb();
      const row = db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM sessions WHERE student_id = ? AND status IN ('verified','pending_verification')`,
        [id]
      );
      setSessionCount((row?.count ?? 0) + 1);

      // Available topics from DEFAULT_TOPICS for this subject
      const topics = DEFAULT_TOPICS[s.subject] ?? [];
      setAvailableTopics(topics);

      // Load pre-selected topics and mode from the session record
      const sessionRow = db.getFirstSync<{ topics: string; mode: string }>(
        'SELECT topics, mode FROM sessions WHERE id = ?',
        [sessionId]
      );
      if (sessionRow) {
        try {
          const prePicked: string[] = JSON.parse(sessionRow.topics);
          if (Array.isArray(prePicked) && prePicked.length > 0) {
            setSelectedTopics(prePicked);
            // Merge any pre-picked topics not in the default list
            setAvailableTopics(prev => {
              const extras = prePicked.filter(t => !prev.includes(t));
              return extras.length > 0 ? [...prev, ...extras] : prev;
            });
          }
        } catch {
          // ignore malformed JSON
        }
        if (sessionRow.mode === 'online' || sessionRow.mode === 'in_person') {
          setMode(sessionRow.mode as 'in_person' | 'online');
        }
      }
    } catch (e) {
      console.error('SessionScreen mount error', e);
    }
  }, [id, sessionId]);

  const { elapsedSeconds, isPaused, pause, resume, remainingHours, totalPausedSeconds } =
    useActiveSession(sessionId, balance);

  const handleCancel = () => {
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
          router.back();
        },
      },
    ]);
  };

  const handleEndSession = () => {
    if (selectedTopics.length < 1) {
      Alert.alert('Select a topic', 'Select at least one topic before ending the session.');
      return;
    }
    const topicsParam = encodeURIComponent(JSON.stringify(selectedTopics));
    router.push(
      `/student/${id}/end-session?sessionId=${sessionId}&elapsedSeconds=${elapsedSeconds}&pausedSeconds=${totalPausedSeconds}&mode=${mode}&topics=${topicsParam}`
    );
  };

  const toggleTopic = (topic: string) => {
    setSelectedTopics(prev =>
      prev.includes(topic) ? prev.filter(t => t !== topic) : [...prev, topic]
    );
  };

  const submitCustomTopic = () => {
    const trimmed = customTopic.trim();
    if (!trimmed) {
      setAddingTopic(false);
      setCustomTopic('');
      return;
    }
    if (!availableTopics.includes(trimmed)) {
      setAvailableTopics(prev => [...prev, trimmed]);
    }
    setSelectedTopics(prev => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setCustomTopic('');
    setAddingTopic(false);
  };

  const parts = formatDuration(elapsedSeconds).split(':');

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: BG }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="light-content" />
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
            paddingTop: 60,
            paddingBottom: 8,
          }}
        >
          <TouchableOpacity
            onPress={handleCancel}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={{ fontFamily: F.mono, fontSize: 13, color: PAPER, letterSpacing: 0.5 }}>
              × CANCEL
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setMode(m => (m === 'in_person' ? 'online' : 'in_person'))}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={{ fontFamily: F.mono, fontSize: 12, color: PAPER }}>
              {mode === 'in_person' ? '📍 IN-PERSON' : '💻 ONLINE'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Student name + session label */}
        <View style={{ alignItems: 'center', paddingTop: 16, paddingBottom: 28 }}>
          <Text style={{ fontFamily: F.serif, fontSize: 26, color: PAPER }}>
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
            {/* Inner ring */}
            <View
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
              pointerEvents="none"
            />

            {/* ELAPSED label */}
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

            {/* Timer digits: HH:MM in paper, :SS in oxblood */}
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text
                style={{
                  fontFamily: F.mono,
                  fontSize: 40,
                  color: PAPER,
                  includeFontPadding: false,
                }}
              >
                {parts[0]}:{parts[1]}:
              </Text>
              <Text
                style={{
                  fontFamily: F.mono,
                  fontSize: 40,
                  color: OXBLOOD,
                  includeFontPadding: false,
                }}
              >
                {parts[2]}
              </Text>
            </View>

            {/* LIVE / PAUSED indicator */}
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

            {/* + add chip */}
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
                  color: PAPER,
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
          {/* Pause / Resume */}
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
            <Text style={{ fontFamily: F.mono, fontSize: 14, color: PAPER }}>
              {isPaused ? '▶ Resume' : '▮▮ Pause'}
            </Text>
          </TouchableOpacity>

          {/* End Session */}
          <TouchableOpacity
            onPress={handleEndSession}
            style={{
              flex: 2,
              backgroundColor: OXBLOOD,
              borderRadius: 16,
              paddingVertical: 16,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            activeOpacity={0.8}
          >
            <Text style={{ fontFamily: F.mono, fontSize: 14, color: PAPER }}>
              End Session ▸
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
