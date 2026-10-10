/**
 * Agenda segment of the Schedule tab (replaces the old Sessions tab).
 * Sections: In progress / Overdue / Today / Upcoming. Every booked row opens
 * the lesson hub (/lesson/[id]) where Start / Log as taught / No-show /
 * Reschedule / Cancel live; a running lesson opens its live timer.
 */
import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { COLORS } from '../../theme/colors';
import { F, MIN_TOUCH } from '../../theme/fonts';
import { EVENT_KIND_COLORS } from '../../theme/eventColors';
import { Agenda, AgendaItem, listAgenda } from '../../db/sessions';
import { listActiveStudents, listPausedStudents } from '../../db/students';
import { formatDayShort, formatHours, formatMinutes } from '../../utils/format';
import {
  AgendaSectionKey,
  agendaIsEmpty,
  agendaSections,
  agendaTimeLabel,
  bookedMinutes,
  owedAfter,
  projectAgendaBalances,
} from './agendaModel';
import { modeLabel, sessionTypeLabel } from './labels';

const EMPTY: Agenda = { inProgress: [], overdue: [], today: [], upcoming: [] };

function rowStyleKey(section: AgendaSectionKey) {
  if (section === 'inProgress') return EVENT_KIND_COLORS.active;
  if (section === 'overdue') return EVENT_KIND_COLORS.overdue;
  return EVENT_KIND_COLORS.scheduled;
}

function AgendaRow({
  item,
  section,
  projected,
  onPress,
}: {
  item: AgendaItem;
  section: AgendaSectionKey;
  projected: number | undefined;
  onPress: () => void;
}) {
  const style = rowStyleKey(section);
  const owes = section === 'inProgress' ? null : owedAfter(projected);
  const live = section === 'inProgress';
  const dateLabel =
    section === 'upcoming' || section === 'overdue'
      ? item.scheduled_for
        ? formatDayShort(item.scheduled_for)
        : ''
      : '';
  const details = [sessionTypeLabel(item.session_type), modeLabel(item.mode), `${formatMinutes(bookedMinutes(item))} booked`];

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityHint={live ? 'Opens the live lesson' : 'Opens lesson actions'}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: live ? COLORS.sessionBg : style.fill,
        borderLeftWidth: 3,
        borderLeftColor: live ? COLORS.oxblood : style.fg,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 12,
        marginBottom: 8,
        minHeight: MIN_TOUCH + 12,
        gap: 12,
      }}
    >
      <View style={{ width: 92 }}>
        {dateLabel ? (
          <Text style={{ fontFamily: F.mono, fontSize: 10, color: live ? COLORS.paper60 : COLORS.inkSoft, textTransform: 'uppercase' }}>
            {dateLabel}
          </Text>
        ) : null}
        <Text style={{ fontFamily: F.monoMed, fontSize: 12, color: live ? COLORS.paper : style.fg }} numberOfLines={2}>
          {agendaTimeLabel(item)}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: F.serif, fontSize: 16, color: live ? COLORS.paper : COLORS.ink }}>
          {item.student_full_name}
        </Text>
        <Text numberOfLines={1} style={{ fontFamily: F.mono, fontSize: 11, color: live ? COLORS.paper60 : COLORS.inkSoft, marginTop: 2 }}>
          {details.join(' · ')}
        </Text>
        {section === 'overdue' ? (
          <Text style={{ fontFamily: F.sansMed, fontSize: 12, color: COLORS.oxblood, marginTop: 3 }}>
            Not started — log it, mark a no-show, or reschedule
          </Text>
        ) : null}
        {owes != null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
            <Feather name="alert-triangle" size={11} color={COLORS.crimson} />
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.crimson }}>
              will owe {formatHours(owes)}
            </Text>
          </View>
        ) : null}
      </View>
      <Feather name="chevron-right" size={16} color={live ? COLORS.paper60 : COLORS.inkFaint} />
    </TouchableOpacity>
  );
}

export function AgendaView({ onStartLesson }: { onStartLesson: () => void }) {
  const router = useRouter();
  const [agenda, setAgenda] = useState<Agenda>(EMPTY);
  const [projection, setProjection] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const navigating = useRef(false);

  const load = useCallback(() => {
    try {
      const a = listAgenda();
      const balances: Record<string, number> = {};
      for (const s of [...listActiveStudents(), ...listPausedStudents()]) balances[s.id] = s.current_balance;
      setAgenda(a);
      setProjection(projectAgendaBalances(a, balances));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      navigating.current = false;
      load();
    }, [load]),
  );

  function open(item: AgendaItem) {
    if (navigating.current) return;
    navigating.current = true;
    const live = item.status === 'active' || item.status === 'paused';
    router.push((live ? `/student/${item.student_id}/session?sessionId=${item.id}` : `/lesson/${item.id}`) as Href);
  }

  if (error) {
    return (
      <View style={{ alignItems: 'center', padding: 32, gap: 10 }}>
        <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.crimson }}>Couldn’t load your lessons.</Text>
        <TouchableOpacity onPress={load} accessibilityRole="button" style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.oxblood }}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const sections = agendaSections(agenda);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40 }}
      showsVerticalScrollIndicator={false}
    >
      {loaded && agendaIsEmpty(agenda) ? (
        <View style={{ alignItems: 'center', paddingVertical: 40, gap: 14 }}>
          <Text style={{ fontFamily: F.serifItalic, fontSize: 16, color: COLORS.inkSoft, textAlign: 'center' }}>
            No lessons booked.
          </Text>
          <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkFaint, textAlign: 'center' }}>
            Book one from a student’s page or the calendar, or start one now.
          </Text>
          <TouchableOpacity
            onPress={onStartLesson}
            activeOpacity={0.85}
            accessibilityRole="button"
            style={{
              minHeight: MIN_TOUCH,
              paddingHorizontal: 18,
              borderRadius: 12,
              backgroundColor: COLORS.oxblood,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Feather name="play" size={14} color={COLORS.paper} />
            <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.paper }}>Start a lesson</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {sections.map(section => (
        <View key={section.key} style={{ marginTop: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                color: section.key === 'overdue' ? COLORS.oxblood : COLORS.inkSoft,
                textTransform: 'uppercase',
                letterSpacing: 0.6,
              }}
            >
              {section.title}
            </Text>
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint }}>{section.items.length}</Text>
          </View>
          {section.items.map(item => (
            <AgendaRow
              key={item.id}
              item={item}
              section={section.key}
              projected={projection[item.id]}
              onPress={() => open(item)}
            />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
