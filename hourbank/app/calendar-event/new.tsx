import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { F } from '../../src/theme/fonts';
import { COLORS } from '../../src/theme/colors';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { LazyDateTimePicker } from '../../src/components/LazyDateTimePicker';
import { useStudents } from '../../src/hooks/useStudents';
import {
  createCalendarEvent,
  updateCalendarEvent,
  getCalendarEventById,
} from '../../src/db/calendar_events';

type Category = 'test' | 'exam' | 'homework' | 'other';

const LABEL_STYLE = {
  fontFamily: F.mono,
  fontSize: 11,
  color: COLORS.inkFaint,
  textTransform: 'uppercase' as const,
  marginBottom: 4,
};

const INPUT_STYLE = {
  fontFamily: F.sans,
  fontSize: 16,
  color: COLORS.ink,
  borderBottomWidth: 1,
  borderBottomColor: COLORS.paperEdge,
  paddingVertical: 12,
  marginBottom: 24,
};

const CATEGORY_OPTS: { value: Category; label: string }[] = [
  { value: 'test',     label: 'Test' },
  { value: 'exam',     label: 'Exam' },
  { value: 'homework', label: 'Homework' },
  { value: 'other',    label: 'Other' },
];

export default function NewCalendarEventScreen() {
  const router = useRouter();
  const { date, kind, id } = useLocalSearchParams<{
    date?: string;
    kind?: string;
    id?: string;
  }>();

  const isEdit = !!id;
  const eventKind = ((kind === 'time_block' ? 'time_block' : 'event') as 'event' | 'time_block');

  const [title, setTitle] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [allDay, setAllDay] = useState(false);
  const [startDate, setStartDate] = useState<Date>(() =>
    date ? new Date(date + 'T00:00:00') : new Date()
  );
  const [startTime, setStartTime] = useState<Date>(() => {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    return d;
  });
  const [endDate, setEndDate] = useState<Date>(() =>
    date ? new Date(date + 'T00:00:00') : new Date()
  );
  const [endTime, setEndTime] = useState<Date>(() => {
    const d = new Date();
    d.setHours(10, 0, 0, 0);
    return d;
  });
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  const [showStartDate, setShowStartDate] = useState(false);
  const [showStartTime, setShowStartTime] = useState(false);
  const [showEndDate, setShowEndDate] = useState(false);
  const [showEndTime, setShowEndTime] = useState(false);

  const { students } = useStudents();

  // Load for edit mode
  useEffect(() => {
    if (!isEdit || !id) return;
    try {
      const existing = getCalendarEventById(id);
      if (!existing) return;
      setTitle(existing.title);
      setSelectedStudentId(existing.student_id ?? null);
      setCategory((existing.category as Category | null) ?? null);
      setAllDay(existing.all_day === 1);
      const start = new Date(existing.starts_at);
      setStartDate(start);
      setStartTime(start);
      if (existing.ends_at) {
        const end = new Date(existing.ends_at);
        setEndDate(end);
        setEndTime(end);
      }
      setNotes(existing.notes ?? '');
    } catch {
      // ignore
    }
  }, [id, isEdit]);

  const headerTitle = isEdit
    ? (eventKind === 'event' ? 'EDIT EVENT' : 'EDIT BLOCK')
    : (eventKind === 'event' ? 'NEW EVENT' : 'NEW BLOCK');

  function handleSave() {
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError('Title is required');
      return;
    }
    setTitleError(null);

    const startsAt = allDay
      ? new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0).toISOString()
      : new Date(
          startDate.getFullYear(),
          startDate.getMonth(),
          startDate.getDate(),
          startTime.getHours(),
          startTime.getMinutes(),
          0,
        ).toISOString();

    const endsAt = allDay
      ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59).toISOString()
      : new Date(
          endDate.getFullYear(),
          endDate.getMonth(),
          endDate.getDate(),
          endTime.getHours(),
          endTime.getMinutes(),
          0,
        ).toISOString();

    setLoading(true);
    try {
      if (isEdit && id) {
        updateCalendarEvent(id, {
          title: trimmed,
          student_id: selectedStudentId,
          category,
          all_day: allDay ? 1 : 0,
          starts_at: startsAt,
          ends_at: endsAt,
          notes: notes || null,
          kind: eventKind,
        });
      } else {
        createCalendarEvent({
          kind: eventKind,
          student_id: selectedStudentId,
          starts_at: startsAt,
          ends_at: endsAt,
          all_day: allDay ? 1 : 0,
          title: trimmed,
          category,
          notes: notes || null,
          tutor_id: null,
        });
      }
      router.back();
    } finally {
      setLoading(false);
    }
  }

  function formatDateDisplay(d: Date): string {
    return d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatTimeDisplay(d: Date): string {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
      <ScreenHeader backLabel="BACK" onBack={() => router.back()} title={headerTitle} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Display heading */}
        <View style={{ marginBottom: 28 }}>
          <Text style={{ fontFamily: F.serif, fontSize: 28, color: COLORS.ink, lineHeight: 32 }}>
            {isEdit ? 'Edit' : 'New'}
          </Text>
          <Text style={{ fontFamily: F.serifItalic, fontSize: 28, color: COLORS.oxblood, lineHeight: 34 }}>
            {eventKind === 'event' ? 'event.' : 'time block.'}
          </Text>
        </View>

        {/* TITLE */}
        <Text style={LABEL_STYLE}>Title *</Text>
        <TextInput
          value={title}
          onChangeText={v => { setTitle(v); if (v.trim()) setTitleError(null); }}
          placeholder="e.g. Maths test"
          placeholderTextColor={COLORS.inkFaint}
          style={INPUT_STYLE}
          autoCapitalize="sentences"
          returnKeyType="next"
        />
        {titleError ? (
          <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.crimson, marginTop: -20, marginBottom: 16 }}>
            {titleError}
          </Text>
        ) : null}

        {/* STUDENT (events only) */}
        {eventKind === 'event' && (
          <>
            <Text style={LABEL_STYLE}>Student</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginBottom: 24 }}
              contentContainerStyle={{ gap: 8 }}
            >
              {/* None chip */}
              <TouchableOpacity
                onPress={() => setSelectedStudentId(null)}
                activeOpacity={0.7}
                style={{
                  borderWidth: 1,
                  borderColor: selectedStudentId === null ? COLORS.oxblood : COLORS.paperEdge,
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  backgroundColor: selectedStudentId === null ? COLORS.oxblood : 'rgba(255,255,255,0.4)',
                }}
              >
                <Text style={{
                  fontFamily: F.mono,
                  fontSize: 13,
                  color: selectedStudentId === null ? COLORS.paper : COLORS.inkSoft,
                }}>
                  None
                </Text>
              </TouchableOpacity>

              {students.map(s => (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => setSelectedStudentId(s.id)}
                  activeOpacity={0.7}
                  style={{
                    borderWidth: 1,
                    borderColor: selectedStudentId === s.id ? COLORS.oxblood : COLORS.paperEdge,
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    backgroundColor: selectedStudentId === s.id ? COLORS.oxblood : 'rgba(255,255,255,0.4)',
                  }}
                >
                  <Text style={{
                    fontFamily: F.sans,
                    fontSize: 13,
                    color: selectedStudentId === s.id ? COLORS.paper : COLORS.ink,
                  }}>
                    {s.full_name.trim().split(/\s+/)[0]}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        {/* CATEGORY (events only) */}
        {eventKind === 'event' && (
          <>
            <Text style={LABEL_STYLE}>Category (optional)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
              {CATEGORY_OPTS.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => setCategory(prev => prev === opt.value ? null : opt.value)}
                  activeOpacity={0.7}
                  style={{
                    borderWidth: 1,
                    borderColor: category === opt.value ? COLORS.ink : COLORS.paperEdge,
                    borderRadius: 999,
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                    backgroundColor: category === opt.value ? COLORS.ink : 'transparent',
                  }}
                >
                  <Text style={{
                    fontFamily: F.sans,
                    fontSize: 13,
                    color: category === opt.value ? COLORS.paper : COLORS.ink,
                  }}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* ALL DAY */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.ink }}>ALL DAY</Text>
          <Switch
            value={allDay}
            onValueChange={setAllDay}
            trackColor={{ false: COLORS.paperEdge, true: COLORS.ink }}
            thumbColor={COLORS.paper}
          />
        </View>

        {/* START DATE */}
        <Text style={LABEL_STYLE}>Start Date</Text>
        <TouchableOpacity
          onPress={() => setShowStartDate(true)}
          activeOpacity={0.7}
          style={{ borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge, paddingVertical: 12, marginBottom: 8 }}
        >
          <Text style={{ fontFamily: F.mono, fontSize: 15, color: COLORS.ink }}>
            {formatDateDisplay(startDate)}
          </Text>
        </TouchableOpacity>
        {showStartDate && (
          <LazyDateTimePicker
            value={startDate}
            mode="date"
            onChange={(_e, d) => {
              setShowStartDate(false);
              if (d) setStartDate(prev => { const r = new Date(prev); r.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()); return r; });
            }}
          />
        )}
        <View style={{ marginBottom: 16 }} />

        {/* START TIME */}
        {!allDay && (
          <>
            <Text style={LABEL_STYLE}>Start Time</Text>
            <TouchableOpacity
              onPress={() => setShowStartTime(true)}
              activeOpacity={0.7}
              style={{ borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge, paddingVertical: 12, marginBottom: 8 }}
            >
              <Text style={{ fontFamily: F.mono, fontSize: 15, color: COLORS.ink }}>
                {formatTimeDisplay(startTime)}
              </Text>
            </TouchableOpacity>
            {showStartTime && (
              <LazyDateTimePicker
                value={startTime}
                mode="time"
                is24Hour
                onChange={(_e, d) => {
                  setShowStartTime(false);
                  if (d) setStartTime(prev => { const r = new Date(prev); r.setHours(d.getHours(), d.getMinutes(), 0, 0); return r; });
                }}
              />
            )}
            <View style={{ marginBottom: 16 }} />
          </>
        )}

        {/* END DATE */}
        <Text style={LABEL_STYLE}>End Date</Text>
        <TouchableOpacity
          onPress={() => setShowEndDate(true)}
          activeOpacity={0.7}
          style={{ borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge, paddingVertical: 12, marginBottom: 8 }}
        >
          <Text style={{ fontFamily: F.mono, fontSize: 15, color: COLORS.ink }}>
            {formatDateDisplay(endDate)}
          </Text>
        </TouchableOpacity>
        {showEndDate && (
          <LazyDateTimePicker
            value={endDate}
            mode="date"
            onChange={(_e, d) => {
              setShowEndDate(false);
              if (d) setEndDate(prev => { const r = new Date(prev); r.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()); return r; });
            }}
          />
        )}
        <View style={{ marginBottom: 16 }} />

        {/* END TIME */}
        {!allDay && (
          <>
            <Text style={LABEL_STYLE}>End Time</Text>
            <TouchableOpacity
              onPress={() => setShowEndTime(true)}
              activeOpacity={0.7}
              style={{ borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge, paddingVertical: 12, marginBottom: 8 }}
            >
              <Text style={{ fontFamily: F.mono, fontSize: 15, color: COLORS.ink }}>
                {formatTimeDisplay(endTime)}
              </Text>
            </TouchableOpacity>
            {showEndTime && (
              <LazyDateTimePicker
                value={endTime}
                mode="time"
                is24Hour
                onChange={(_e, d) => {
                  setShowEndTime(false);
                  if (d) setEndTime(prev => { const r = new Date(prev); r.setHours(d.getHours(), d.getMinutes(), 0, 0); return r; });
                }}
              />
            )}
            <View style={{ marginBottom: 16 }} />
          </>
        )}

        {/* NOTES */}
        <Text style={LABEL_STYLE}>Notes (optional)</Text>
        <View style={{ borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge, marginBottom: 32 }}>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={4}
            placeholder="Add notes…"
            placeholderTextColor={COLORS.inkFaint}
            style={{
              fontFamily: F.sans,
              fontSize: 15,
              color: COLORS.ink,
              paddingVertical: 12,
              minHeight: 88,
              textAlignVertical: 'top',
            }}
          />
        </View>

        {/* Save button */}
        <TouchableOpacity
          onPress={handleSave}
          disabled={loading}
          activeOpacity={0.85}
          style={{
            backgroundColor: COLORS.ink,
            borderRadius: 12,
            paddingVertical: 16,
            alignItems: 'center',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.paper} />
          ) : (
            <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.paper }}>
              {isEdit ? 'Save changes ▸' : 'Save ▸'}
            </Text>
          )}
        </TouchableOpacity>

        {/* Cancel link */}
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.7}
          style={{ alignItems: 'center', paddingVertical: 16 }}
        >
          <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.inkFaint }}>
            Cancel
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
