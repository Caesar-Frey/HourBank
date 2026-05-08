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
import DateTimePicker from '@react-native-community/datetimepicker';
import { F } from '../../../../src/theme/fonts';
import { ScreenHeader } from '../../../../src/components/ScreenHeader';
import { TopicChip } from '../../../../src/components/TopicChip';
import { getStudent } from '../../../../src/db/students';
import { currentBalance } from '../../../../src/db/ledger';
import { createScheduled, updateScheduled, listUpcoming } from '../../../../src/db/sessions';
import { formatHours } from '../../../../src/utils/format';
import { DEFAULT_TOPICS } from '../../../../src/config';
import { Student } from '../../../../src/db/schema';

const DURATIONS = [0.5, 1, 1.5, 2] as const;
type Mode = 'in_person' | 'online';

export default function ScheduleScreen() {
  const { id, sessionId } = useLocalSearchParams<{ id: string; sessionId?: string }>();
  const isReschedule = !!sessionId;
  const router = useRouter();

  // Data
  const [student, setStudent] = useState<Student | null>(null);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  // Form state — default date is tomorrow at 15:00
  const [date, setDate] = useState<Date>(() => {
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    d.setHours(15, 0, 0, 0);
    return d;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [duration, setDuration] = useState<number>(1);
  const [mode, setMode] = useState<Mode>('in_person');
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    try {
      const s = getStudent(id);
      setStudent(s);
      if (s) {
        setBalance(currentBalance(id));
      }
      if (isReschedule && sessionId) {
        const upcoming = listUpcoming(id);
        const existing = upcoming.find(sess => sess.id === sessionId);
        if (existing) {
          if (existing.scheduled_for) setDate(new Date(existing.scheduled_for));
          if (existing.estimated_duration_minutes) {
            setDuration(existing.estimated_duration_minutes / 60);
          }
          setMode(existing.mode);
          try {
            const parsed: string[] = JSON.parse(existing.topics);
            if (Array.isArray(parsed)) setSelectedTopics(parsed);
          } catch { /* ignore */ }
          setNotes(existing.session_notes ?? '');
        }
      }
    } catch (e) {
      console.error('Failed to load student', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  if (loading) {
    return (
      <View className="flex-1 bg-paper items-center justify-center">
        <Text style={{ fontFamily: F.mono, fontSize: 13, color: '#8A7E72' }}>Loading…</Text>
      </View>
    );
  }

  if (!student) {
    return (
      <View className="flex-1 bg-paper items-center justify-center px-6">
        <Text style={{ fontFamily: F.serif, fontSize: 24, color: '#1B1714', marginBottom: 16 }}>
          Student not found
        </Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ fontFamily: F.mono, fontSize: 13, color: '#4A413A' }}>← Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const topics: string[] = DEFAULT_TOPICS[student.subject] ?? [];
  const projectedBalance = balance - duration;
  const firstName = student.full_name.trim().split(/\s+/)[0];

  function toggleTopic(topic: string) {
    setSelectedTopics(prev =>
      prev.includes(topic) ? prev.filter(t => t !== topic) : [...prev, topic]
    );
  }

  function handleConfirm() {
    try {
      if (isReschedule && sessionId) {
        updateScheduled(sessionId, {
          scheduledFor: date.toISOString(),
          estimatedDurationMinutes: duration * 60,
          mode,
          topics: selectedTopics,
          notes: notes.trim() || undefined,
        });
      } else {
        createScheduled({
          studentId: id,
          scheduledFor: date.toISOString(),
          estimatedDurationMinutes: duration * 60,
          mode,
          topics: selectedTopics,
          notes: notes.trim() || undefined,
        });
      }
      router.back();
    } catch (_e) {
      Alert.alert('Error', 'Could not schedule lesson. Please try again.');
    }
  }

  // Credit banner
  let banner: React.ReactNode = null;
  if (projectedBalance < 0) {
    banner = (
      <View
        style={{
          backgroundColor: '#EFD7D7',
          borderWidth: 1,
          borderColor: '#9A2A2A',
          borderRadius: 12,
          padding: 16,
          marginBottom: 24,
        }}
      >
        <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: '#9A2A2A' }}>
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
          backgroundColor: '#F0E0CB',
          borderWidth: 1,
          borderColor: '#B8743F',
          borderRadius: 12,
          padding: 16,
          marginBottom: 24,
        }}
      >
        <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: '#B8743F' }}>
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
    color: '#8A7E72' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 8,
  };

  const fieldBorder = {
    borderBottomWidth: 1,
    borderBottomColor: '#D9CFBF',
    paddingVertical: 12,
    marginBottom: 24,
  };

  return (
    <SafeAreaView className="flex-1 bg-paper" edges={['top']}>
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
              color: '#7A2530',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 8,
            }}
          >
            {isReschedule ? '↺ RESCHEDULE LESSON' : '★ SCHEDULE LESSON'}
          </Text>
          <Text style={{ fontFamily: F.serif, fontSize: 28, color: '#1B1714', lineHeight: 32 }}>
            {isReschedule ? 'New time,' : 'When are'}
          </Text>
          <Text style={{ fontFamily: F.serifItalic, fontSize: 28, color: '#7A2530', lineHeight: 34 }}>
            {isReschedule ? 'same student.' : 'you meeting?'}
          </Text>
        </View>

        {/* DATE */}
        <Text style={monoLabel}>DATE</Text>
        <View style={fieldBorder}>
          <TouchableOpacity onPress={() => setShowDatePicker(true)} activeOpacity={0.7}>
            <Text style={{ fontFamily: F.serif, fontSize: 18, color: '#1B1714' }}>
              {date.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })}
            </Text>
          </TouchableOpacity>
        </View>

        {showDatePicker && (
          <DateTimePicker
            value={date}
            mode="date"
            minimumDate={new Date()}
            onChange={(_event, selectedDate) => {
              setShowDatePicker(false);
              if (selectedDate) {
                setDate(prev => {
                  const d = new Date(prev);
                  d.setFullYear(
                    selectedDate.getFullYear(),
                    selectedDate.getMonth(),
                    selectedDate.getDate()
                  );
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
            <Text style={{ fontFamily: F.serif, fontSize: 18, color: '#1B1714' }}>
              {date.toLocaleTimeString('en-ZA', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}
            </Text>
          </TouchableOpacity>
        </View>

        {showTimePicker && (
          <DateTimePicker
            value={date}
            mode="time"
            is24Hour={true}
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
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 24 }}>
          {DURATIONS.map(d => (
            <TouchableOpacity
              key={d}
              onPress={() => setDuration(d)}
              activeOpacity={0.75}
              style={{
                backgroundColor: duration === d ? '#1B1714' : 'transparent',
                borderWidth: 1,
                borderColor: duration === d ? '#1B1714' : '#D9CFBF',
                borderRadius: 999,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              <Text
                style={{
                  fontFamily: F.sans,
                  fontSize: 13,
                  color: duration === d ? '#F4EFE6' : '#1B1714',
                }}
              >
                {formatHours(d)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* MODE */}
        <Text style={monoLabel}>MODE</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 24 }}>
          {(['in_person', 'online'] as Mode[]).map(m => (
            <TouchableOpacity
              key={m}
              onPress={() => setMode(m)}
              activeOpacity={0.75}
              style={{
                backgroundColor: mode === m ? '#1B1714' : 'transparent',
                borderWidth: 1,
                borderColor: mode === m ? '#1B1714' : '#D9CFBF',
                borderRadius: 999,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              <Text
                style={{
                  fontFamily: F.sans,
                  fontSize: 13,
                  color: mode === m ? '#F4EFE6' : '#1B1714',
                }}
              >
                {m === 'in_person' ? '📍 In-Person' : '💻 Online'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* TOPICS (optional) */}
        {topics.length > 0 && (
          <>
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
            </View>
          </>
        )}

        {/* NOTES (optional) */}
        <Text style={monoLabel}>NOTES (OPTIONAL)</Text>
        <View
          style={{
            borderBottomWidth: 1,
            borderBottomColor: '#D9CFBF',
            marginBottom: 24,
          }}
        >
          <TextInput
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            placeholder="Add session notes…"
            placeholderTextColor="#8A7E72"
            style={{
              fontFamily: F.sans,
              fontSize: 15,
              color: '#1B1714',
              paddingVertical: 12,
              minHeight: 72,
              textAlignVertical: 'top',
            }}
          />
        </View>

        {/* Credit warning banner */}
        {banner}

        {/* Confirm button — always enabled */}
        <TouchableOpacity
          onPress={handleConfirm}
          activeOpacity={0.85}
          style={{
            backgroundColor: '#7A2530',
            borderRadius: 16,
            paddingVertical: 16,
            alignItems: 'center',
          }}
        >
          <Text style={{ fontFamily: F.sansMed, fontSize: 16, color: '#F4EFE6' }}>
            {isReschedule ? 'Reschedule ▸' : 'Confirm lesson ▸'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
