import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getDb } from '../../../src/db/client';
import { getStudent } from '../../../src/db/students';
import { currentBalance as fetchBalance } from '../../../src/db/ledger';
import { endSession, getSession } from '../../../src/db/sessions';
import { TopicChip } from '../../../src/components/TopicChip';
import { ScreenHeader } from '../../../src/components/ScreenHeader';
import { F } from '../../../src/theme/fonts';
import { COLORS } from '../../../src/theme/colors';
import { formatHours } from '../../../src/utils/format';
import { balanceStatus, balanceColour } from '../../../src/utils/balance';
import { roundToBilledMinutes } from '../../../src/utils/duration';
import { listTopicsForStudentSubject } from '../../../src/db/catalog';
import { Student } from '../../../src/db/schema';

const PAPER = COLORS.paper;
const OXBLOOD = COLORS.oxblood;
const INK = COLORS.ink;
const INK_FAINT = COLORS.inkFaint;
const PAPER_EDGE = COLORS.paperEdge;
const CRIMSON = COLORS.crimson;
const INK_40 = 'rgba(27,23,20,0.4)';

export default function EndSessionScreen() {
  const { id, sessionId, elapsedSeconds, pausedSeconds, mode, topics } =
    useLocalSearchParams<{
      id: string;
      sessionId: string;
      elapsedSeconds: string;
      pausedSeconds: string;
      mode: string;
      topics: string;
    }>();
  const router = useRouter();

  const session = getSession(sessionId as string);
  const postSaveDestination = session?.scheduled_for ? `/student/${id as string}` : '/sessions';

  const elapsed = parseInt(elapsedSeconds as string, 10) || 0;
  const paused = parseInt(pausedSeconds as string, 10) || 0;
  const parsedTopics: string[] = (() => {
    try {
      return JSON.parse(decodeURIComponent((topics as string) || '[]'));
    } catch {
      return [];
    }
  })();
  const durationMinutes = elapsed / 60;

  const [student, setStudent] = useState<Student | null>(null);
  const [bal, setBal] = useState(0);
  const [selectedTopics, setSelectedTopics] = useState<string[]>(parsedTopics);
  const [availableTopics, setAvailableTopics] = useState<string[]>([]);
  const [addingTopic, setAddingTopic] = useState(false);
  const [customTopic, setCustomTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [topicError, setTopicError] = useState(false);
  const [billedMinutes, setBilledMinutes] = useState(() => roundToBilledMinutes(elapsed));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    try {
      const s = getStudent(id as string);
      if (s) {
        setStudent(s);
        const allTopics = listTopicsForStudentSubject(s.subject).map(t => t.name);
        // Merge pre-selected custom topics not in the subject list
        const extras = parsedTopics.filter(t => !allTopics.includes(t));
        setAvailableTopics([...allTopics, ...extras]);
      }
      setBal(fetchBalance(id as string));
    } catch (e) {
      console.error(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const balanceAfter = bal - billedMinutes / 60;
  const bColour = balanceColour(balanceStatus(balanceAfter));
  const firstName = student?.full_name?.trim().split(/\s+/)[0] ?? 'Student';

  const dateDisplay = new Date().toLocaleDateString('en-ZA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const modeDisplay = (mode as string) === 'online' ? 'Online' : 'In-Person';

  const toggleTopic = (topic: string) => {
    setTopicError(false);
    setSelectedTopics(prev =>
      prev.includes(topic) ? prev.filter(t => t !== topic) : [...prev, topic]
    );
  };

  const submitCustomTopic = () => {
    const trimmed = customTopic.trim();
    if (trimmed) {
      setSelectedTopics(prev => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
      setAvailableTopics(prev => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    }
    setCustomTopic('');
    setAddingTopic(false);
  };

  const handleBack = () => {
    Alert.alert(
      'Go back to the timer?',
      "Your notes won't be lost.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Yes, go back', onPress: () => router.back() },
      ]
    );
  };

  const handleSaveDraft = () => {
    try {
      const db = getDb();
      db.runSync(
        `UPDATE sessions SET session_notes = ?, topics = ? WHERE id = ? AND (status = 'active' OR status = 'paused')`,
        [notes.trim() || null, JSON.stringify(selectedTopics), sessionId as string]
      );
    } catch (e) {
      console.error('Save draft error', e);
    }
    router.replace(postSaveDestination);
  };

  const actualDurationMinutes = elapsed / 60;
  const isOverbilling = billedMinutes > actualDurationMinutes;
  const isZeroBilling = billedMinutes === 0;

  const proceedZeroOrSave = () => {
    if (isZeroBilling) {
      Alert.alert(
        'Zero charge?',
        "You're about to record this session with 0 credits deducted. Continue?",
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Save anyway', onPress: () => doSave() },
        ]
      );
      return;
    }
    doSave();
  };

  const handleSaveSession = () => {
    if (submitting) return;
    if (selectedTopics.length < 1) {
      setTopicError(true);
      return;
    }
    // Warn-but-allow: logging past zero credit shows a confirm, never a block.
    if (balanceAfter < 0) {
      Alert.alert(
        '⚠ Negative balance',
        `${firstName} has ${formatHours(bal)} left. This will put them at OWES ${formatHours(Math.abs(balanceAfter))}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Log anyway', onPress: proceedZeroOrSave },
        ]
      );
      return;
    }
    proceedZeroOrSave();
  };

  const doSave = () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const endedAt = new Date().toISOString();
      endSession({
        sessionId: sessionId as string,
        endedAt,
        durationMinutes: actualDurationMinutes,
        billedMinutes,
        pausedSeconds: paused,
        topics: selectedTopics,
        sessionNotes: notes.trim(),
      });

      Alert.alert('Session saved.', '', [
        {
          text: 'OK',
          onPress: () => router.replace(postSaveDestination),
        },
      ]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  };

  const rows: {
    label: string;
    value: string;
    valueFamily: string;
    valueColour: string;
  }[] = [
    {
      label: 'STUDENT',
      value: student?.full_name ?? '—',
      valueFamily: F.sansMed,
      valueColour: INK,
    },
    {
      label: 'DATE',
      value: dateDisplay,
      valueFamily: F.sans,
      valueColour: INK,
    },
    {
      label: 'GRADE',
      value: student ? `Gr ${student.grade} · ${student.curriculum}` : '—',
      valueFamily: F.sans,
      valueColour: INK,
    },
    {
      label: 'SUBJECT',
      value: student?.subject ?? '—',
      valueFamily: F.sans,
      valueColour: INK,
    },
    {
      label: 'MODE',
      value: modeDisplay,
      valueFamily: F.sans,
      valueColour: INK,
    },
    {
      label: 'BALANCE AFTER',
      value: balanceAfter < 0
        ? `OWES ${formatHours(Math.abs(balanceAfter))}`
        : `${formatHours(balanceAfter)} remaining`,
      valueFamily: F.monoMed,
      valueColour: bColour,
    },
  ];

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: PAPER }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="dark-content" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <ScreenHeader backLabel="BACK" onBack={handleBack} />

        {/* Title block */}
        <View style={{ paddingHorizontal: 24, paddingTop: 4, paddingBottom: 24 }}>
          <Text
            style={{
              fontFamily: F.mono,
              fontSize: 11,
              color: INK_FAINT,
              letterSpacing: 1.5,
              marginBottom: 4,
            }}
          >
            REVIEW & SIGN OFF
          </Text>
          <Text style={{ fontFamily: F.serif, fontSize: 28, color: INK }}>Session</Text>
          <Text style={{ fontFamily: F.serifItalic, fontSize: 28, color: OXBLOOD }}>
            complete.
          </Text>
        </View>

        {/* Receipt rows — before DURATION */}
        <View style={{ paddingHorizontal: 24, marginBottom: 0 }}>
          {rows.slice(0, 4).map((row, idx) => (
            <View
              key={row.label}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderBottomColor: PAPER_EDGE,
                borderTopWidth: idx === 0 ? 1 : 0,
                borderTopColor: idx === 0 ? PAPER_EDGE : undefined,
              }}
            >
              <Text style={{ fontFamily: F.mono, fontSize: 11, color: INK_FAINT, letterSpacing: 1, textTransform: 'uppercase' }}>
                {row.label}
              </Text>
              <Text style={{ fontFamily: row.valueFamily, fontSize: 14, color: row.valueColour, textAlign: 'right', flexShrink: 1, marginLeft: 16 }}>
                {row.value}
              </Text>
            </View>
          ))}
        </View>

        {/* DURATION stepper */}
        <View
          style={{
            paddingHorizontal: 24,
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderBottomColor: PAPER_EDGE,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <View>
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: INK_FAINT, letterSpacing: 1, textTransform: 'uppercase' }}>
              DURATION
            </Text>
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: INK_FAINT, marginTop: 2 }}>
              {`Actual: ${formatHours(elapsed / 3600)}`}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              onPress={() => setBilledMinutes(m => Math.max(0, m - 30))}
              style={{ paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: PAPER_EDGE, borderRadius: 8 }}
            >
              <Text style={{ fontFamily: F.mono, fontSize: 13, color: INK }}>−30m</Text>
            </TouchableOpacity>
            <Text style={{ fontFamily: F.monoMed, fontSize: 14, color: INK, minWidth: 60, textAlign: 'center' }}>
              {formatHours(billedMinutes / 60)}
            </Text>
            <TouchableOpacity
              onPress={() => setBilledMinutes(m => m + 30)}
              style={{ paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: PAPER_EDGE, borderRadius: 8 }}
            >
              <Text style={{ fontFamily: F.mono, fontSize: 13, color: INK }}>+30m</Text>
            </TouchableOpacity>
          </View>
        </View>
        {isOverbilling && (
          <View style={{ paddingHorizontal: 24, paddingTop: 6 }}>
            <Text style={{ fontFamily: F.sans, fontSize: 12, color: CRIMSON }}>
              Billing more than tracked time.
            </Text>
          </View>
        )}
        {isZeroBilling && (
          <View style={{ paddingHorizontal: 24, paddingTop: 6 }}>
            <Text style={{ fontFamily: F.sans, fontSize: 12, color: CRIMSON }}>
              Zero charge — you will be prompted to confirm.
            </Text>
          </View>
        )}

        {/* Receipt rows — after DURATION */}
        <View style={{ paddingHorizontal: 24, marginBottom: 28 }}>
          {rows.slice(4).map((row) => (
            <View
              key={row.label}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderBottomColor: PAPER_EDGE,
              }}
            >
              <Text style={{ fontFamily: F.mono, fontSize: 11, color: INK_FAINT, letterSpacing: 1, textTransform: 'uppercase' }}>
                {row.label}
              </Text>
              <Text style={{ fontFamily: row.valueFamily, fontSize: 14, color: row.valueColour, textAlign: 'right', flexShrink: 1, marginLeft: 16 }}>
                {row.value}
              </Text>
            </View>
          ))}
        </View>

        {/* Topics section */}
        <View style={{ paddingHorizontal: 24, marginBottom: 28 }}>
          <Text
            style={{
              fontFamily: F.mono,
              fontSize: 11,
              color: INK_FAINT,
              letterSpacing: 1.5,
              marginBottom: 12,
              textTransform: 'uppercase',
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
                dark={false}
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
                placeholderTextColor={INK_40}
                returnKeyType="done"
                style={{
                  fontFamily: F.sans,
                  fontSize: 13,
                  color: INK,
                  borderWidth: 1,
                  borderColor: PAPER_EDGE,
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
                  borderColor: INK_FAINT,
                  borderStyle: 'dashed',
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                }}
                activeOpacity={0.75}
              >
                <Text style={{ fontFamily: F.sans, fontSize: 13, color: INK_FAINT }}>
                  + add
                </Text>
              </TouchableOpacity>
            )}
          </View>
          {topicError && (
            <Text
              style={{
                fontFamily: F.sans,
                fontSize: 12,
                color: CRIMSON,
                marginTop: 8,
              }}
            >
              At least one topic is required.
            </Text>
          )}
        </View>

        {/* Notes section */}
        <View style={{ paddingHorizontal: 24, marginBottom: 36 }}>
          <Text
            style={{
              fontFamily: F.mono,
              fontSize: 11,
              color: INK_FAINT,
              letterSpacing: 1.5,
              marginBottom: 12,
              textTransform: 'uppercase',
            }}
          >
            NOTES
          </Text>
          <TextInput
            multiline
            value={notes}
            onChangeText={setNotes}
            placeholder="What did you cover? Any homework?"
            placeholderTextColor={INK_FAINT}
            style={{
              fontFamily: F.serifItalic,
              fontSize: 15,
              color: INK,
              borderWidth: 1,
              borderColor: PAPER_EDGE,
              borderRadius: 12,
              padding: 12,
              backgroundColor: 'rgba(255,255,255,0.4)',
              minHeight: 80,
              textAlignVertical: 'top',
            }}
          />
        </View>

        {/* Action buttons */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 24, gap: 12 }}>
          {/* Save draft — ghost button */}
          <TouchableOpacity
            onPress={handleSaveDraft}
            style={{
              flex: 1,
              borderWidth: 1,
              borderColor: INK,
              borderRadius: 16,
              paddingVertical: 14,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            activeOpacity={0.8}
          >
            <Text style={{ fontFamily: F.mono, fontSize: 14, color: INK }}>
              Save draft
            </Text>
          </TouchableOpacity>

          {/* Save session — oxblood */}
          <TouchableOpacity
            onPress={handleSaveSession}
            disabled={submitting}
            style={{
              flex: 2,
              backgroundColor: OXBLOOD,
              borderRadius: 16,
              paddingVertical: 14,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: submitting ? 0.5 : 1,
            }}
            activeOpacity={0.8}
          >
            <Text style={{ fontFamily: F.mono, fontSize: 14, color: PAPER }}>
              Save session ▸
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
