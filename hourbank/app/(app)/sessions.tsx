import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, SafeAreaView } from 'react-native';
import { router } from 'expo-router';
import { F } from '../../src/theme/fonts';
import { useUpcomingSessions } from '../../src/hooks/useUpcomingSessions';
import { startSession } from '../../src/db/sessions';
import { formatScheduledTime } from '../../src/utils/format';

export default function SessionsScreen() {
  const { sessions, loading } = useUpcomingSessions();

  const today = new Date().toLocaleDateString('en-ZA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const handleStart = (session: (typeof sessions)[number]) => {
    try {
      startSession(session.id);
      router.push(`/student/${session.student_id}/session?sessionId=${session.id}`);
    } catch (e) {
      Alert.alert('Error', 'Could not start session.');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F4EFE6' }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 }}>
        {/* Heading */}
        <Text
          style={{
            fontFamily: F.mono,
            fontSize: 11,
            color: '#8A7E72',
            textTransform: 'uppercase',
            letterSpacing: 1,
          }}
        >
          Upcoming Sessions
        </Text>
        <Text
          style={{
            fontFamily: F.mono,
            fontSize: 12,
            color: '#B5A99A',
            marginTop: 4,
            marginBottom: 20,
          }}
        >
          {today}
        </Text>

        {/* List */}
        {!loading && sessions.length === 0 && (
          <View style={{ alignItems: 'center', marginTop: 60 }}>
            <Text
              style={{
                fontFamily: F.serifItalic,
                fontSize: 14,
                color: '#B5A99A',
                textAlign: 'center',
              }}
            >
              No upcoming sessions. Schedule one from a student's page.
            </Text>
          </View>
        )}

        {sessions.map((session) => (
          <TouchableOpacity
            key={session.id}
            onPress={() => handleStart(session)}
            style={{
              borderBottomWidth: 1,
              borderBottomColor: '#E8E0D5',
              paddingVertical: 12,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
            activeOpacity={0.7}
          >
            {/* Left side */}
            <View style={{ flex: 1, marginRight: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
                <Text
                  style={{
                    fontFamily: F.mono,
                    fontSize: 13,
                    color: '#1B1714',
                  }}
                >
                  {session.scheduled_for ? formatScheduledTime(session.scheduled_for) : '—'}
                </Text>
                <Text
                  style={{
                    fontFamily: F.sansMed,
                    fontSize: 14,
                    color: '#1B1714',
                  }}
                >
                  {session.student_full_name}
                </Text>
              </View>
              <Text
                style={{
                  fontFamily: F.sans,
                  fontSize: 13,
                  color: '#8A7E72',
                  marginTop: 2,
                }}
              >
                {session.student_subject} · {session.mode === 'in_person' ? 'In-person' : 'Online'}
              </Text>
            </View>

            {/* Right side badge */}
            <View
              style={{
                backgroundColor: '#FEF3C7',
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: 4,
              }}
            >
              <Text
                style={{
                  fontFamily: F.mono,
                  fontSize: 10,
                  color: '#D97706',
                  textTransform: 'uppercase',
                }}
              >
                Scheduled
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
