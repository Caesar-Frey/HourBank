import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { F } from '../../src/theme/fonts';
import { COLORS } from '../../src/theme/colors';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { getCalendarEventById, deleteCalendarEvent } from '../../src/db/calendar_events';
import type { CalendarEventRow } from '../../src/db/schema';

type EventWithStudent = CalendarEventRow & { student_name?: string };

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateRange(event: EventWithStudent): string {
  const start = new Date(event.starts_at);
  const dayName = DAY_SHORT[start.getDay()];
  const date = start.getDate();
  const month = MONTH_SHORT[start.getMonth()];

  if (event.all_day) {
    return `All day · ${dayName} ${date} ${month}`;
  }

  const hh = String(start.getHours()).padStart(2, '0');
  const mm = String(start.getMinutes()).padStart(2, '0');
  let timeStr = `${hh}:${mm}`;

  if (event.ends_at) {
    const end = new Date(event.ends_at);
    const ehh = String(end.getHours()).padStart(2, '0');
    const emm = String(end.getMinutes()).padStart(2, '0');
    timeStr += ` – ${ehh}:${emm}`;
  }

  return `${dayName} ${date} ${month}, ${timeStr}`;
}

function categoryLabel(cat: string): string {
  switch (cat) {
    case 'test':     return 'Test';
    case 'exam':     return 'Exam';
    case 'homework': return 'Homework';
    case 'other':    return 'Other';
    default:         return cat;
  }
}

export default function CalendarEventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<EventWithStudent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const result = getCalendarEventById(id);
      setEvent(result);
    } catch {
      setEvent(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.paper, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.ink} />
      </View>
    );
  }

  if (!event) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
        <ScreenHeader backLabel="BACK" onBack={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <Text style={{ fontFamily: F.serif, fontSize: 22, color: COLORS.ink }}>
            Event not found
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const isEvent = event.kind === 'event';
  const kindColor = isEvent ? COLORS.oxblood : COLORS.inkFaint;
  const kindLabel = isEvent ? 'EVENT' : 'BLOCK';

  function handleDelete() {
    Alert.alert(
      `Delete ${kindLabel.toLowerCase()}?`,
      `"${event!.title}" will be permanently removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            try {
              deleteCalendarEvent(id);
            } catch {
              // ignore
            }
            router.back();
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
      <ScreenHeader backLabel="BACK" onBack={() => router.back()} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Kind badge */}
        <View style={{ alignSelf: 'flex-start', marginBottom: 12 }}>
          <View style={{
            borderWidth: 1,
            borderColor: kindColor,
            borderRadius: 999,
            paddingHorizontal: 12,
            paddingVertical: 4,
          }}>
            <Text style={{ fontFamily: F.sansMed, fontSize: 11, color: kindColor }}>
              {kindLabel}
            </Text>
          </View>
        </View>

        {/* Title */}
        <Text style={{ fontFamily: F.serif, fontSize: 26, color: COLORS.ink, marginBottom: 20 }}>
          {event.title}
        </Text>

        {/* Student name (if set) */}
        {event.student_id && event.student_name && (
          <TouchableOpacity
            onPress={() => router.push(`/student/${event!.student_id}` as Href)}
            activeOpacity={0.7}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 }}
          >
            <Feather name="user" size={14} color={COLORS.inkFaint} />
            <Text style={{ fontFamily: F.sans, fontSize: 15, color: COLORS.oxblood }}>
              {event.student_name}
            </Text>
            <Feather name="chevron-right" size={14} color={COLORS.inkFaint} />
          </TouchableOpacity>
        )}

        {/* Category chip */}
        {event.category && (
          <View style={{ alignSelf: 'flex-start', marginBottom: 16 }}>
            <View style={{
              backgroundColor: COLORS.warnFill,
              borderRadius: 999,
              paddingHorizontal: 12,
              paddingVertical: 4,
            }}>
              <Text style={{ fontFamily: F.sansMed, fontSize: 12, color: COLORS.amber }}>
                {categoryLabel(event.category)}
              </Text>
            </View>
          </View>
        )}

        {/* Date/time */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Feather name="clock" size={14} color={COLORS.inkFaint} />
          <Text style={{ fontFamily: F.mono, fontSize: 14, color: COLORS.inkSoft }}>
            {formatDateRange(event)}
          </Text>
        </View>

        {/* Notes */}
        {event.notes ? (
          <View style={{ marginBottom: 32 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 6 }}>
              Notes
            </Text>
            <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.inkFaint, lineHeight: 20 }}>
              {event.notes}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Edit / Delete buttons */}
      <View style={{
        flexDirection: 'row',
        gap: 12,
        paddingHorizontal: 24,
        paddingBottom: 32,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: COLORS.paperEdge,
        backgroundColor: COLORS.paper,
      }}>
        <TouchableOpacity
          onPress={() => router.push(`/calendar-event/new?id=${event.id}&kind=${event.kind}` as Href)}
          activeOpacity={0.8}
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: COLORS.ink,
            borderRadius: 12,
            paddingVertical: 14,
            alignItems: 'center',
          }}
        >
          <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.ink }}>
            Edit
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleDelete}
          activeOpacity={0.8}
          style={{
            flex: 1,
            backgroundColor: COLORS.crimson,
            borderRadius: 12,
            paddingVertical: 14,
            alignItems: 'center',
          }}
        >
          <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.paper }}>
            Delete
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
