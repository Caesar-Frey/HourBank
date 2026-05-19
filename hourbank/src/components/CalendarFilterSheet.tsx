import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../theme/colors';
import { F } from '../theme/fonts';
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

const EVENT_KIND_OPTS: { value: EventKind; label: string }[] = [
  { value: 'scheduled',  label: 'Scheduled' },
  { value: 'completed',  label: 'Completed' },
  { value: 'cancelled',  label: 'Cancelled' },
  { value: 'top_up',     label: 'Top-up' },
  { value: 'event',      label: 'Events' },
  { value: 'time_block', label: 'Blocks' },
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
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={{
        backgroundColor: selected ? COLORS.ink : 'transparent',
        borderWidth: 1,
        borderColor: selected ? COLORS.ink : COLORS.paperEdge,
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 7,
        marginRight: 8,
        marginBottom: 8,
      }}
    >
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

  // ── Handlers ──────────────────────────────────────────────────────────────

  function toggleStudent(id: string) {
    if (filters.studentIds === null) {
      // Was "all" — now exclude this one student (select all others)
      const others = students.map(s => s.id).filter(sid => sid !== id);
      onFiltersChange({ ...filters, studentIds: others });
    } else {
      const next = filters.studentIds.includes(id)
        ? filters.studentIds.filter(s => s !== id)
        : [...filters.studentIds, id];
      // If all selected or none selected, revert to null (null = all)
      onFiltersChange({
        ...filters,
        studentIds: (next.length === students.length || next.length === 0) ? null : next,
      });
    }
  }

  function toggleAllStudents() {
    onFiltersChange({ ...filters, studentIds: null });
  }

  function toggleKind(kind: EventKind) {
    const next = new Set(filters.eventKinds);
    if (next.has(kind)) {
      next.delete(kind);
    } else {
      next.add(kind);
    }
    onFiltersChange({ ...filters, eventKinds: next });
  }

  function toggleSessionType(st: SessionTypeFilter) {
    const next = new Set(filters.sessionTypes);
    if (next.has(st)) {
      next.delete(st);
    } else {
      next.add(st);
    }
    onFiltersChange({ ...filters, sessionTypes: next });
  }

  const allStudentsSelected = filters.studentIds === null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* Backdrop */}
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }}
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
          maxHeight: '80%',
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
          <TouchableOpacity onPress={onClose} activeOpacity={0.7}>
            <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.oxblood }}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={{ marginTop: 4 }}>
          {/* STUDENTS */}
          <SectionLabel>Students</SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Chip label="All" selected={allStudentsSelected} onPress={toggleAllStudents} />
            {students.map(s => (
              <Chip
                key={s.id}
                label={s.full_name.trim().split(/\s+/)[0]}
                selected={allStudentsSelected || (filters.studentIds?.includes(s.id) ?? false)}
                onPress={() => toggleStudent(s.id)}
              />
            ))}
          </View>

          {/* EVENT TYPE */}
          <SectionLabel>Event Type</SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {EVENT_KIND_OPTS.map(opt => (
              <Chip
                key={opt.value}
                label={opt.label}
                selected={filters.eventKinds.has(opt.value)}
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
                selected={filters.sessionTypes.has(opt.value)}
                onPress={() => toggleSessionType(opt.value)}
              />
            ))}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
