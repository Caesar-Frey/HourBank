import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { F, MIN_TOUCH } from '../../src/theme/fonts';
import { COLORS } from '../../src/theme/colors';
import { eventKindStyle } from '../../src/theme/eventColors';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { FormScreen } from '../../src/components/FormScreen';
import { useToast } from '../../src/components/Toast';
import { DateField } from '../../src/components/calendar/DateField';
import { useStudents } from '../../src/hooks/useStudents';
import {
  createCalendarEvent,
  updateCalendarEvent,
  getCalendarEventById,
} from '../../src/db/calendar_events';
import { formatDayShort, formatTime } from '../../src/utils/format';
import {
  DEFAULT_BLOCK_TITLE,
  eventIsoRange,
  initialRange,
  resolveTitle,
  shiftEndWithStart,
  validateEventRange,
  withDatePart,
  withTimePart,
} from '../../src/screens/schedule/eventFormModel';

type Category = 'test' | 'exam' | 'homework' | 'other';
type PickerTarget = 'startDate' | 'startTime' | 'endDate' | 'endTime' | null;

const LABEL_STYLE = {
  fontFamily: F.mono,
  fontSize: 12,
  color: COLORS.inkFaint,
  textTransform: 'uppercase' as const,
  marginBottom: 4,
};

const CATEGORY_OPTS: { value: Category; label: string }[] = [
  { value: 'test',     label: 'Test' },
  { value: 'exam',     label: 'Exam' },
  { value: 'homework', label: 'Homework' },
  { value: 'other',    label: 'Other' },
];

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
      style={{
        borderWidth: 1,
        borderColor: selected ? COLORS.ink : COLORS.paperEdge,
        borderRadius: 999,
        paddingHorizontal: 14,
        minHeight: 36,
        justifyContent: 'center',
        backgroundColor: selected ? COLORS.ink : COLORS.cardFill,
      }}
    >
      <Text style={{ fontFamily: F.sans, fontSize: 13, color: selected ? COLORS.paper : COLORS.ink }}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function NewCalendarEventScreen() {
  const router = useRouter();
  const toast = useToast();
  const { date, kind, id } = useLocalSearchParams<{ date?: string; kind?: string; id?: string }>();

  const isEdit = !!id;
  const [eventKind, setEventKind] = useState<'event' | 'time_block'>(kind === 'time_block' ? 'time_block' : 'event');
  const [title, setTitle] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState<Date>(() => initialRange(date).start);
  const [end, setEnd] = useState<Date>(() => initialRange(date).end);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerTarget>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const savingRef = useRef(false);

  const { students } = useStudents();

  // Load for edit mode
  useEffect(() => {
    if (!isEdit || !id) return;
    try {
      const existing = getCalendarEventById(id);
      if (!existing) {
        setLoadFailed(true);
        return;
      }
      setEventKind(existing.kind);
      setTitle(existing.kind === 'time_block' && existing.title === DEFAULT_BLOCK_TITLE ? '' : existing.title);
      setSelectedStudentId(existing.student_id ?? null);
      setCategory((existing.category as Category | null) ?? null);
      setAllDay(existing.all_day === 1);
      const s = new Date(existing.starts_at);
      setStart(s);
      setEnd(existing.ends_at ? new Date(existing.ends_at) : new Date(s.getTime() + 60 * 60_000));
      setNotes(existing.notes ?? '');
    } catch {
      setLoadFailed(true);
    }
  }, [id, isEdit]);

  const rangeError = validateEventRange(start, end, allDay);
  const style = eventKindStyle(eventKind);
  const noun = eventKind === 'event' ? 'event' : 'time block';

  /** Changing the start moves the end with it (duration preserved). */
  function changeStart(next: Date) {
    setEnd(prevEnd => shiftEndWithStart(start, prevEnd, next));
    setStart(next);
  }

  function handleSave() {
    if (savingRef.current) return;
    const t = resolveTitle(eventKind, title);
    if ('error' in t) {
      setTitleError(t.error);
      return;
    }
    if (rangeError) return;
    setTitleError(null);

    savingRef.current = true;
    setSaving(true);
    const { startsAt, endsAt } = eventIsoRange(start, end, allDay);
    const studentId = eventKind === 'event' ? selectedStudentId : null;
    const cat = eventKind === 'event' ? category : null;
    try {
      if (isEdit && id) {
        updateCalendarEvent(id, {
          title: t.title,
          student_id: studentId,
          category: cat,
          all_day: allDay ? 1 : 0,
          starts_at: startsAt,
          ends_at: endsAt,
          notes: notes.trim() || null,
          kind: eventKind,
        });
      } else {
        createCalendarEvent({
          kind: eventKind,
          student_id: studentId,
          starts_at: startsAt,
          ends_at: endsAt,
          all_day: allDay ? 1 : 0,
          title: t.title,
          category: cat,
          notes: notes.trim() || null,
          tutor_id: null,
        });
      }
      toast.show({ kind: 'success', message: isEdit ? 'Changes saved' : `${noun.charAt(0).toUpperCase()}${noun.slice(1)} added` });
      router.back();
    } catch {
      savingRef.current = false;
      setSaving(false);
      toast.show({ kind: 'error', message: `Couldn’t save the ${noun}. Nothing was changed — try again.` });
    }
  }

  if (loadFailed) {
    return (
      <FormScreen header={<ScreenHeader backLabel="BACK" onBack={() => router.back()} />}>
        <Text style={{ fontFamily: F.serif, fontSize: 22, color: COLORS.ink, marginTop: 40, textAlign: 'center' }}>
          This item no longer exists
        </Text>
      </FormScreen>
    );
  }

  const footer = (
    <TouchableOpacity
      onPress={handleSave}
      disabled={saving || !!rangeError}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityState={{ disabled: saving || !!rangeError }}
      style={{
        backgroundColor: rangeError ? COLORS.paperEdge : COLORS.oxblood,
        borderRadius: 12,
        minHeight: 52,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: saving ? 0.6 : 1,
      }}
    >
      {saving ? (
        <ActivityIndicator color={COLORS.paper} />
      ) : (
        <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: rangeError ? COLORS.inkSoft : COLORS.paper }}>
          {isEdit ? 'Save changes' : `Save ${noun}`}
        </Text>
      )}
    </TouchableOpacity>
  );

  return (
    <FormScreen
      header={
        <ScreenHeader
          backLabel="BACK"
          onBack={() => router.back()}
          title={isEdit ? `Edit ${noun}` : `New ${noun}`}
        />
      }
      footer={footer}
    >
      <View style={{ marginBottom: 24, marginTop: 8 }}>
        <Text style={{ fontFamily: F.serif, fontSize: 28, color: COLORS.ink, lineHeight: 32 }}>{isEdit ? 'Edit' : 'New'}</Text>
        <Text style={{ fontFamily: F.serifItalic, fontSize: 28, color: style.fg, lineHeight: 34 }}>{`${noun}.`}</Text>
      </View>

      {/* TITLE */}
      <Text style={LABEL_STYLE}>{eventKind === 'event' ? 'Title' : 'Title (optional)'}</Text>
      <TextInput
        value={title}
        onChangeText={v => {
          setTitle(v);
          if (v.trim()) setTitleError(null);
        }}
        placeholder={eventKind === 'event' ? 'e.g. Maths test' : `e.g. Gym — shows as “${DEFAULT_BLOCK_TITLE}”`}
        placeholderTextColor={COLORS.inkFaint}
        style={{
          fontFamily: F.sans,
          fontSize: 16,
          color: COLORS.ink,
          borderBottomWidth: 1,
          borderBottomColor: titleError ? COLORS.crimson : COLORS.paperEdge,
          paddingVertical: 12,
          marginBottom: titleError ? 4 : 24,
        }}
        autoCapitalize="sentences"
        returnKeyType="done"
      />
      {titleError ? (
        <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.crimson, marginBottom: 20 }}>{titleError}</Text>
      ) : null}

      {eventKind === 'event' ? (
        <>
          <Text style={LABEL_STYLE}>Student (optional)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 24 }} contentContainerStyle={{ gap: 8 }}>
            <Chip label="None" selected={selectedStudentId === null} onPress={() => setSelectedStudentId(null)} />
            {students.map(s => (
              <Chip
                key={s.id}
                label={s.full_name.trim().split(/\s+/)[0]}
                selected={selectedStudentId === s.id}
                onPress={() => setSelectedStudentId(s.id)}
              />
            ))}
          </ScrollView>

          <Text style={LABEL_STYLE}>Category (optional)</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
            {CATEGORY_OPTS.map(opt => (
              <Chip
                key={opt.value}
                label={opt.label}
                selected={category === opt.value}
                onPress={() => setCategory(prev => (prev === opt.value ? null : opt.value))}
              />
            ))}
          </View>
        </>
      ) : null}

      {/* ALL DAY */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: MIN_TOUCH, marginBottom: 8 }}>
        <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.ink }}>All day</Text>
        <Switch
          value={allDay}
          onValueChange={v => {
            setAllDay(v);
            setPicker(null);
          }}
          trackColor={{ false: COLORS.paperEdge, true: COLORS.ink }}
          thumbColor={COLORS.paper}
          accessibilityLabel="All day"
        />
      </View>

      <DateField
        label="Starts"
        mode="date"
        value={start}
        display={formatDayShort(start)}
        open={picker === 'startDate'}
        onOpen={() => setPicker('startDate')}
        onClose={() => setPicker(null)}
        onChange={d => changeStart(withDatePart(start, d))}
      />
      {!allDay ? (
        <DateField
          label="Start time"
          mode="time"
          value={start}
          display={formatTime(start)}
          open={picker === 'startTime'}
          onOpen={() => setPicker('startTime')}
          onClose={() => setPicker(null)}
          onChange={d => changeStart(withTimePart(start, d))}
        />
      ) : null}
      <DateField
        label="Ends"
        mode="date"
        value={end}
        display={formatDayShort(end)}
        open={picker === 'endDate'}
        onOpen={() => setPicker('endDate')}
        onClose={() => setPicker(null)}
        onChange={d => setEnd(withDatePart(end, d))}
        error={!!rangeError}
        minimumDate={start}
      />
      {!allDay ? (
        <DateField
          label="End time"
          mode="time"
          value={end}
          display={formatTime(end)}
          open={picker === 'endTime'}
          onOpen={() => setPicker('endTime')}
          onClose={() => setPicker(null)}
          onChange={d => setEnd(withTimePart(end, d))}
          error={!!rangeError}
        />
      ) : null}
      {rangeError ? (
        <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.crimson, marginBottom: 12 }}>{rangeError}</Text>
      ) : null}

      {/* NOTES */}
      <Text style={[LABEL_STYLE, { marginTop: 12 }]}>Notes (optional)</Text>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        multiline
        placeholder="Add notes…"
        placeholderTextColor={COLORS.inkFaint}
        style={{
          fontFamily: F.sans,
          fontSize: 15,
          color: COLORS.ink,
          paddingVertical: 12,
          minHeight: 88,
          textAlignVertical: 'top',
          borderBottomWidth: 1,
          borderBottomColor: COLORS.paperEdge,
        }}
      />
    </FormScreen>
  );
}
