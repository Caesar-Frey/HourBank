import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { COLORS } from '../../../src/theme/colors';
import { F } from '../../../src/theme/fonts';
import { formatDuration, formatScheduledTime } from '../../../src/utils/format';
import { useSessionTimer } from '../../../src/contexts/SessionTimerContext';
import { useStudents } from '../../../src/hooks/useStudents';
import { listAllUpcoming, startSession, cancelSession } from '../../../src/db/sessions';
import { ActionSheet } from '../../../src/components/ActionSheet';
import { Session } from '../../../src/db/schema';

type UpcomingRow = Session & { student_full_name: string; student_subject: string };

export default function SessionsTab() {
  const router = useRouter();
  const { status, sessionId, studentId, elapsedSeconds, startTimer } = useSessionTimer();
  const { students } = useStudents();
  const [upcoming, setUpcoming] = useState<UpcomingRow[]>([]);
  const [selectedSession, setSelectedSession] = useState<UpcomingRow | null>(null);
  const [showMenu, setShowMenu] = useState(false);

  const loadUpcoming = useCallback(() => {
    setUpcoming(listAllUpcoming());
  }, []);

  useFocusEffect(loadUpcoming);

  const activeStudentName = studentId
    ? (students.find(s => s.id === studentId)?.full_name ?? '—')
    : '—';

  function handleStartNow(session: UpcomingRow) {
    const started = startSession(session.id);
    startTimer(session.id, session.student_id, started.started_at!, 0);
    setShowMenu(false);
    loadUpcoming();
    router.push(`/student/${session.student_id}/session?sessionId=${session.id}`);
  }

  function handleCancelSession(session: UpcomingRow) {
    Alert.alert(
      'Cancel session',
      `Cancel session with ${session.student_full_name}?`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel session',
          style: 'destructive',
          onPress: () => {
            cancelSession(session.id);
            setShowMenu(false);
            loadUpcoming();
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 }}
      >
        <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 20 }}>
          SESSIONS
        </Text>

        {/* Active session card */}
        {status === 'active' && sessionId && studentId && (
          <TouchableOpacity
            onPress={() => router.push(`/student/${studentId}/session?sessionId=${sessionId}`)}
            activeOpacity={0.85}
            style={{
              backgroundColor: COLORS.sessionBg,
              borderRadius: 16,
              padding: 20,
              marginBottom: 20,
            }}
          >
            <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.paper, textTransform: 'uppercase', opacity: 0.6, marginBottom: 4 }}>
              LIVE SESSION
            </Text>
            <Text style={{ fontFamily: F.serif, fontSize: 20, color: COLORS.paper, marginBottom: 8 }}>
              {activeStudentName}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontFamily: F.mono, fontSize: 24, color: COLORS.paper }}>
                {formatDuration(elapsedSeconds)}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.paper }}>Resume</Text>
                <Feather name="arrow-right" size={14} color={COLORS.paper} />
              </View>
            </View>
          </TouchableOpacity>
        )}

        {/* Start new session CTA */}
        <TouchableOpacity
          onPress={() => router.push('/sessions/start-unscheduled')}
          activeOpacity={0.85}
          style={{
            backgroundColor: COLORS.oxblood,
            borderRadius: 14,
            paddingHorizontal: 20,
            paddingVertical: 16,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 28,
          }}
        >
          <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.paper }}>
            Start session
          </Text>
          <Feather name="arrow-right" size={14} color={COLORS.paper} />
        </TouchableOpacity>

        {/* Upcoming sessions */}
        <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.ink, textTransform: 'uppercase', marginBottom: 12 }}>
          UPCOMING
        </Text>

        {upcoming.length === 0 ? (
          <Text style={{ fontFamily: F.serifItalic, fontSize: 13, color: COLORS.inkFaint }}>
            No upcoming sessions scheduled.
          </Text>
        ) : (
          <View>
            {upcoming.map(session => (
              <TouchableOpacity
                key={session.id}
                activeOpacity={0.7}
                onPress={() => { setSelectedSession(session); setShowMenu(true); }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: COLORS.paperEdge,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: F.serif, fontSize: 15, color: COLORS.ink, marginBottom: 2 }}>
                    {session.student_full_name}
                  </Text>
                  <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkSoft }}>
                    {session.scheduled_for ? formatScheduledTime(session.scheduled_for) : '—'}
                    {'  '}
                    <Text style={{ color: COLORS.inkFaint }}>
                      {session.mode === 'online' ? 'ONLINE' : 'IN-PERSON'}
                    </Text>
                  </Text>
                </View>
                <Feather name="more-vertical" size={16} color={COLORS.inkFaint} />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      <ActionSheet
        visible={showMenu}
        onDismiss={() => setShowMenu(false)}
        items={
          selectedSession
            ? [
                {
                  label: 'Start now',
                  icon: 'play',
                  onPress: () => handleStartNow(selectedSession),
                },
                {
                  label: 'Edit',
                  icon: 'edit-2',
                  onPress: () => {
                    setShowMenu(false);
                    router.push(`/student/${selectedSession.student_id}/schedule?sessionId=${selectedSession.id}`);
                  },
                },
                {
                  label: 'Cancel session',
                  icon: 'x',
                  destructive: true,
                  onPress: () => handleCancelSession(selectedSession),
                },
              ]
            : []
        }
      />
    </SafeAreaView>
  );
}
