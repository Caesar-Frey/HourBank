import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { F, MIN_TOUCH } from '../../src/theme/fonts';
import { COLORS } from '../../src/theme/colors';
import { eventKindStyle } from '../../src/theme/eventColors';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { FormScreen } from '../../src/components/FormScreen';
import { useToast } from '../../src/components/Toast';
import { getCalendarEventById, deleteCalendarEvent } from '../../src/db/calendar_events';
import type { CalendarEventRow } from '../../src/db/schema';
import { formatEventWhen } from '../../src/screens/schedule/eventFormModel';

type EventWithStudent = CalendarEventRow & { student_name?: string };

function categoryLabel(cat: string): string {
  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

export default function CalendarEventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [event, setEvent] = useState<EventWithStudent | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const busy = useRef(false);

  // Reload on focus so edits made on the form show when coming back.
  useFocusEffect(
    useCallback(() => {
      busy.current = false;
      try {
        setEvent(getCalendarEventById(id));
        setLoadError(false);
      } catch {
        setEvent(null);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    }, [id]),
  );

  const header = <ScreenHeader backLabel="BACK" onBack={() => router.back()} />;

  if (loading) {
    return (
      <FormScreen header={header}>
        <ActivityIndicator color={COLORS.ink} style={{ marginTop: 60 }} />
      </FormScreen>
    );
  }

  if (!event) {
    return (
      <FormScreen header={header}>
        <Text style={{ fontFamily: F.serif, fontSize: 22, color: COLORS.ink, textAlign: 'center', marginTop: 60 }}>
          {loadError ? 'Couldn’t load this item' : 'Event not found'}
        </Text>
        <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.inkSoft, textAlign: 'center', marginTop: 8 }}>
          {loadError ? 'Go back and try again.' : 'It may have been deleted.'}
        </Text>
      </FormScreen>
    );
  }

  const current = event;
  const style = eventKindStyle(current.kind);
  const noun = current.kind === 'event' ? 'event' : 'time block';

  function edit() {
    if (busy.current) return;
    busy.current = true;
    router.push(`/calendar-event/new?id=${current.id}&kind=${current.kind}` as Href);
  }

  function handleDelete() {
    if (busy.current) return;
    Alert.alert(`Delete this ${noun}?`, `“${current.title}” will be removed from your calendar.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (busy.current) return;
          busy.current = true;
          try {
            deleteCalendarEvent(current.id);
            toast.show({ kind: 'success', message: `${noun.charAt(0).toUpperCase()}${noun.slice(1)} deleted` });
            router.back();
          } catch {
            busy.current = false;
            toast.show({ kind: 'error', message: `Couldn’t delete the ${noun}. Try again.` });
          }
        },
      },
    ]);
  }

  const footer = (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <TouchableOpacity
        onPress={edit}
        activeOpacity={0.8}
        accessibilityRole="button"
        style={{ flex: 1, borderWidth: 1, borderColor: COLORS.ink, borderRadius: 12, minHeight: 50, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.ink }}>Edit</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={handleDelete}
        activeOpacity={0.8}
        accessibilityRole="button"
        style={{ flex: 1, borderWidth: 1, borderColor: COLORS.crimson, borderRadius: 12, minHeight: 50, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.crimson }}>Delete</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <FormScreen header={header} footer={footer}>
      <View
        style={{
          alignSelf: 'flex-start',
          marginTop: 8,
          marginBottom: 12,
          backgroundColor: style.fill,
          borderLeftWidth: 3,
          borderLeftColor: style.fg,
          borderRadius: 6,
          paddingHorizontal: 10,
          paddingVertical: 4,
        }}
      >
        <Text style={{ fontFamily: F.sansMed, fontSize: 11, color: style.fg, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {style.label}
        </Text>
      </View>

      <Text style={{ fontFamily: F.serif, fontSize: 26, color: COLORS.ink, marginBottom: 20 }}>{current.title}</Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Feather name="clock" size={14} color={COLORS.inkFaint} />
        <Text style={{ fontFamily: F.mono, fontSize: 14, color: COLORS.inkSoft, flexShrink: 1 }}>{formatEventWhen(current)}</Text>
      </View>

      {current.student_id && current.student_name ? (
        <TouchableOpacity
          onPress={() => router.push(`/student/${current.student_id}` as Href)}
          activeOpacity={0.7}
          accessibilityRole="link"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: MIN_TOUCH, marginBottom: 8 }}
        >
          <Feather name="user" size={14} color={COLORS.inkFaint} />
          <Text style={{ fontFamily: F.sans, fontSize: 15, color: COLORS.oxblood }}>{current.student_name}</Text>
          <Feather name="chevron-right" size={14} color={COLORS.inkFaint} />
        </TouchableOpacity>
      ) : null}

      {current.category ? (
        <View style={{ alignSelf: 'flex-start', marginBottom: 16, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: COLORS.paperDeep }}>
          <Text style={{ fontFamily: F.sansMed, fontSize: 12, color: COLORS.inkSoft }}>{categoryLabel(current.category)}</Text>
        </View>
      ) : null}

      {current.notes ? (
        <View style={{ marginBottom: 32 }}>
          <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 6 }}>Notes</Text>
          <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.inkSoft, lineHeight: 20 }}>{current.notes}</Text>
        </View>
      ) : null}
    </FormScreen>
  );
}
