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
import { CalendarFilters, EventKind, SessionTypeFilter } from '../db/calendar';

interface Student {
  id: string;
  full_name: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  filters: CalendarFilters;
  onFiltersChange: (f: CalendarFilters) => void;
  students: Student[];
}

// Colours come from the shared map so filter dots match calendar + legend.
const EVENT_KIND_OPTS: { value: EventKind; label: string; color: string }[] = [
  { value: 'scheduled',  label: 'Scheduled', color: EVENT_KIND_COLORS.scheduled.fg },
  { value: 'completed',  label: 'Completed', color: EVENT_KIND_COLORS.completed.fg },
  { value: 'cancelled',  label: 'Cancelled', color: EVENT_KIND_COLORS.cancelled.fg },
  { value: 'top_up',     label: 'Top-up',    color: EVENT_KIND_COLORS.top_up.fg },
  { value: 'event',      label: 'Events',    color: EVENT_KIND_COLORS.event.fg },
  { value: 'time_block', label: 'Blocks',    color: EVENT_KIND_COLORS.time_block.fg },
];

const SESSION_TYPE_OPTS: { value: SessionTypeFilter; label: string }[] = [
  { value: 'general',   label: 'General' },
  { value: 'review',    label: 'Review' },
  { value: 'test_prep', label: 'Test prep' },
  { value: 'exam_prep', label: 'Exam prep' },
];

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontFamily: F.mono,
        fontSize: 10,
        color: COLORS.inkFaint,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 10,
        marginTop: 20,
      }}
    >
      {children}
    </Text>
  );
}

function Chip({
  label,
  selected,
  dotColor,
  onPress,
}: {
  label: string;
  selected: boolean;
  dotColor?: string;
  onPress: () => void;
}) {
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
        backgroundColor: selected ? COLORS.ink : 'transparent',
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
      {dotColor ? (
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: dotColor,
          }}
        />
      ) : null}
      <Text
        style={{
          fontFamily: F.sans,
          fontSize: 13,
          color: selected ? COLORS.paper : COLORS.ink,
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export function CalendarFilterSheet({
  visible,
  onClose,
  filters,
  onFiltersChange,
  students,
}: Props) {
  const insets = useSafeAreaInsets();

  // Draft state — nothing applies until "Done". Re-sync whenever the sheet opens.
  const [draft, setDraft] = useState<CalendarFilters>(filters);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (visible) {
      setDraft({
        studentIds: filters.studentIds,
        eventKinds: new Set(filters.eventKinds),
        sessionTypes: new Set(filters.sessionTypes),
      });
      setQuery('');
    }
  }, [visible]);

  // ── Handlers (mutate draft only) ────────────────────────────────────────────

  function toggleStudent(id: string) {
    setDraft(prev => {
      if (prev.studentIds === null) {
        // Was "all" — deselecting one means "all others"
        const others = students.map(s => s.id).filter(sid => sid !== id);
        return { ...prev, studentIds: others };
      }
      const next = prev.studentIds.includes(id)
        ? prev.studentIds.filter(s => s !== id)
        : [...prev.studentIds, id];
      // All or none selected → revert to null (null = all)
      return {
        ...prev,
        studentIds: next.length === students.length || next.length === 0 ? null : next,
      };
    });
  }

  function selectAllStudents() {
    setDraft(prev => ({ ...prev, studentIds: null }));
  }

  function toggleKind(kind: EventKind) {
    setDraft(prev => {
      const next = new Set(prev.eventKinds);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return { ...prev, eventKinds: next };
    });
  }

  function toggleSessionType(st: SessionTypeFilter) {
    setDraft(prev => {
      const next = new Set(prev.sessionTypes);
      if (next.has(st)) next.delete(st);
      else next.add(st);
      return { ...prev, sessionTypes: next };
    });
  }

  function apply() {
    onFiltersChange(draft);
  }

  const allStudentsSelected = draft.studentIds === null;
  const q = query.trim().toLowerCase();
  const visibleStudents = q
    ? students.filter(s => s.full_name.toLowerCase().includes(q))
    : students;

  function isStudentSelected(id: string): boolean {
    return allStudentsSelected || (draft.studentIds?.includes(id) ?? false);
  }

  const selectedCount = draft.studentIds === null ? students.length : draft.studentIds.length;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* Backdrop — tap discards draft */}
      <Pressable
        style={{ flex: 1, backgroundColor: COLORS.scrimSoft }}
        onPress={onClose}
      />

      {/* Sheet */}
      <View
        style={{
          backgroundColor: COLORS.paper,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          paddingHorizontal: 24,
          paddingBottom: insets.bottom + 16,
          maxHeight: '85%',
        }}
      >
        {/* Handle */}
        <View
          style={{
            width: 40,
            height: 4,
            backgroundColor: COLORS.paperEdge,
            borderRadius: 2,
            alignSelf: 'center',
            marginTop: 12,
            marginBottom: 4,
          }}
        />

        {/* Title row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
          <Text style={{ fontFamily: F.serif, fontSize: 20, color: COLORS.ink }}>
            Filters
          </Text>
          <TouchableOpacity
            onPress={apply}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            style={{ minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, alignItems: 'flex-end', justifyContent: 'center' }}
          >
            <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.oxblood }}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={{ marginTop: 4 }} keyboardShouldPersistTaps="handled">
          {/* STUDENTS — searchable multi-select list */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <SectionLabel>Students</SectionLabel>
            <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, marginTop: 20 }}>
              {allStudentsSelected ? 'ALL' : `${selectedCount}/${students.length}`}
            </Text>
          </View>

          {/* Search field */}
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

          {/* "All students" quick toggle */}
          <TouchableOpacity
            onPress={selectAllStudents}
            activeOpacity={0.7}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 11,
              minHeight: MIN_TOUCH,
              marginTop: 6,
              gap: 12,
            }}
          >
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 6,
                borderWidth: 1.5,
                borderColor: allStudentsSelected ? COLORS.ink : COLORS.paperEdge,
                backgroundColor: allStudentsSelected ? COLORS.ink : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {allStudentsSelected ? <Feather name="check" size={13} color={COLORS.paper} /> : null}
            </View>
            <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.ink }}>
              All students
            </Text>
          </TouchableOpacity>

          {/* Scrollable student list */}
          <View
            style={{
              maxHeight: 210,
              borderTopWidth: 1,
              borderTopColor: COLORS.paperEdge,
            }}
          >
            <ScrollView showsVerticalScrollIndicator nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {visibleStudents.map(s => {
                const sel = isStudentSelected(s.id);
                return (
                  <TouchableOpacity
                    key={s.id}
                    onPress={() => toggleStudent(s.id)}
                    activeOpacity={0.7}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 11,
                      minHeight: MIN_TOUCH,
                      borderBottomWidth: 1,
                      borderBottomColor: COLORS.paperEdge,
                      gap: 12,
                    }}
                  >
                    <View
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 6,
                        borderWidth: 1.5,
                        borderColor: sel ? COLORS.ink : COLORS.paperEdge,
                        backgroundColor: sel ? COLORS.ink : 'transparent',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {sel ? <Feather name="check" size={13} color={COLORS.paper} /> : null}
                    </View>
                    <Text style={{ flex: 1, fontFamily: F.sans, fontSize: 15, color: COLORS.ink }} numberOfLines={1}>
                      {s.full_name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {visibleStudents.length === 0 ? (
                <Text
                  style={{
                    fontFamily: F.sans,
                    fontSize: 13,
                    color: COLORS.inkFaint,
                    paddingVertical: 16,
                  }}
                >
                  No students match “{query}”
                </Text>
              ) : null}
            </ScrollView>
          </View>

          {/* EVENT TYPE */}
          <SectionLabel>Event Type</SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {EVENT_KIND_OPTS.map(opt => (
              <Chip
                key={opt.value}
                label={opt.label}
                dotColor={opt.color}
                selected={draft.eventKinds.has(opt.value)}
                onPress={() => toggleKind(opt.value)}
              />
            ))}
          </View>

          {/* SESSION TYPE */}
          <SectionLabel>Session Type</SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
            {SESSION_TYPE_OPTS.map(opt => (
              <Chip
                key={opt.value}
                label={opt.label}
                selected={draft.sessionTypes.has(opt.value)}
                onPress={() => toggleSessionType(opt.value)}
              />
            ))}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
