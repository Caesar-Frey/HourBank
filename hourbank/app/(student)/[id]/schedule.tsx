import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LazyDateTimePicker } from '../../../src/components/LazyDateTimePicker';
import { F } from '../../../src/theme/fonts';
import { COLORS } from '../../../src/theme/colors';
import { ScreenHeader } from '../../../src/components/ScreenHeader';
import { TopicChip } from '../../../src/components/TopicChip';
import { ErrorBoundary } from '../../../src/components/ErrorBoundary';
import { getStudent } from '../../../src/db/students';
import { currentBalance } from '../../../src/db/ledger';
import { createScheduled, updateScheduled, getSession } from '../../../src/db/sessions';
import { formatHours } from '../../../src/utils/format';
import { findOverlappingCalendarItems } from '../../../src/db/calendar';
import { listTopicsForStudentSubject, addCustomTopicForSubject } from '../../../src/db/catalog';
import { Student, Session } from '../../../src/db/schema';
import { DurationStepperSheet, formatCustomDuration } from '../../../src/components/DurationStepperSheet';

const DURATIONS = [0.5, 1, 1.5, 2] as const;
const PRESET_MINUTES = new Set([30, 60, 90, 120]);
type Mode = 'in_person' | 'online';
type SessionType = Session['session_type'];

const SESSION_TYPES: { value: SessionType; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'review', label: 'Review' },
  { value: 'test_prep', label: 'Test prep' },
  { value: 'exam_prep', label: 'Exam prep' },
];

export default function ScheduleScreen() {
  return (
    <ErrorBoundary>
      <ScheduleScreenInner />
    </ErrorBoundary>
  );
}

function ScheduleScreenInner() {
  const { id, sessionId, date: dateParam } = useLocalSearchParams<{ id: string; sessionId?: string; date?: string }>();
  const isReschedule = !!sessionId;
  const router = useRouter();

  // Data
  const [student, setStudent] = useState<Student | null>(null);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  // Form state — default date is tomorrow at 15:00 (or prefilled from ?date=)
  const [date, setDate] = useState<Date>(() => {
    if (!isReschedule && dateParam) {
      const prefilled = new Date(dateParam + 'T00:00:00');
      if (!isNaN(prefilled.getTime())) {
        prefilled.setHours(15, 0, 0, 0);
        return prefilled;
      }
    }
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    d.setHours(15, 0, 0, 0);
    return d;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [duration, setDuration] = useState<number>(1);
  const [showDurationSheet, setShowDurationSheet] = useState(false);
  const [mode, setMode] = useState<Mode>('in_person');
  const [sessionType, setSessionType] = useState<SessionType>('general');
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [addingTopic, setAddingTopic] = useState(false);
  const [customTopicInput, setCustomTopicInput] = useState('');
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    try {
      const s = getStudent(id);
      setStudent(s);
      if (s) {
        setBalance(currentBalance(id));
        setTopics(listTopicsForStudentSubject(s.subject).map(t => t.name));
      }
      if (isReschedule && sessionId) {
        const existing = getSession(sessionId);
        if (existing) {
          if (existing.scheduled_for) setDate(new Date(existing.scheduled_for));
          if (existing.estimated_duration_minutes) {
            setDuration(existing.estimated_duration_minutes / 60);
          }
          setMode(existing.mode);
          setSessionType(existing.session_type);
          if (typeof existing.topics === 'string' && existing.topics !== 'null') {
            try {
              const parsed: string[] = JSON.parse(existing.topics);
              if (Array.isArray(parsed)) setSelectedTopics(parsed);
            } catch { /* ignore malformed */ }
          }
          setNotes(existing.session_notes ?? '');
        }
      }
    } catch (e) {
      console.error('Failed to load student', e);
    } finally {
      setLoading(false);
    }
  }, [id, isReschedule, sessionId]);

  // Conflict check: runs whenever date or duration changes
  useEffect(() => {
    try {
      const start = date;
      const end = new Date(start.getTime() + duration * 60 * 60 * 1000);
      const result = findOverlappingCalendarItems(start.toISOString(), end.toISOString());
      const parts: string[] = [];
      result.sessions.forEach(s => {
        // Exclude the session being rescheduled
        if (!isReschedule || s.id !== sessionId) {
          parts.push(s.studentName + ' (lesson)');
        }
      });
      result.calendarItems.forEach(c => parts.push(c.title + (c.kind === 'time_block' ? ' (block)' : '')));
      setConflictWarning(parts.length > 0 ? 'Overlaps: ' + parts.join(', ') : null);
    } catch {
      setConflictWarning(null);
    }
  }, [date, duration, isReschedule, sessionId]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.paper, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.inkFaint }}>Loading…</Text>
      </View>
    );
  }

  if (!student) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.paper, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
        <Text style={{ fontFamily: F.serif, fontSize: 24, color: COLORS.ink, marginBottom: 16 }}>
          Student not found
        </Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.inkSoft }}>← Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const projectedBalance = balance - duration;
  const firstName = student.full_name.trim().split(/\s+/)[0];

  function toggleTopic(topic: string) {
    setSelectedTopics(prev =>
      prev.includes(topic) ? prev.filter(t => t !== topic) : [...prev, topic]
    );
  }

  function submitCustomTopic() {
    const trimmed = customTopicInput.trim();
    setAddingTopic(false);
    setCustomTopicInput('');
    if (!trimmed || !student) return;
    try {
      addCustomTopicForSubject(student.subject, trimmed);
      const refreshed = listTopicsForStudentSubject(student.subject).map(t => t.name);
      setTopics(refreshed);
      setSelectedTopics(prev => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    } catch { /* silent fail for MVP */ }
  }

  function handleConfirm() {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (isReschedule && sessionId) {
        updateScheduled(sessionId, {
          scheduledFor: date.toISOString(),
          estimatedDurationMinutes: duration * 60,
          mode,
          session_type: sessionType,
          topics: selectedTopics,
          notes: notes.trim() || undefined,
        });
      } else {
        createScheduled({
          studentId: id,
          scheduledFor: date.toISOString(),
          estimatedDurationMinutes: duration * 60,
          mode,
          session_type: sessionType,
          topics: selectedTopics,
          notes: notes.trim() || undefined,
        });
      }
      router.back();
    } catch (_e) {
      Alert.alert('Error', 'Could not schedule lesson. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // Credit banner
  let banner: React.ReactNode = null;
  if (projectedBalance < 0) {
    banner = (
      <View
        style={{
          backgroundColor: COLORS.badFill,
          borderWidth: 1,
          borderColor: COLORS.crimson,
          borderRadius: 12,
          padding: 16,
          marginBottom: 24,
        }}
      >
        <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: COLORS.crimson }}>
          {'Student will be in deficit after this session (' +
            formatHours(Math.abs(projectedBalance)) +
            ' over). Remind parent to top up before ' +
            date.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' }) +
            '.'}
        </Text>
      </View>
    );
  } else if (projectedBalance < 1) {
    banner = (
      <View
        style={{
          backgroundColor: COLORS.warnFill,
          borderWidth: 1,
          borderColor: COLORS.amber,
          borderRadius: 12,
          padding: 16,
          marginBottom: 24,
        }}
      >
        <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: COLORS.amber }}>
          {'Balance will be low after this session (' +
            formatHours(projectedBalance) +
            ' remaining). Consider topping up.'}
        </Text>
      </View>
    );
  }

  const monoLabel = {
    fontFamily: F.mono,
    fontSize: 10,
    color: COLORS.inkFaint as string,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 8,
  };

  const fieldBorder = {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.paperEdge,
    paddingVertical: 12,
    marginBottom: 24,
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
      <ScreenHeader backLabel={firstName.toUpperCase()} onBack={() => router.back()} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Page heading */}
        <View style={{ marginBottom: 28 }}>
          <Text
            style={{
              fontFamily: F.mono,
              fontSize: 10,
              color: COLORS.oxblood,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 8,
            }}
          >
            {isReschedule ? '↺ RESCHEDULE LESSON' : '★ SCHEDULE LESSON'}
          </Text>
          <Text style={{ fontFamily: F.serif, fontSize: 28, color: COLORS.ink, lineHeight: 32 }}>
            {isReschedule ? 'New time,' : 'When are'}
          </Text>
          <Text style={{ fontFamily: F.serifItalic, fontSize: 28, color: COLORS.oxblood, lineHeight: 34 }}>
            {isReschedule ? 'same student.' : 'you meeting?'}
          </Text>
        </View>

        {/* DATE */}
        <Text style={monoLabel}>DATE</Text>
        <View style={fieldBorder}>
          <TouchableOpacity onPress={() => setShowDatePicker(true)} activeOpacity={0.7}>
            <Text style={{ fontFamily: F.serif, fontSize: 18, color: COLORS.ink }}>
              {date.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })}
            </Text>
          </TouchableOpacity>
        </View>

        {showDatePicker && (
          <LazyDateTimePicker
            value={date}
            mode="date"
            minimumDate={new Date()}
            onChange={(_event, selectedDate) => {
              setShowDatePicker(false);
              if (selectedDate) {
                setDate(prev => {
                  const d = new Date(prev);
                  d.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
                  return d;
                });
              }
            }}
          />
        )}

        {/* TIME */}
        <Text style={monoLabel}>TIME</Text>
        <View style={fieldBorder}>
          <TouchableOpacity onPress={() => setShowTimePicker(true)} activeOpacity={0.7}>
            <Text style={{ fontFamily: F.serif, fontSize: 18, color: COLORS.ink }}>
              {date.toLocaleTimeString('en-ZA', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}
            </Text>
          </TouchableOpacity>
        </View>

        {showTimePicker && (
          <LazyDateTimePicker
            value={date}
            mode="time"
            is24Hour
            minimumDate={new Date()}
            onChange={(_event, selectedDate) => {
              setShowTimePicker(false);
              if (selectedDate) {
                setDate(prev => {
                  const d = new Date(prev);
                  d.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
                  return d;
                });
              }
            }}
          />
        )}

        {/* DURATION */}
        <Text style={monoLabel}>DURATION</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
          {DURATIONS.map(d => (
            <TouchableOpacity
              key={d}
              onPress={() => setDuration(d)}
              activeOpacity={0.75}
              style={{
                backgroundColor: duration === d ? COLORS.ink : 'transparent',
                borderWidth: 1,
                borderColor: duration === d ? COLORS.ink : COLORS.paperEdge,
                borderRadius: 999,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              <Text
                style={{
                  fontFamily: F.sans,
                  fontSize: 13,
                  color: duration === d ? COLORS.paper : COLORS.ink,
                }}
              >
                {formatHours(d)}
              </Text>
            </TouchableOpacity>
          ))}
          {/* Custom pill */}
          {(() => {
            const isCustomActive = !PRESET_MINUTES.has(Math.round(duration * 60));
            const customLabel = isCustomActive
              ? `Custom (${formatCustomDuration(Math.round(duration * 60))})`
              : 'Custom';
            return (
              <TouchableOpacity
                onPress={() => setShowDurationSheet(true)}
                activeOpacity={0.75}
                style={{
                  backgroundColor: isCustomActive ? COLORS.ink : 'transparent',
                  borderWidth: 1,
                  borderColor: isCustomActive ? COLORS.ink : COLORS.paperEdge,
                  borderRadius: 999,
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                }}
              >
                <Text
                  style={{
                    fontFamily: F.sans,
                    fontSize: 13,
                    color: isCustomActive ? COLORS.paper : COLORS.ink,
                  }}
                >
                  {customLabel}
                </Text>
              </TouchableOpacity>
            );
          })()}
        </View>

        <DurationStepperSheet
          visible={showDurationSheet}
          initialMinutes={Math.round(duration * 60)}
          onConfirm={(mins) => { setDuration(mins / 60); setShowDurationSheet(false); }}
          onCancel={() => setShowDurationSheet(false)}
        />

        {/* MODE */}
        <Text style={monoLabel}>MODE</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 24 }}>
          {(['in_person', 'online'] as Mode[]).map(m => (
            <TouchableOpacity
              key={m}
              onPress={() => setMode(m)}
              activeOpacity={0.75}
              style={{
                backgroundColor: mode === m ? COLORS.ink : 'transparent',
                borderWidth: 1,
                borderColor: mode === m ? COLORS.ink : COLORS.paperEdge,
                borderRadius: 999,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              <Text
                style={{
                  fontFamily: F.sans,
                  fontSize: 13,
                  color: mode === m ? COLORS.paper : COLORS.ink,
                }}
              >
                {m === 'in_person' ? '📍 In-Person' : '💻 Online'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* TYPE */}
        <Text style={monoLabel}>TYPE</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
          {SESSION_TYPES.map(({ value, label }) => (
            <TouchableOpacity
              key={value}
              onPress={() => setSessionType(value)}
              activeOpacity={0.75}
              style={{
                backgroundColor: sessionType === value ? COLORS.ink : 'transparent',
                borderWidth: 1,
                borderColor: sessionType === value ? COLORS.ink : COLORS.paperEdge,
                borderRadius: 999,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              <Text
                style={{
                  fontFamily: F.sans,
                  fontSize: 13,
                  color: sessionType === value ? COLORS.paper : COLORS.ink,
                }}
              >
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* TOPICS (optional) */}
        <Text style={monoLabel}>TOPICS (OPTIONAL)</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
          {topics.map(topic => (
            <TopicChip
              key={topic}
              label={topic}
              selected={selectedTopics.includes(topic)}
              onPress={() => toggleTopic(topic)}
            />
          ))}
          {addingTopic ? (
            <TextInput
              autoFocus
              value={customTopicInput}
              onChangeText={setCustomTopicInput}
              onSubmitEditing={submitCustomTopic}
              onBlur={submitCustomTopic}
              placeholder="Topic name…"
              placeholderTextColor={COLORS.inkFaint}
              returnKeyType="done"
              style={{
                fontFamily: F.sans,
                fontSize: 13,
                color: COLORS.ink,
                borderWidth: 1,
                borderColor: COLORS.ink,
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
                borderColor: COLORS.inkFaint,
                borderStyle: 'dashed',
                borderRadius: 999,
                paddingHorizontal: 12,
                paddingVertical: 6,
              }}
              activeOpacity={0.75}
            >
              <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkFaint }}>+ Add</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* NOTES (optional) */}
        <Text style={monoLabel}>NOTES (OPTIONAL)</Text>
        <View
          style={{
            borderBottomWidth: 1,
            borderBottomColor: COLORS.paperEdge,
            marginBottom: 24,
          }}
        >
          <TextInput
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            placeholder="Add session notes…"
            placeholderTextColor={COLORS.inkFaint}
            style={{
              fontFamily: F.sans,
              fontSize: 15,
              color: COLORS.ink,
              paddingVertical: 12,
              minHeight: 72,
              textAlignVertical: 'top',
            }}
          />
        </View>

        {/* Credit warning banner */}
        {banner}

        {/* Conflict warning banner */}
        {conflictWarning && (
          <View style={{ backgroundColor: COLORS.warnFill, borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <Text style={{ fontFamily: F.sansMed, color: COLORS.ink, fontSize: 13 }}>
              {'⚠'} {conflictWarning}
            </Text>
          </View>
        )}

        {/* Confirm button */}
        <TouchableOpacity
          onPress={handleConfirm}
          disabled={submitting}
          activeOpacity={0.85}
          style={{
            backgroundColor: COLORS.oxblood,
            borderRadius: 16,
            paddingVertical: 16,
            alignItems: 'center',
            opacity: submitting ? 0.5 : 1,
          }}
        >
          <Text style={{ fontFamily: F.sansMed, fontSize: 16, color: COLORS.paper }}>
            {isReschedule ? 'Reschedule ▸' : 'Confirm lesson ▸'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
