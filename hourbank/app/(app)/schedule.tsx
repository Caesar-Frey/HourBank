import React, { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import { COLORS } from '../../src/theme/colors';
import { TabHeader, HeaderIconButton } from '../../src/components/ScreenHeader';
import { SegmentedControl } from '../../src/components/calendar/SegmentedControl';
import { AgendaView } from '../../src/screens/schedule/AgendaView';
import { ScheduleCalendar } from '../../src/screens/schedule/ScheduleCalendar';
import type { CalendarView } from '../../src/screens/schedule/calendarModel';

type Segment = 'agenda' | CalendarView;

const SEGMENTS: { value: Segment; label: string }[] = [
  { value: 'agenda', label: 'Agenda' },
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

export default function ScheduleTab() {
  const router = useRouter();
  const [segment, setSegment] = useState<Segment>('agenda');
  // Last calendar view, so the calendar stays mounted (keeps cursor + filters) across Day/Week/Month.
  const [calendarView, setCalendarView] = useState<CalendarView>('month');

  function changeSegment(s: Segment) {
    setSegment(s);
    if (s !== 'agenda') setCalendarView(s);
  }

  function startLesson() {
    router.push('/start-lesson' as Href);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
      <TabHeader
        title="Schedule"
        divider={false}
        right={<HeaderIconButton icon="check-square" label="Record" accessibilityLabel="Record a lesson" onPress={startLesson} color={COLORS.oxblood} />}
      />
      <SegmentedControl
        options={SEGMENTS}
        value={segment}
        onChange={changeSegment}
        accessibilityLabel="Schedule view"
        style={{ marginHorizontal: 16, marginBottom: 8 }}
      />
      <View style={{ flex: 1, display: segment === 'agenda' ? 'flex' : 'none' }}>
        <AgendaView onStartLesson={startLesson} />
      </View>
      <View style={{ flex: 1, display: segment === 'agenda' ? 'none' : 'flex' }}>
        <ScheduleCalendar view={calendarView} onChangeView={changeSegment} />
      </View>
    </SafeAreaView>
  );
}
