/**
 * Day / Week / Month renderers for the Schedule tab. Stateless: the container
 * (ScheduleCalendar) owns cursor, filters and data.
 */
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { CalendarEvent } from '../../db/calendar';
import { COLORS } from '../../theme/colors';
import { F, MIN_TOUCH } from '../../theme/fonts';
import { EVENT_KIND_COLORS } from '../../theme/eventColors';
import { formatDayShort } from '../../utils/format';
import {
  eventChipLabel,
  eventKey,
  eventMeta,
  eventStyleKey,
  eventTimeLabel,
  eventTitle,
  eventsForDay,
  isoDate,
  monthGridDays,
  sameDay,
  sortForDay,
  weekDays,
} from './calendarModel';

/** Space kept below scrolling content so the FAB never covers the last row. */
export const FAB_CLEARANCE = 104;

const DAY_ABBREVS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ─── Shared row ──────────────────────────────────────────────────────────────

interface EventRowProps {
  event: CalendarEvent;
  day: Date;
  now: Date;
  onPress: (e: CalendarEvent) => void;
  compact?: boolean;
}

/** Filled card with a left colour stripe — the same treatment in Day, Week and Month lists. */
export function EventRow({ event, day, now, onPress, compact = false }: EventRowProps) {
  const style = EVENT_KIND_COLORS[eventStyleKey(event, now)];
  const time = eventTimeLabel(event, day);
  const meta = eventMeta(event, now);
  return (
    <TouchableOpacity
      onPress={() => onPress(event)}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${time}, ${eventTitle(event)}, ${meta}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: style.fill,
        borderLeftWidth: 3,
        borderLeftColor: style.fg,
        borderRadius: 6,
        paddingHorizontal: compact ? 8 : 12,
        paddingVertical: compact ? 6 : 10,
        minHeight: compact ? 40 : MIN_TOUCH + 8,
        marginBottom: compact ? 4 : 8,
        gap: compact ? 8 : 12,
      }}
    >
      <Text
        style={{ fontFamily: F.monoMed, fontSize: compact ? 11 : 12, color: style.fg, width: compact ? 74 : 86 }}
        numberOfLines={2}
      >
        {time}
      </Text>
      <View style={{ flex: 1 }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily: F.sans,
            fontSize: compact ? 13 : 15,
            color: COLORS.ink,
            textDecorationLine: style.strike ? 'line-through' : 'none',
          }}
        >
          {eventTitle(event)}
        </Text>
        {meta ? (
          <Text numberOfLines={1} style={{ fontFamily: F.mono, fontSize: compact ? 10 : 11, color: COLORS.inkSoft, marginTop: 1 }}>
            {meta}
          </Text>
        ) : null}
      </View>
      {!compact ? <Feather name="chevron-right" size={14} color={COLORS.inkFaint} /> : null}
    </TouchableOpacity>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

export function CalendarEmpty({
  message,
  filterActive,
  onBook,
  onResetFilters,
}: {
  message: string;
  filterActive: boolean;
  onBook: () => void;
  onResetFilters: () => void;
}) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 24, paddingHorizontal: 24, gap: 12 }}>
      <Text style={{ fontFamily: F.serifItalic, fontSize: 15, color: COLORS.inkSoft, textAlign: 'center' }}>{message}</Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {filterActive ? (
          <TouchableOpacity
            onPress={onResetFilters}
            activeOpacity={0.8}
            accessibilityRole="button"
            style={{
              minHeight: MIN_TOUCH,
              paddingHorizontal: 16,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: COLORS.paperEdge,
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.inkSoft }}>Reset filters</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={onBook}
          activeOpacity={0.8}
          accessibilityRole="button"
          style={{
            minHeight: MIN_TOUCH,
            paddingHorizontal: 16,
            borderRadius: 10,
            backgroundColor: COLORS.ink,
            justifyContent: 'center',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Feather name="plus" size={14} color={COLORS.paper} />
          <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.paper }}>Book a lesson</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Day view ────────────────────────────────────────────────────────────────

interface DayViewProps {
  day: Date;
  events: CalendarEvent[];
  onEventPress: (e: CalendarEvent) => void;
  empty: React.ReactNode;
}

export function DayView({ day, events, onEventPress, empty }: DayViewProps) {
  const now = new Date();
  const items = sortForDay(eventsForDay(events, day));
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: FAB_CLEARANCE }}
      showsVerticalScrollIndicator={false}
    >
      {items.length === 0
        ? empty
        : items.map(e => <EventRow key={eventKey(e)} event={e} day={day} now={now} onPress={onEventPress} />)}
    </ScrollView>
  );
}

// ─── Week view ───────────────────────────────────────────────────────────────

interface WeekViewProps {
  cursor: Date;
  events: CalendarEvent[];
  onDayPress: (d: Date) => void;
  onEventPress: (e: CalendarEvent) => void;
  empty: React.ReactNode;
}

export function WeekView({ cursor, events, onDayPress, onEventPress, empty }: WeekViewProps) {
  const now = new Date();
  const days = weekDays(cursor);
  const anyEvents = days.some(d => eventsForDay(events, d).length > 0);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: FAB_CLEARANCE }} showsVerticalScrollIndicator={false}>
      {days.map((day, i) => {
        const dayEvents = sortForDay(eventsForDay(events, day));
        const isToday = sameDay(day, now);
        const isSelected = sameDay(day, cursor);
        return (
          <View
            key={isoDate(day)}
            style={{
              flexDirection: 'row',
              borderBottomWidth: 1,
              borderBottomColor: COLORS.paperEdge,
              backgroundColor: isSelected ? COLORS.paperDeep : COLORS.transparent,
            }}
          >
            <TouchableOpacity
              onPress={() => onDayPress(day)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Open ${formatDayShort(day)}`}
              style={{ width: 56, alignItems: 'center', paddingVertical: 12, minHeight: MIN_TOUCH }}
            >
              <Text style={{ fontFamily: F.sansMed, fontSize: 10, color: COLORS.inkFaint, textTransform: 'uppercase' }}>
                {DAY_SHORT[i]}
              </Text>
              <Text style={{ fontFamily: F.mono, fontSize: 18, color: isToday ? COLORS.oxblood : COLORS.ink, marginTop: 2 }}>
                {day.getDate()}
              </Text>
            </TouchableOpacity>
            <View style={{ flex: 1, paddingVertical: 8, paddingRight: 12, justifyContent: 'center' }}>
              {dayEvents.length === 0 ? (
                <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkFaint }}>—</Text>
              ) : (
                dayEvents.map(e => <EventRow key={eventKey(e)} event={e} day={day} now={now} onPress={onEventPress} compact />)
              )}
            </View>
          </View>
        );
      })}
      {!anyEvents ? empty : null}
    </ScrollView>
  );
}

// ─── Month view ──────────────────────────────────────────────────────────────

interface MonthViewProps {
  cursor: Date;
  events: CalendarEvent[];
  /** Tap a day: select it (drives the FAB + the list below the grid). */
  onSelectDay: (d: Date) => void;
  /** Tap the already-selected day: open it in Day view. */
  onOpenDay: (d: Date) => void;
  onEventPress: (e: CalendarEvent) => void;
  /** Rendered under the selected day's header when it has no items. */
  emptyDay: React.ReactNode;
}

export function MonthView({ cursor, events, onSelectDay, onOpenDay, onEventPress, emptyDay }: MonthViewProps) {
  const now = new Date();
  const days = monthGridDays(cursor);
  const selectedEvents = sortForDay(eventsForDay(events, cursor));

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: FAB_CLEARANCE }} showsVerticalScrollIndicator={false}>
      <View style={{ paddingHorizontal: 8 }}>
        <View style={{ flexDirection: 'row', marginBottom: 4 }}>
          {DAY_ABBREVS.map(abbr => (
            <View key={abbr} style={{ flex: 1, alignItems: 'center', paddingVertical: 4 }}>
              <Text style={{ fontFamily: F.sansMed, fontSize: 11, color: COLORS.inkFaint }}>{abbr}</Text>
            </View>
          ))}
        </View>

        {Array.from({ length: days.length / 7 }, (_, week) => (
          <View key={week} style={{ flexDirection: 'row' }}>
            {days.slice(week * 7, week * 7 + 7).map(day => {
              const inMonth = day.getMonth() === cursor.getMonth();
              const isToday = sameDay(day, now);
              const isSelected = sameDay(day, cursor);
              const dayEvents = sortForDay(eventsForDay(events, day));
              const shown = dayEvents.slice(0, 3);
              const extra = dayEvents.length - shown.length;
              return (
                <TouchableOpacity
                  key={isoDate(day)}
                  onPress={() => (isSelected ? onOpenDay(day) : onSelectDay(day))}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${formatDayShort(day)}, ${dayEvents.length} items${isSelected ? ', tap again to open day' : ''}`}
                  style={{
                    flex: 1,
                    minHeight: 76,
                    paddingHorizontal: 2,
                    paddingVertical: 4,
                    borderWidth: isSelected ? 1.5 : 0.5,
                    borderColor: isSelected ? COLORS.ink : COLORS.paperEdge,
                    backgroundColor: inMonth ? COLORS.transparent : COLORS.paperDeep,
                  }}
                >
                  <View style={{ alignItems: 'center', marginBottom: 3 }}>
                    <View
                      style={{
                        minWidth: 20,
                        height: 20,
                        borderRadius: 10,
                        paddingHorizontal: 4,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: isToday ? COLORS.oxblood : COLORS.transparent,
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: F.mono,
                          fontSize: 12,
                          color: isToday ? COLORS.paper : inMonth ? COLORS.ink : COLORS.inkFaint,
                        }}
                      >
                        {day.getDate()}
                      </Text>
                    </View>
                  </View>
                  {shown.map(e => {
                    const s = EVENT_KIND_COLORS[eventStyleKey(e, now)];
                    return (
                      <View
                        key={eventKey(e)}
                        style={{
                          backgroundColor: s.fill,
                          borderLeftWidth: 2,
                          borderLeftColor: s.fg,
                          borderRadius: 3,
                          paddingHorizontal: 3,
                          paddingVertical: 1,
                          marginBottom: 2,
                        }}
                      >
                        <Text
                          numberOfLines={1}
                          style={{
                            fontFamily: e.kind === 'top_up' ? F.monoMed : F.sans,
                            fontSize: 9,
                            color: COLORS.ink,
                            textDecorationLine: s.strike ? 'line-through' : 'none',
                          }}
                        >
                          {eventChipLabel(e)}
                        </Text>
                      </View>
                    );
                  })}
                  {extra > 0 ? (
                    <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkSoft, paddingLeft: 2 }}>+{extra}</Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {/* Selected day list */}
      <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {formatDayShort(cursor)}
          </Text>
          <TouchableOpacity
            onPress={() => onOpenDay(cursor)}
            activeOpacity={0.7}
            accessibilityRole="button"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: COLORS.oxblood }}>Open day →</Text>
          </TouchableOpacity>
        </View>
        {selectedEvents.length === 0
          ? emptyDay
          : selectedEvents.map(e => <EventRow key={eventKey(e)} event={e} day={cursor} now={now} onPress={onEventPress} />)}
      </View>
    </ScrollView>
  );
}
