import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';
import { F, MIN_TOUCH } from '../theme/fonts';
import { EVENT_KIND_COLORS } from '../theme/eventColors';
import type { EventKind, SessionTypeFilter } from '../db/calendar';
import {
  ScheduleFilters,
  allStudentsExcluded,
  defaultScheduleFilters,
  isFilterActive,
  toggleExcluded,
} from '../screens/schedule/filterModel';
import { SESSION_TYPE_OPTIONS } from '../screens/schedule/labels';
import { useKeyboardHeight } from './FormScreen';

interface Student {
  id: string;
  full_name: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  filters: ScheduleFilters;
  /** Called with the edited draft when the tutor taps Done. */
  onApply: (f: ScheduleFilters) => void;
  students: Student[];
}

// Colours come from the shared map so filter dots match calendar + legend.
const EVENT_KIND_OPTS: { value: EventKind; label: string; color: string }[] = [
  { value: 'scheduled',  label: 'Booked lessons',    color: EVENT_KIND_COLORS.scheduled.fg },
  { value: 'completed',  label: 'Taught lessons',    color: EVENT_KIND_COLORS.completed.fg },
  { value: 'cancelled',  label: 'Cancelled/no-show', color: EVENT_KIND_COLORS.cancelled.fg },
  { value: 'top_up',     label: 'Top-ups',           color: EVENT_KIND_COLORS.top_up.fg },
  { value: 'event',      label: 'Events',            color: EVENT_KIND_COLORS.event.fg },
  { value: 'time_block', label: 'Blocked time',      color: EVENT_KIND_COLORS.time_block.fg },
];

function SectionLabel({ children, right }: { children: string; right?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 10 }}>
      <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {children}
      </Text>
      {right ? <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint }}>{right}</Text> : null}
    </View>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <View
      style={{
        width: 20,
        height: 20,
        borderRadius: 6,
        borderWidth: 1.5,
        borderColor: checked ? COLORS.ink : COLORS.paperEdge,
        backgroundColor: checked ? COLORS.ink : COLORS.transparent,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {checked ? <Feather name="check" size={13} color={COLORS.paper} /> : null}
    </View>
  );
}

function Chip({ label, selected, dotColor, onPress }: { label: string; selected: boolean; dotColor?: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: selected ? COLORS.ink : COLORS.transparent,
        borderWidth: 1,
        borderColor: selected ? COLORS.ink : COLORS.paperEdge,
        borderRadius: 999,
        paddingHorizontal: 14,
        minHeight: 36,
        marginRight: 8,
        marginBottom: 8,
        gap: 6,
      }}
    >
      {dotColor ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} /> : null}
      <Text style={{ fontFamily: F.sans, fontSize: 13, color: selected ? COLORS.paper : COLORS.ink }}>{label}</Text>
    </TouchableOpacity>
  );
}

function HeaderButton({ label, onPress, color, disabled }: { label: string; onPress: () => void; color: string; disabled?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={{ minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, justifyContent: 'center', alignItems: 'center', opacity: disabled ? 0.4 : 1 }}
    >
      <Text style={{ fontFamily: F.sansMed, fontSize: 14, color }}>{label}</Text>
    </TouchableOpacity>
  );
}

export function CalendarFilterSheet({ visible, onClose, filters, onApply, students }: Props) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();

  // Draft state — nothing applies until "Done". Re-sync whenever the sheet opens.
  const [draft, setDraft] = useState<ScheduleFilters>(filters);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (visible) {
      setDraft({
        excludedStudentIds: [...filters.excludedStudentIds],
        excludedKinds: [...filters.excludedKinds],
        excludedSessionTypes: [...filters.excludedSessionTypes],
      });
      setQuery('');
    }
  }, [visible]); // only on open: edits stay in the draft until Done

  const allIds = students.map(s => s.id);
  const excluded = new Set(draft.excludedStudentIds);
  const shownCount = students.filter(s => !excluded.has(s.id)).length;
  const noneShown = allStudentsExcluded(draft, allIds);
  const allShown = draft.excludedStudentIds.length === 0;
  const noKinds = draft.excludedKinds.length === EVENT_KIND_OPTS.length;
  const noTypes = draft.excludedSessionTypes.length === SESSION_TYPE_OPTIONS.length;

  const q = query.trim().toLowerCase();
  const visibleStudents = q ? students.filter(s => s.full_name.toLowerCase().includes(q)) : students;

  function toggleStudent(id: string) {
    setDraft(prev => ({ ...prev, excludedStudentIds: toggleExcluded(prev.excludedStudentIds, id) }));
  }
  function toggleAllStudents() {
    setDraft(prev => ({ ...prev, excludedStudentIds: allShown ? [...allIds] : [] }));
  }
  function toggleKind(kind: EventKind) {
    setDraft(prev => ({ ...prev, excludedKinds: toggleExcluded(prev.excludedKinds, kind) }));
  }
  function toggleType(t: SessionTypeFilter) {
    setDraft(prev => ({ ...prev, excludedSessionTypes: toggleExcluded(prev.excludedSessionTypes, t) }));
  }

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      {/* Backdrop — tap discards draft */}
      <Pressable style={{ flex: 1, backgroundColor: COLORS.scrimSoft }} onPress={onClose} accessibilityLabel="Close filters" />

      <View
        style={{
          backgroundColor: COLORS.paper,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          paddingHorizontal: 24,
          // Keyboard-safe: when the search field is focused the sheet rides above the IME.
          paddingBottom: (keyboard > 0 ? keyboard : insets.bottom) + 16,
          maxHeight: '88%',
        }}
      >
        <View style={{ width: 40, height: 4, backgroundColor: COLORS.paperEdge, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 }} />

        {/* Title row: Reset · Filters · Done */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <HeaderButton
            label="Reset"
            color={COLORS.inkSoft}
            disabled={!isFilterActive(draft)}
            onPress={() => setDraft(defaultScheduleFilters())}
          />
          <Text accessibilityRole="header" style={{ fontFamily: F.serif, fontSize: 20, color: COLORS.ink }}>Filters</Text>
          <HeaderButton label="Done" color={COLORS.oxblood} onPress={() => onApply(draft)} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={{ marginTop: 4 }} keyboardShouldPersistTaps="handled">
          {/* STUDENTS */}
          <SectionLabel right={allShown ? 'ALL' : `${shownCount}/${students.length}`}>Students</SectionLabel>

          {students.length > 6 ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: COLORS.paperDeep,
                borderRadius: 10,
                paddingHorizontal: 12,
                height: 40,
                gap: 8,
              }}
            >
              <Feather name="search" size={15} color={COLORS.inkFaint} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search students"
                placeholderTextColor={COLORS.inkFaint}
                style={{ flex: 1, fontFamily: F.sans, fontSize: 14, color: COLORS.ink, padding: 0 }}
                autoCorrect={false}
              />
              {query.length > 0 ? (
                <TouchableOpacity
                  onPress={() => setQuery('')}
                  hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                >
                  <Feather name="x" size={15} color={COLORS.inkFaint} />
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          <TouchableOpacity
            onPress={toggleAllStudents}
            activeOpacity={0.7}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: allShown }}
            style={{ flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH, marginTop: 6, gap: 12 }}
          >
            <Checkbox checked={allShown} />
            <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.ink }}>All students</Text>
          </TouchableOpacity>

          {noneShown ? (
            <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.oxblood, marginBottom: 6 }}>
              No students ticked — only events and blocks without a student will show.
            </Text>
          ) : null}

          <View style={{ maxHeight: 210, borderTopWidth: 1, borderTopColor: COLORS.paperEdge }}>
            <ScrollView showsVerticalScrollIndicator nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {visibleStudents.map(s => {
                const sel = !excluded.has(s.id);
                return (
                  <TouchableOpacity
                    key={s.id}
                    onPress={() => toggleStudent(s.id)}
                    activeOpacity={0.7}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: sel }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      minHeight: MIN_TOUCH,
                      borderBottomWidth: 1,
                      borderBottomColor: COLORS.paperEdge,
                      gap: 12,
                    }}
                  >
                    <Checkbox checked={sel} />
                    <Text style={{ flex: 1, fontFamily: F.sans, fontSize: 15, color: COLORS.ink }} numberOfLines={1}>
                      {s.full_name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {visibleStudents.length === 0 ? (
                <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkFaint, paddingVertical: 16 }}>
                  {students.length === 0 ? 'No students yet' : `No students match “${query}”`}
                </Text>
              ) : null}
            </ScrollView>
          </View>

          {/* SHOW */}
          <SectionLabel>Show</SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {EVENT_KIND_OPTS.map(opt => (
              <Chip
                key={opt.value}
                label={opt.label}
                dotColor={opt.color}
                selected={!draft.excludedKinds.includes(opt.value)}
                onPress={() => toggleKind(opt.value)}
              />
            ))}
          </View>
          {noKinds ? (
            <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.oxblood }}>
              Everything is unticked — the calendar will be empty.
            </Text>
          ) : null}

          {/* LESSON TYPE */}
          <SectionLabel>Lesson type</SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
            {SESSION_TYPE_OPTIONS.map(opt => (
              <Chip
                key={opt.value}
                label={opt.label}
                selected={!draft.excludedSessionTypes.includes(opt.value)}
                onPress={() => toggleType(opt.value)}
              />
            ))}
          </View>
          {noTypes ? (
            <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.oxblood, marginBottom: 8 }}>
              No lesson types ticked — lessons will be hidden.
            </Text>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}
