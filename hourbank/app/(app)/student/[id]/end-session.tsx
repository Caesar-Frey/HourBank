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
import { getDb } from '../../../../src/db/client';
import { getStudent } from '../../../../src/db/students';
import { currentBalance as fetchBalance } from '../../../../src/db/ledger';
import { endSession } from '../../../../src/db/sessions';
import { TopicChip } from '../../../../src/components/TopicChip';
import { ScreenHeader } from '../../../../src/components/ScreenHeader';
import { F } from '../../../../src/theme/fonts';
import { formatHours } from '../../../../src/utils/format';
import { balanceStatus, balanceColour } from '../../../../src/utils/balance';
import { sendReceipt } from '../../../../src/utils/notifications';
import { DEFAULT_TOPICS } from '../../../../src/config';
import { Student } from '../../../../src/db/schema';

const PAPER = '#F4EFE6';
const OXBLOOD = '#7A2530';
const INK = '#1B1714';
const INK_FAINT = '#8A7E72';
const PAPER_EDGE = '#E0D8CC';
const CRIMSON = '#9A2A2A';
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

  useEffect(() => {
    try {
      const s = getStudent(id as string);
      if (s) {
        setStudent(s);
        const subjectTopics = DEFAULT_TOPICS[s.subject] ?? [];
        // Merge pre-selected custom topics not in the default list
        const extras = parsedTopics.filter(t => !subjectTopics.includes(t));
        setAvailableTopics([...subjectTopics, ...extras]);
      }
      setBal(fetchBalance(id as string));
    } catch (e) {
      console.error(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const balanceAfter = bal - durationMinutes / 60;
  const bColour = balanceColour(balanceStatus(balanceAfter));

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
        `UPDATE sessions SET session_notes = ?, topics = ? WHERE id = ? AND status = 'active'`,
        [notes.trim() || null, JSON.stringify(selectedTopics), sessionId as string]
      );
    } catch (e) {
      console.error('Save draft error', e);
    }
    router.back();
  };

  const handleSaveAndSend = async () => {
    if (selectedTopics.length < 1) {
      setTopicError(true);
      return;
    }
    try {
      const endedAt = new Date().toISOString();
      endSession({
        sessionId: sessionId as string,
        endedAt,
        durationMinutes,
        pausedSeconds: paused,
        topics: selectedTopics,
        sessionNotes: notes.trim(),
      });

      await sendReceipt({
        studentName: student?.full_name ?? '',
        durationMinutes,
        topics: selectedTopics,
        notes: notes.trim(),
        balanceAfter,
      });

      Alert.alert('Session saved.', '', [
        {
          text: 'OK',
          onPress: () => router.push(`/student/${id as string}`),
        },
      ]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('Error', msg);
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
      label: 'DURATION',
      value: formatHours(elapsed / 3600),
      valueFamily: F.monoMed,
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
      value: `${formatHours(balanceAfter)} remaining`,
      valueFamily: F.monoMed,
      valueColour: bColour,
    },
  ];

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: PAPER }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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

        {/* Receipt rows */}
        <View style={{ paddingHorizontal: 24, marginBottom: 28 }}>
          {rows.map((row, idx) => (
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
              <Text
                style={{
                  fontFamily: F.mono,
                  fontSize: 11,
                  color: INK_FAINT,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                }}
              >
                {row.label}
              </Text>
              <Text
                style={{
                  fontFamily: row.valueFamily,
                  fontSize: 14,
                  color: row.valueColour,
                  textAlign: 'right',
                  flexShrink: 1,
                  marginLeft: 16,
                }}
              >
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
                  borderColor: PAPER_EDGE,
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

          {/* Save & send — oxblood */}
          <TouchableOpacity
            onPress={handleSaveAndSend}
            style={{
              flex: 2,
              backgroundColor: OXBLOOD,
              borderRadius: 16,
              paddingVertical: 14,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            activeOpacity={0.8}
          >
            <Text style={{ fontFamily: F.mono, fontSize: 14, color: PAPER }}>
              Save & send ▸
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
