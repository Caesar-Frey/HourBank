/**
 * Calendar half of the Schedule tab (Day / Week / Month).
 * Owns cursor (= selected day, drives FAB prefill), filters (persisted,
 * exclusion-based) and the event query.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { COLORS } from '../../theme/colors';
import { F, MIN_TOUCH } from '../../theme/fonts';
import { CalendarEvent, listEventsInRange } from '../../db/calendar';
import { formatDayShort } from '../../utils/format';
import { listActiveStudents, listPausedStudents } from '../../db/students';
import { CalendarFilterSheet } from '../../components/CalendarFilterSheet';
import { ActionSheet } from '../../components/ActionSheet';
import { EventLegend } from '../../components/calendar/EventLegend';
import { StudentPickerSheet } from '../../components/calendar/StudentPickerSheet';
import {
  ScheduleFilters,
  defaultScheduleFilters,
  deserializeFilters,
  filtersEqual,
  isFilterActive,
  pruneFilters,
  serializeFilters,
  toQueryFilters,
} from './filterModel';
import {
  CalendarView,
  emptyCopy,
  eventRoute,
  isoDate,
  shiftCursor,
  viewContainsToday,
  viewRange,
  viewTitle,
} from './calendarModel';
import { CalendarEmpty, DayView, MonthView, WeekView } from './CalendarViews';

export const FILTER_STORAGE_KEY = '@hourbank/schedule_filters_v2';

type FilterStudent = { id: string; full_name: string };

interface Props {
  view: CalendarView;
  onChangeView: (v: CalendarView) => void;
}

function IconButton({
  icon,
  label,
  onPress,
  badge,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  onPress: () => void;
  badge?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}
    >
      <Feather name={icon} size={20} color={COLORS.ink} />
      {badge ? (
        <View
          style={{
            position: 'absolute',
            top: 9,
            right: 9,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: COLORS.oxblood,
            borderWidth: 1,
            borderColor: COLORS.paper,
          }}
        />
      ) : null}
    </TouchableOpacity>
  );
}

export function ScheduleCalendar({ view, onChangeView }: Props) {
  const router = useRouter();

  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [filters, setFilters] = useState<ScheduleFilters>(defaultScheduleFilters);
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [students, setStudents] = useState<FilterStudent[] | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showFab, setShowFab] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const navigating = useRef(false);

  // Load persisted filters ONCE on mount.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(FILTER_STORAGE_KEY)
      .then(raw => {
        if (!cancelled) setFilters(deserializeFilters(raw));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setFiltersLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist only after the stored value has been read (never clobber it with defaults).
  useEffect(() => {
    if (!filtersLoaded) return;
    AsyncStorage.setItem(FILTER_STORAGE_KEY, serializeFilters(filters)).catch(() => {});
  }, [filters, filtersLoaded]);

  // Students (active + paused: both have lessons on the calendar) — refreshed on focus.
  useFocusEffect(
    useCallback(() => {
      try {
        const list = [...listActiveStudents(), ...listPausedStudents()]
          .map(s => ({ id: s.id, full_name: s.full_name }))
          .sort((a, b) => a.full_name.localeCompare(b.full_name));
        setStudents(list);
      } catch {
        setStudents([]);
      }
    }, []),
  );

  // Drop excluded ids for students that no longer exist (archived / restored DB).
  useEffect(() => {
    if (!filtersLoaded || students === null) return;
    const pruned = pruneFilters(filters, students.map(s => s.id));
    if (!filtersEqual(pruned, filters)) setFilters(pruned);
  }, [filtersLoaded, students, filters]);

  const studentIds = useMemo(() => (students ?? []).map(s => s.id), [students]);

  // One query per focus / dependency change (useFocusEffect re-runs when the callback changes).
  const fetchEvents = useCallback(() => {
    if (!filtersLoaded || students === null) return;
    const { startISO, endISO } = viewRange(view, cursor);
    try {
      setEvents(listEventsInRange(startISO, endISO, toQueryFilters(filters, studentIds)));
      setLoadError(false);
    } catch {
      setEvents([]);
      setLoadError(true);
    }
  }, [filtersLoaded, students, view, cursor, filters, studentIds]);

  useFocusEffect(
    useCallback(() => {
      navigating.current = false;
      fetchEvents();
    }, [fetchEvents]),
  );

  const filterActive = isFilterActive(filters);
  const dateParam = isoDate(cursor);

  function go(href: string) {
    if (navigating.current) return;
    navigating.current = true;
    router.push(href as Href);
  }

  function openEvent(e: CalendarEvent) {
    go(eventRoute(e));
  }

  function openDay(d: Date) {
    setCursor(d);
    onChangeView('day');
  }

  function resetFilters() {
    setFilters(defaultScheduleFilters());
  }

  function openBook() {
    setShowFab(false);
    setShowPicker(true);
  }

  const empty = (
    <CalendarEmpty
      message={emptyCopy(view, cursor, filterActive)}
      filterActive={filterActive}
      onBook={openBook}
      onResetFilters={resetFilters}
    />
  );
  const emptyDay = (
    <CalendarEmpty
      message={emptyCopy('day', cursor, filterActive)}
      filterActive={filterActive}
      onBook={openBook}
      onResetFilters={resetFilters}
    />
  );

  return (
    <View style={{ flex: 1 }}>
      {/* Navigator */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
        <IconButton icon="chevron-left" label="Previous" onPress={() => setCursor(c => shiftCursor(view, c, -1))} />
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={{ flex: 1, textAlign: 'center', fontFamily: F.serif, fontSize: 18, color: COLORS.ink }}
        >
          {viewTitle(view, cursor)}
        </Text>
        {!viewContainsToday(view, cursor) ? (
          <TouchableOpacity
            onPress={() => setCursor(new Date())}
            activeOpacity={0.7}
            accessibilityRole="button"
            style={{ minHeight: MIN_TOUCH, paddingHorizontal: 6, justifyContent: 'center' }}
          >
            <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: COLORS.oxblood }}>Today</Text>
          </TouchableOpacity>
        ) : null}
        <IconButton
          icon="sliders"
          label={filterActive ? 'Filters (active)' : 'Filters'}
          onPress={() => setShowFilters(true)}
          badge={filterActive}
        />
        <IconButton icon="chevron-right" label="Next" onPress={() => setCursor(c => shiftCursor(view, c, 1))} />
      </View>

      {filterActive ? (
        <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginBottom: 6 }}>
          <TouchableOpacity
            onPress={resetFilters}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Filtered. Reset filters"
            hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: COLORS.oxbloodFill,
              borderRadius: 999,
              paddingHorizontal: 12,
              minHeight: 32,
            }}
          >
            <Feather name="filter" size={12} color={COLORS.oxblood} />
            <Text style={{ fontFamily: F.sansMed, fontSize: 12, color: COLORS.oxblood }}>Filtered · Reset</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <EventLegend />

      {loadError ? (
        <View style={{ alignItems: 'center', padding: 24, gap: 10 }}>
          <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.crimson }}>Couldn’t load the calendar.</Text>
          <TouchableOpacity onPress={fetchEvents} accessibilityRole="button" style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.oxblood }}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {view === 'month' ? (
            <MonthView
              cursor={cursor}
              events={events}
              onSelectDay={setCursor}
              onOpenDay={openDay}
              onEventPress={openEvent}
              emptyDay={emptyDay}
            />
          ) : null}
          {view === 'week' ? (
            <WeekView cursor={cursor} events={events} onDayPress={openDay} onEventPress={openEvent} empty={empty} />
          ) : null}
          {view === 'day' ? <DayView day={cursor} events={events} onEventPress={openEvent} empty={empty} /> : null}
        </View>
      )}

      {/* FAB */}
      <TouchableOpacity
        onPress={() => setShowFab(true)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`Add to ${formatDayShort(cursor)}`}
        style={{
          position: 'absolute',
          bottom: 24,
          right: 20,
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

      <CalendarFilterSheet
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        filters={filters}
        onApply={f => {
          setFilters(pruneFilters(f, studentIds));
          setShowFilters(false);
        }}
        students={students ?? []}
      />

      <ActionSheet
        visible={showFab}
        onDismiss={() => setShowFab(false)}
        items={[
          { label: 'Book a lesson', icon: 'clock', onPress: openBook },
          {
            label: 'Add event',
            icon: 'calendar',
            onPress: () => {
              setShowFab(false);
              go(`/calendar-event/new?date=${dateParam}&kind=event`);
            },
          },
          {
            label: 'Block time',
            icon: 'lock',
            onPress: () => {
              setShowFab(false);
              go(`/calendar-event/new?date=${dateParam}&kind=time_block`);
            },
          },
        ]}
      />

      <StudentPickerSheet
        visible={showPicker}
        title={`Book a lesson · ${formatDayShort(cursor)}`}
        students={students ?? []}
        onClose={() => setShowPicker(false)}
        onPick={id => {
          setShowPicker(false);
          go(`/student/${id}/schedule?date=${dateParam}`);
        }}
      />
    </View>
  );
}
