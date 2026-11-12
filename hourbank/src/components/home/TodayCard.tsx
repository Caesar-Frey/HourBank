import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { F, MIN_TOUCH } from '../../theme/fonts';
import { COLORS } from '../../theme/colors';
import { formatDuration, formatTimeRange, pluralize } from '../../utils/format';
import type { AgendaItem } from '../../db/sessions';
import { lessonEndIso, type TodaySplit } from './homeLogic';

const EYEBROW = {
  fontFamily: F.mono,
  fontSize: 10,
  color: COLORS.inkFaint,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
} as const;

// ─── Live / paused pill ──────────────────────────────────────────────────────

export function LiveLessonPill({
  lesson,
  elapsedSeconds,
  onPress,
}: {
  lesson: AgendaItem;
  elapsedSeconds: number;
  onPress: () => void;
}) {
  const paused = lesson.status === 'paused';
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${paused ? 'Paused' : 'Live'} lesson with ${lesson.student_full_name}. Open timer.`}
      style={{
        minHeight: 52,
        backgroundColor: COLORS.sessionBg,
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.mono, fontSize: 11, color: paused ? COLORS.amber : COLORS.paper60, letterSpacing: 0.5 }}>
          {paused ? '❚❚ PAUSED' : '● LIVE'}
          <Text style={{ color: COLORS.paper }}>{`  ${formatDuration(elapsedSeconds)}`}</Text>
        </Text>
        <Text numberOfLines={1} style={{ fontFamily: F.serif, fontSize: 16, color: COLORS.paper, marginTop: 2 }}>
          {lesson.student_full_name}
        </Text>
      </View>
      <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: COLORS.paper, marginRight: 6 }}>
        {paused ? 'Resume' : 'Open'}
      </Text>
      <Feather name="arrow-right" size={16} color={COLORS.paper} />
    </TouchableOpacity>
  );
}

// ─── Today card ──────────────────────────────────────────────────────────────

export function TodayCard({
  today,
  starting,
  onStart,
  onOpenLesson,
}: {
  today: TodaySplit;
  /** Session id currently being started (guards double taps). */
  starting: string | null;
  onStart: (lesson: AgendaItem) => void;
  onOpenLesson: (lesson: AgendaItem) => void;
}) {
  const router = useRouter();
  const { next, lessons } = today;
  const rest = next ? lessons.filter(l => l.id !== next.id) : lessons;
  const count = lessons.length;

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: COLORS.paperEdge,
        borderRadius: 16,
        backgroundColor: COLORS.cardFill,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <Text style={[EYEBROW, { marginBottom: 10 }]}>
        {count > 0 ? `Today · ${count} ${pluralize(count, 'lesson')} left` : 'Today'}
      </Text>

      {next ? (
        <View>
          <TouchableOpacity
            onPress={() => onOpenLesson(next)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Next lesson with ${next.student_full_name}. Open details.`}
            style={{ minHeight: MIN_TOUCH, marginBottom: 12 }}
          >
            <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.oxblood }}>
              {`NEXT · ${formatTimeRange(next.scheduled_for!, lessonEndIso(next))}`}
            </Text>
            <Text numberOfLines={1} style={{ fontFamily: F.serif, fontSize: 22, color: COLORS.ink, marginTop: 2 }}>
              {next.student_full_name}
            </Text>
            <Text numberOfLines={1} style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft, marginTop: 2 }}>
              {`${next.subject_name || next.student_subject} · ${next.mode === 'in_person' ? 'In-person' : 'Online'}`}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push(`/student/${next.student_id}/log-past?sessionId=${next.id}` as Href)}
            disabled={starting !== null}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Record lesson with ${next.student_full_name}`}
            style={{
              minHeight: 52,
              backgroundColor: COLORS.oxblood,
              borderRadius: 14,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              opacity: starting !== null ? 0.6 : 1,
            }}
          >
            <Feather name="check" size={18} color={COLORS.paper} />
            <Text style={{ fontFamily: F.sansMed, fontSize: 16, color: COLORS.paper }}>Record lesson</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onStart(next)}
            disabled={starting !== null}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Start timer for ${next.student_full_name}`}
            style={{
              minHeight: MIN_TOUCH,
              marginTop: 8,
              borderWidth: 1,
              borderColor: COLORS.ink,
              borderRadius: 14,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              opacity: starting !== null ? 0.6 : 1,
            }}
          >
            {starting === next.id ? (
              <ActivityIndicator color={COLORS.ink} />
            ) : (
              <Feather name="play" size={15} color={COLORS.ink} />
            )}
            <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.ink }}>Start timer</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={{ fontFamily: F.serifItalic, fontSize: 16, color: COLORS.inkSoft, marginBottom: 4 }}>
          No more lessons booked today.
        </Text>
      )}

      {rest.length > 0 && (
        <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: COLORS.paperEdge }}>
          {rest.map(l => (
            <TouchableOpacity
              key={l.id}
              onPress={() => onOpenLesson(l)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Lesson with ${l.student_full_name}`}
              style={{
                minHeight: MIN_TOUCH,
                flexDirection: 'row',
                alignItems: 'center',
                borderBottomWidth: 1,
                borderBottomColor: COLORS.paperEdge,
                paddingVertical: 8,
              }}
            >
              <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkSoft, width: 96 }}>
                {formatTimeRange(l.scheduled_for!, lessonEndIso(l))}
              </Text>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.serif, fontSize: 15, color: COLORS.ink }}>
                {l.student_full_name}
              </Text>
              <Feather name="chevron-right" size={16} color={COLORS.inkFaint} />
            </TouchableOpacity>
          ))}
        </View>
      )}

    </View>
  );
}
