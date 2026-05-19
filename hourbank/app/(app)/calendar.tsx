import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, type Href } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { F } from '../../src/theme/fonts';
import { COLORS } from '../../src/theme/colors';
import { CalendarEvent, CalendarFilters, EventKind, SessionTypeFilter, listEventsInRange, eventTime, defaultFilters } from '../../src/db/calendar';
import { CalendarFilterSheet } from '../../src/components/CalendarFilterSheet';
import { ActionSheet } from '../../src/components/ActionSheet';
import { useStudents } from '../../src/hooks/useStudents';

const STORAGE_KEY = '@hourbank/calendar_filters';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const SHORT_MONTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_ABBREVS = ['Mo','Tu','We','Th','Fr','Sa','Su'];

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

/** Monday of the week containing d */
function weekStart(d: Date): Date {
  const r = new Date(d);
  const dow = r.getDay(); // 0=Sun
  const diff = (dow === 0 ? -6 : 1 - dow);
  r.setDate(r.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function weekEnd(d: Date): Date {
  const ws = weekStart(d);
  const r = new Date(ws);
  r.setDate(r.getDate() + 6);
  r.setHours(23, 59, 59, 999);
  return r;
}

function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function monthEnd(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

function localMidnight(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function serializeFilters(f: CalendarFilters): string {
  return JSON.stringify({
    studentIds: f.studentIds,
    eventKinds: Array.from(f.eventKinds),
    sessionTypes: Array.from(f.sessionTypes),
  });
}

function deserializeFilters(json: string): CalendarFilters {
  const raw = JSON.parse(json);
  // B4: treat [] same as null (null = all students)
  const ids: string[] | null = raw.studentIds ?? null;
  return {
    studentIds: Array.isArray(ids) && ids.length === 0 ? null : ids,
    eventKinds: new Set<EventKind>(raw.eventKinds ?? ['scheduled','completed','cancelled','top_up']),
    sessionTypes: new Set<SessionTypeFilter>(raw.sessionTypes ?? ['general','review','test_prep','exam_prep']),
  };
}

// ─── Dot/pill colours per kind ───────────────────────────────────────────────

function kindColor(kind: CalendarEvent['kind']): string {
  switch (kind) {
    case 'session_scheduled': return COLORS.amber;
    case 'session_completed': return COLORS.moss;
    case 'session_cancelled': return COLORS.crimson;
    case 'top_up':            return COLORS.moss;
    case 'event':             return COLORS.amber;
    case 'time_block':        return COLORS.inkFaint;
  }
}

function kindBg(kind: CalendarEvent['kind']): string {
  switch (kind) {
    case 'session_scheduled': return COLORS.warnFill;
    case 'session_completed': return COLORS.okFill;
    case 'session_cancelled': return COLORS.badFill;
    case 'top_up':            return COLORS.goodFill;
    case 'event':             return COLORS.warnFill;
    case 'time_block':        return COLORS.paperEdge;
  }
}

function kindIcon(kind: CalendarEvent['kind']): React.ComponentProps<typeof Feather>['name'] {
  switch (kind) {
    case 'session_scheduled': return 'clock';
    case 'session_completed': return 'check-circle';
    case 'session_cancelled': return 'x-circle';
    case 'top_up':            return 'plus-circle';
    case 'event':             return 'calendar';
    case 'time_block':        return 'lock';
  }
}

// ─── CalendarEventPill ────────────────────────────────────────────────────────

interface PillProps {
  event: CalendarEvent;
  onPress: () => void;
}

function formatDurationMin(min: number): string {
  if (min <= 0) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function CalendarEventPill({ event, onPress }: PillProps) {
  const color = kindColor(event.kind);
  const bg = kindBg(event.kind);
  const icon = kindIcon(event.kind);
  const studentName = 'studentName' in event ? event.studentName : undefined;

  let suffix = '';
  if (
    (event.kind === 'session_scheduled' || event.kind === 'session_completed') &&
    event.durationMin > 0
  ) {
    suffix = ` · ${formatDurationMin(event.durationMin)}`;
  } else if (event.kind === 'top_up' && event.paymentMethod) {
    suffix = ` · ${event.paymentMethod.toUpperCase()}`;
  }

  const sessionType =
    (event.kind === 'session_scheduled' || event.kind === 'session_completed' || event.kind === 'session_cancelled')
      ? (event.sessionType !== 'general' ? event.sessionType.replace('_', ' ') : null)
      : null;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: bg,
        borderLeftWidth: 3,
        borderLeftColor: color,
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 6,
        marginBottom: 4,
        gap: 6,
      }}
    >
      <Feather name={icon} size={13} color={color} />
      <View style={{ flex: 1 }}>
        <Text
          style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.ink }}
          numberOfLines={1}
        >
          {studentName}
        </Text>
        {(sessionType || suffix) ? (
          <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint }} numberOfLines={1}>
            {sessionType ?? ''}{suffix}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// ─── Month View ───────────────────────────────────────────────────────────────

interface MonthViewProps {
  cursor: Date;
  events: CalendarEvent[];
  gridStart: Date;
  gridEnd: Date;
  onDayPress: (d: Date) => void;
}

function MonthView({ cursor, events, gridStart, gridEnd, onDayPress }: MonthViewProps) {
  const today = new Date();

  // Group events by YYYY-MM-DD
  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const key = isoDate(new Date(eventTime(e)));
    const arr = byDate.get(key) ?? [];
    arr.push(e);
    byDate.set(key, arr);
  }

  // Build grid from the same gridStart/gridEnd used for fetching
  const days: Date[] = [];
  let d = new Date(gridStart);
  while (d <= gridEnd) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }

  return (
    <View style={{ flex: 1, paddingHorizontal: 8 }}>
      {/* Day-of-week header */}
      <View style={{ flexDirection: 'row', marginBottom: 4 }}>
        {DAY_ABBREVS.map(abbr => (
          <View key={abbr} style={{ flex: 1, alignItems: 'center', paddingVertical: 4 }}>
            <Text style={{ fontFamily: F.sansMed, fontSize: 11, color: COLORS.inkFaint }}>
              {abbr}
            </Text>
          </View>
        ))}
      </View>

      {/* Calendar grid */}
      <ScrollView showsVerticalScrollIndicator={false}>
        {Array.from({ length: days.length / 7 }, (_, week) => (
          <View key={week} style={{ flexDirection: 'row' }}>
            {days.slice(week * 7, week * 7 + 7).map((day) => {
              const inMonth = day.getMonth() === cursor.getMonth();
              const isToday = sameDay(day, today);
              const key = isoDate(day);
              const dayEvents = byDate.get(key) ?? [];
              const dots = dayEvents.slice(0, 3);
              const extra = dayEvents.length - 3;

              return (
                <TouchableOpacity
                  key={key}
                  onPress={() => onDayPress(day)}
                  activeOpacity={0.7}
                  style={{ flex: 1, alignItems: 'center', paddingVertical: 6, minHeight: 52 }}
                >
                  <View
                    style={isToday ? {
                      width: 26,
                      height: 26,
                      borderRadius: 13,
                      backgroundColor: COLORS.oxblood,
                      alignItems: 'center',
                      justifyContent: 'center',
                    } : { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text
                      style={{
                        fontFamily: F.mono,
                        fontSize: 13,
                        color: isToday ? COLORS.paper : inMonth ? COLORS.ink : COLORS.inkFaint,
                      }}
                    >
                      {day.getDate()}
                    </Text>
                  </View>
                  {/* Event dots + overflow */}
                  <View style={{ flexDirection: 'row', gap: 2, marginTop: 2, height: 10, alignItems: 'center' }}>
                    {dots.map((e, i) => (
                      <View
                        key={i}
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: 3,
                          backgroundColor: kindColor(e.kind),
                        }}
                      />
                    ))}
                    {extra > 0 && (
                      <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint }}>
                        +{extra}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}

        {/* B7 — empty state */}
        {events.length === 0 && (
          <View style={{ alignItems: 'center', paddingTop: 12 }}>
            <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.inkFaint }}>
              Nothing scheduled this month
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Week View ────────────────────────────────────────────────────────────────

interface WeekViewProps {
  cursor: Date;
  events: CalendarEvent[];
  onDayPress: (d: Date) => void;
  onEventPress: (e: CalendarEvent) => void;
}

function WeekView({ cursor, events, onDayPress, onEventPress }: WeekViewProps) {
  const today = new Date();
  const ws = weekStart(cursor);
  const days: Date[] = Array.from({ length: 7 }, (_, i) => addDays(ws, i));

  // Group by date
  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const key = isoDate(new Date(eventTime(e)));
    const arr = byDate.get(key) ?? [];
    arr.push(e);
    byDate.set(key, arr);
  }

  const DAY_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  const hasAnyEvents = events.length > 0;

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', flex: 1, minHeight: 400 }}>
        {days.map((day, i) => {
          const key = isoDate(day);
          const dayEvents = byDate.get(key) ?? [];
          const overflow = dayEvents.length > 3 ? dayEvents.length - 3 : 0;
          const shown = dayEvents.slice(0, 3);
          const isToday = sameDay(day, today);
          const isCursor = sameDay(day, cursor);

          return (
            <View
              key={key}
              style={{
                flex: 1,
                borderRightWidth: i < 6 ? 1 : 0,
                borderRightColor: COLORS.paperEdge,
                paddingHorizontal: 2,
              }}
            >
              {/* Column header */}
              <TouchableOpacity
                onPress={() => onDayPress(day)}
                activeOpacity={0.7}
                style={{
                  alignItems: 'center',
                  paddingVertical: 8,
                  marginBottom: 8,
                  backgroundColor: isToday || isCursor ? COLORS.paperDeep : 'transparent',
                  borderRadius: 8,
                }}
              >
                <Text style={{ fontFamily: F.sansMed, fontSize: 10, color: COLORS.inkFaint }}>
                  {DAY_SHORT[i]}
                </Text>
                <Text
                  style={{
                    fontFamily: F.mono,
                    fontSize: 14,
                    color: isToday ? COLORS.oxblood : COLORS.ink,
                  }}
                >
                  {day.getDate()}
                </Text>
              </TouchableOpacity>

              {/* Events */}
              {shown.map((e) => (
                <CalendarEventPill
                  key={e.kind === 'top_up' ? e.ledgerEntryId : e.id}
                  event={e}
                  onPress={() => onEventPress(e)}
                />
              ))}
              {overflow > 0 && (
                <TouchableOpacity onPress={() => onDayPress(day)} activeOpacity={0.7}>
                  <Text style={{ fontFamily: F.sans, fontSize: 11, color: COLORS.inkFaint, marginTop: 2 }}>
                    +{overflow} more
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>

      {/* B7 — empty state */}
      {!hasAnyEvents && (
        <View style={{ alignItems: 'center', paddingTop: 12 }}>
          <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.inkFaint }}>
            Nothing scheduled this week
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

// ─── Day View ─────────────────────────────────────────────────────────────────

interface DayViewProps {
  events: CalendarEvent[];
  onEventPress: (e: CalendarEvent) => void;
}

function DayView({ events, onEventPress }: DayViewProps) {
  if (events.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 }}>
        <Text style={{ fontFamily: F.sans, fontSize: 15, color: COLORS.inkFaint }}>
          No events today
        </Text>
      </View>
    );
  }

  // Separate all-day calendar events from timed events
  const allDayEvents = events.filter(
    e => (e.kind === 'event' || e.kind === 'time_block') && e.allDay
  );
  const timedEvents = events.filter(
    e => !((e.kind === 'event' || e.kind === 'time_block') && e.allDay)
  );
  const orderedEvents = [...allDayEvents, ...timedEvents];

  return (
    <FlatList
      data={orderedEvents}
      keyExtractor={(e) => (e.kind === 'top_up' ? e.ledgerEntryId : e.id)}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 }}
      ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: COLORS.paperEdge, marginVertical: 4 }} />}
      renderItem={({ item: e }) => {
        const isAllDay = (e.kind === 'event' || e.kind === 'time_block') && e.allDay;
        const time = isAllDay ? 'All day' : formatTime(eventTime(e));
        const icon = kindIcon(e.kind);
        const color = kindColor(e.kind);
        const kindLabel =
          e.kind === 'session_scheduled' ? 'Scheduled' :
          e.kind === 'session_completed' ? 'Completed' :
          e.kind === 'session_cancelled' ? 'Cancelled' :
          e.kind === 'event' ? 'Event' :
          e.kind === 'time_block' ? 'Blocked' : 'Top-up';
        const displayName = 'studentName' in e ? e.studentName :
          ('title' in e ? e.title : undefined);

        return (
          <TouchableOpacity
            onPress={() => onEventPress(e)}
            activeOpacity={0.75}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 }}
          >
            {isAllDay ? (
              <Feather name={icon} size={16} color={color} style={{ width: 42 }} />
            ) : (
              <>
                <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.inkFaint, width: 42 }}>
                  {time}
                </Text>
                <Feather name={icon} size={16} color={color} />
              </>
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.ink }}>
                {displayName}
              </Text>
              <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint }}>
                {isAllDay ? 'All day' : kindLabel}
                {(e.kind === 'session_scheduled' || e.kind === 'session_completed' || e.kind === 'session_cancelled') && e.sessionType !== 'general'
                  ? ` · ${e.sessionType.replace('_', ' ')}`
                  : ''}
                {(e.kind === 'session_scheduled' || e.kind === 'session_completed') && e.durationMin > 0
                  ? ` · ${formatDurationMin(e.durationMin)}`
                  : ''}
                {e.kind === 'top_up' && e.paymentMethod
                  ? ` · ${e.paymentMethod.toUpperCase()}`
                  : ''}
              </Text>
            </View>
          </TouchableOpacity>
        );
      }}
    />
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function CalendarScreen() {
  const router = useRouter();
  const { students } = useStudents();

  const [view, setView] = useState<'month' | 'week' | 'day'>('month');
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [filters, setFilters] = useState<CalendarFilters>(defaultFilters());
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [showStudentPicker, setShowStudentPicker] = useState(false);
  const [showFabSheet, setShowFabSheet] = useState(false);

  // B5: Load persisted filters on mount, mark loaded after
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (raw) {
        try { setFilters(deserializeFilters(raw)); } catch { /* ignore */ }
      }
      setFiltersLoaded(true);
    });
  }, []);

  // Persist on filter change
  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, serializeFilters(filters)).catch(() => {});
  }, [filters]);

  // B1: grid bounds for month view (shared between fetch and MonthView render)
  const monthGrid = React.useMemo(() => {
    const ms = monthStart(cursor);
    const me = monthEnd(cursor);
    return {
      gridStart: weekStart(ms),
      gridEnd: weekEnd(me),
    };
  }, [cursor]);

  // B1 + B5: Fetch events when cursor / view / filters change (skip until filters loaded)
  const fetchEvents = useCallback(() => {
    if (!filtersLoaded) return;

    let startISO: string;
    let endISO: string;

    if (view === 'month') {
      // Use the full Mon–Sun grid that MonthView renders
      startISO = localMidnight(monthGrid.gridStart).toISOString();
      endISO = localMidnight(addDays(monthGrid.gridEnd, 1)).toISOString();
    } else if (view === 'week') {
      const ws = weekStart(cursor);
      startISO = localMidnight(ws).toISOString();
      endISO = localMidnight(addDays(ws, 7)).toISOString();
    } else {
      startISO = localMidnight(cursor).toISOString();
      endISO = localMidnight(addDays(cursor, 1)).toISOString();
    }

    try {
      const fetched = listEventsInRange(startISO, endISO, filters);
      setEvents(fetched);
    } catch (e) {
      console.error('listEventsInRange error', e);
      setEvents([]);
    }
  }, [cursor, view, filters, filtersLoaded, monthGrid]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Reload events when navigating back from create/edit screens
  useFocusEffect(useCallback(() => { fetchEvents(); }, [fetchEvents]));

  // ── Navigation ──────────────────────────────────────────────────────────────

  function navigateEvent(e: CalendarEvent) {
    if (e.kind === 'session_scheduled') {
      router.push(`/student/${e.studentId}/session?sessionId=${e.id}` as Href);
    } else if (e.kind === 'session_completed' || e.kind === 'session_cancelled') {
      router.push(`/lesson/${e.id}` as Href);
    } else if (e.kind === 'top_up') {
      router.push(`/transaction/${e.ledgerEntryId}` as Href);
    } else if (e.kind === 'event' || e.kind === 'time_block') {
      router.push(`/calendar-event/${e.id}` as Href);
    }
  }

  function moveCursor(delta: number) {
    if (view === 'month') {
      setCursor(prev => addMonths(prev, delta));
    } else if (view === 'week') {
      setCursor(prev => addDays(prev, delta * 7));
    } else {
      setCursor(prev => addDays(prev, delta));
    }
  }

  // ── Header title ─────────────────────────────────────────────────────────────

  function headerTitle(): string {
    if (view === 'month') {
      return `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`;
    } else if (view === 'week') {
      const ws = weekStart(cursor);
      const we = weekEnd(cursor);
      if (ws.getMonth() === we.getMonth()) {
        return `${ws.getDate()}–${we.getDate()} ${SHORT_MONTH[ws.getMonth()]}`;
      }
      return `${ws.getDate()} ${SHORT_MONTH[ws.getMonth()]}–${we.getDate()} ${SHORT_MONTH[we.getMonth()]}`;
    } else {
      const dayName = cursor.toLocaleDateString('en-ZA', { weekday: 'long' });
      const dayNum = cursor.getDate();
      const mon = SHORT_MONTH[cursor.getMonth()];
      return `${dayName}, ${dayNum} ${mon}`;
    }
  }

  // B6: is cursor on today?
  const isToday = sameDay(cursor, new Date());

  // ── Student picker confirm ────────────────────────────────────────────────────

  function pickStudent(studentId: string) {
    setShowStudentPicker(false);
    const dateStr = isoDate(cursor);
    router.push(`/student/${studentId}/schedule?date=${dateStr}` as Href);
  }

  // ── FAB date helper ──────────────────────────────────────────────────────────

  const dateForFab = view === 'day' ? cursor.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

  // ── Day press from month/week ─────────────────────────────────────────────────

  function handleDayPress(day: Date) {
    setCursor(day);
    setView('day');
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>

      {/* Header */}
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.paperEdge,
      }}>
        <TouchableOpacity
          onPress={() => moveCursor(-1)}
          activeOpacity={0.7}
          style={{ padding: 4 }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="chevron-left" size={22} color={COLORS.ink} />
        </TouchableOpacity>

        <Text style={{
          flex: 1,
          textAlign: 'center',
          fontFamily: F.serif,
          fontSize: 18,
          color: COLORS.ink,
        }}>
          {headerTitle()}
        </Text>

        {!isToday && (
          <TouchableOpacity
            onPress={() => setCursor(new Date())}
            activeOpacity={0.7}
            style={{ padding: 4, marginRight: 4 }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: COLORS.oxblood }}>
              Today
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={() => setShowFilters(true)}
          activeOpacity={0.7}
          style={{ padding: 4, marginRight: 8 }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="sliders" size={20} color={COLORS.ink} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => moveCursor(1)}
          activeOpacity={0.7}
          style={{ padding: 4 }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="chevron-right" size={22} color={COLORS.ink} />
        </TouchableOpacity>
      </View>

      {/* Segmented control */}
      <View style={{
        flexDirection: 'row',
        marginHorizontal: 16,
        marginVertical: 10,
        backgroundColor: COLORS.paperDeep,
        borderRadius: 12,
        padding: 3,
        gap: 2,
      }}>
        {(['month', 'week', 'day'] as const).map(v => (
          <TouchableOpacity
            key={v}
            onPress={() => setView(v)}
            activeOpacity={0.75}
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: 7,
              borderRadius: 10,
              backgroundColor: view === v ? COLORS.ink : 'transparent',
            }}
          >
            <Text style={{
              fontFamily: F.sansMed,
              fontSize: 12,
              color: view === v ? COLORS.paper : COLORS.inkFaint,
              textTransform: 'uppercase',
            }}>
              {v}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content area */}
      <View style={{ flex: 1 }}>
        {view === 'month' && (
          <MonthView
            cursor={cursor}
            events={events}
            gridStart={monthGrid.gridStart}
            gridEnd={monthGrid.gridEnd}
            onDayPress={handleDayPress}
          />
        )}
        {view === 'week' && (
          <WeekView
            cursor={cursor}
            events={events}
            onDayPress={handleDayPress}
            onEventPress={navigateEvent}
          />
        )}
        {view === 'day' && (
          <DayView
            events={events}
            onEventPress={navigateEvent}
          />
        )}
      </View>

      {/* FAB */}
      <TouchableOpacity
        onPress={() => setShowFabSheet(true)}
        activeOpacity={0.85}
        style={{
          position: 'absolute',
          bottom: 28,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: COLORS.ink,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: COLORS.ink,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.25,
          shadowRadius: 8,
          elevation: 6,
        }}
      >
        <Feather name="plus" size={24} color={COLORS.paper} />
      </TouchableOpacity>

      {/* Filter sheet */}
      <CalendarFilterSheet
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        filters={filters}
        onFiltersChange={(f) => { setFilters(f); setShowFilters(false); }}
        students={students.map(s => ({ id: s.id, full_name: s.full_name }))}
      />

      {/* FAB action sheet */}
      <ActionSheet
        visible={showFabSheet}
        onDismiss={() => setShowFabSheet(false)}
        items={[
          {
            label: 'Book a lesson',
            icon: 'clock',
            onPress: () => {
              setShowFabSheet(false);
              setShowStudentPicker(true);
            },
          },
          {
            label: 'Add event',
            icon: 'calendar',
            onPress: () => {
              const date = dateForFab;   // capture before setState
              const currentView = view;  // capture before setState
              setShowFabSheet(false);
              router.push(`/calendar-event/new?date=${date}&kind=event` as Href);
            },
          },
          {
            label: 'Block time',
            icon: 'lock',
            onPress: () => {
              const date = dateForFab;   // capture before setState
              const currentView = view;  // capture before setState
              setShowFabSheet(false);
              router.push(`/calendar-event/new?date=${date}&kind=time_block` as Href);
            },
          },
        ]}
      />

      {/* Student picker modal */}
      <Modal
        visible={showStudentPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowStudentPicker(false)}
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(27,23,20,0.4)' }}
          activeOpacity={1}
          onPress={() => setShowStudentPicker(false)}
        />
        <View style={{
          backgroundColor: COLORS.paper,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          paddingTop: 20,
          paddingBottom: 40,
          maxHeight: 420,
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
        }}>
          <Text style={{
            fontFamily: F.sansMed,
            fontSize: 11,
            color: COLORS.inkFaint,
            textTransform: 'uppercase',
            letterSpacing: 0.8,
            marginBottom: 12,
            paddingHorizontal: 20,
          }}>
            Schedule for
          </Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {students.map(s => (
              <TouchableOpacity
                key={s.id}
                onPress={() => pickStudent(s.id)}
                activeOpacity={0.7}
                style={{
                  paddingHorizontal: 20,
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: COLORS.paperEdge,
                }}
              >
                <Text style={{ fontFamily: F.sans, fontSize: 16, color: COLORS.ink }}>
                  {s.full_name}
                </Text>
              </TouchableOpacity>
            ))}
            {students.length === 0 && (
              <Text style={{
                fontFamily: F.sans,
                fontSize: 14,
                color: COLORS.inkFaint,
                paddingHorizontal: 20,
                paddingVertical: 16,
              }}>
                No students yet
              </Text>
            )}
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
