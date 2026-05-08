import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { F } from '../../../src/theme/fonts';
import { useStudent } from '../../../src/hooks/useStudent';
import { LedgerRow } from '../../../src/components/LedgerRow';
import { ScreenHeader } from '../../../src/components/ScreenHeader';
import { formatHoursDisplay, formatScheduledTime } from '../../../src/utils/format';
import { Session } from '../../../src/db/schema';
import { LedgerEntry } from '../../../src/db/schema';

export default function StudentLedgerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { student, balance, ledger, upcoming, pastSessions, loading } = useStudent(id);
  const [showAllLedger, setShowAllLedger] = useState(false);

  if (loading) {
    return (
      <View className="flex-1 bg-paper items-center justify-center">
        <Text style={{ fontFamily: F.mono, fontSize: 13, color: '#8A7E72' }}>
          Loading…
        </Text>
      </View>
    );
  }

  if (!student) {
    return (
      <View className="flex-1 bg-paper items-center justify-center px-6">
        <Text style={{ fontFamily: F.serif, fontSize: 24, color: '#1B1714', marginBottom: 16 }}>
          Student not found
        </Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ fontFamily: F.mono, fontSize: 13, color: '#4A413A' }}>
            ← Go back
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Derive display values
  const { integer, decimal } = formatHoursDisplay(balance);
  const nextSession: Session | undefined = upcoming[0];
  const modeDisplay = nextSession
    ? nextSession.mode === 'online' ? 'Online' : 'In-person'
    : 'In-person';

  // Status tip
  let statusTip: string | null = null;
  if (balance < 1) statusTip = '— Top-up due.';
  else if (balance < 3) statusTip = '— Running low.';

  // Split full_name into first/last for display
  const nameParts = student.full_name.trim().split(/\s+/);
  const firstName = nameParts.slice(0, -1).join(' ') || nameParts[0];
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';

  function handleOpenSession(session: Session) {
    router.push(`/student/${id}/session?sessionId=${session.id}`);
  }

  // Build ledger rows with linked sessions
  const visibleLedger: LedgerEntry[] = showAllLedger ? ledger : ledger.slice(0, 5);

  function getLinkedSession(entry: LedgerEntry) {
    if (!entry.related_session_id) return undefined;
    return pastSessions.find(s => s.id === entry.related_session_id);
  }

  function buildLedgerEntryWithSession(entry: LedgerEntry) {
    const linked = getLinkedSession(entry);
    if (!linked) return entry;
    return {
      ...entry,
      session: {
        topics: linked.topics,
        status: linked.status,
      },
    };
  }

  return (
    <SafeAreaView className="flex-1 bg-paper" edges={['top']}>
      <ScreenHeader
        backLabel="ROSTER"
        onBack={() => router.back()}
        rightElement={
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => {
              Alert.alert(
                student.full_name,
                undefined,
                [
                  {
                    text: 'Edit details',
                    onPress: () => router.push(`/student/${id}/edit`),
                  },
                  { text: 'Cancel', style: 'cancel' },
                ]
              );
            }}
          >
            <Feather name="more-horizontal" size={20} color="#4A413A" />
          </TouchableOpacity>
        }
      />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Student meta header */}
        <View style={{ marginTop: 8, marginBottom: 20 }}>
          <Text
            style={{
              fontFamily: F.mono,
              fontSize: 11,
              color: '#8A7E72',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 4,
            }}
          >
            {`STUDENT · GR ${student.grade} · ${student.curriculum}`}
          </Text>
          <Text
            style={{
              fontFamily: F.serif,
              fontSize: 32,
              color: '#1B1714',
              lineHeight: 36,
            }}
          >
            {firstName}
            {'\n'}
            {lastName}
          </Text>
          <Text
            style={{
              fontFamily: F.serifItalic,
              fontSize: 15,
              color: '#4A413A',
              marginTop: 4,
            }}
          >
            {`${student.subject} · ${modeDisplay}`}
          </Text>
        </View>

        {/* Balance hero card */}
        <View
          style={{
            borderWidth: 1.5,
            borderColor: '#1B1714',
            borderRadius: 16,
            padding: 20,
            backgroundColor: '#ECE5D6',
            position: 'relative',
          }}
        >
          {/* Inner inset ring */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 12,
              left: 12,
              right: 12,
              bottom: 12,
              borderWidth: 0.5,
              borderColor: 'rgba(27,23,20,0.20)',
              borderRadius: 12,
            }}
          />

          {/* Label */}
          <Text
            style={{
              fontFamily: F.mono,
              fontSize: 11,
              color: '#8A7E72',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 12,
            }}
          >
            ★ REMAINING BALANCE
          </Text>

          {/* Hero number */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 8 }}>
            <Text
              style={{
                fontFamily: F.serifItalic,
                fontSize: 56,
                color: '#1B1714',
                lineHeight: 60,
              }}
            >
              {integer}
            </Text>
            <Text
              style={{
                fontFamily: F.serifItalic,
                fontSize: 56,
                color: '#7A2530',
                lineHeight: 60,
              }}
            >
              {decimal}
            </Text>
            <Text
              style={{
                fontFamily: F.serifItalic,
                fontSize: 18,
                color: '#4A413A',
                lineHeight: 60,
                marginLeft: 6,
              }}
            >
              hours
            </Text>
          </View>

          {/* Status tip */}
          {statusTip && (
            <Text
              style={{
                fontFamily: F.serifItalic,
                fontSize: 13,
                color: '#8A7E72',
                marginBottom: 4,
              }}
            >
              {statusTip}
            </Text>
          )}

          {/* Next session tip */}
          {nextSession && nextSession.scheduled_for && (
            <Text
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                color: '#8A7E72',
              }}
            >
              {`Next: ${formatScheduledTime(nextSession.scheduled_for)} · ${nextSession.mode === 'online' ? 'Online' : 'In-person'}`}
            </Text>
          )}
        </View>

        {/* Action buttons */}
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
          <TouchableOpacity
            onPress={() => router.push(`/student/${id}/top-up`)}
            activeOpacity={0.75}
            style={{
              flex: 1,
              borderWidth: 1,
              borderColor: '#1B1714',
              borderRadius: 16,
              paddingHorizontal: 24,
              paddingVertical: 12,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: '#1B1714' }}>
              + Top up
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push(`/student/${id}/schedule`)}
            activeOpacity={0.75}
            style={{
              flex: 1,
              backgroundColor: '#7A2530',
              borderRadius: 16,
              paddingHorizontal: 24,
              paddingVertical: 12,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: '#F4EFE6' }}>
              Schedule lesson
            </Text>
          </TouchableOpacity>
        </View>

        {/* History section */}
        <View style={{ marginTop: 32 }}>
          <Text
            style={{
              fontFamily: F.mono,
              fontSize: 11,
              color: '#8A7E72',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 16,
            }}
          >
            HISTORY
          </Text>

          {/* Upcoming sub-section */}
          <Text
            style={{
              fontFamily: F.mono,
              fontSize: 10,
              color: '#8A7E72',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 8,
            }}
          >
            UPCOMING
          </Text>

          {upcoming.length === 0 ? (
            <Text
              style={{
                fontFamily: F.serifItalic,
                fontSize: 13,
                color: '#8A7E72',
                marginBottom: 20,
              }}
            >
              No upcoming sessions scheduled.
            </Text>
          ) : (
            <View style={{ marginBottom: 20 }}>
              {upcoming.map(session => (
                <TouchableOpacity
                  key={session.id}
                  onPress={() => handleOpenSession(session)}
                  activeOpacity={0.7}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingVertical: 12,
                      borderBottomWidth: 1,
                      borderBottomColor: '#D9CFBF',
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text>
                        <Text style={{ fontFamily: F.mono, fontSize: 13, color: '#1B1714' }}>
                          {session.scheduled_for ? formatScheduledTime(session.scheduled_for) : '—'}
                        </Text>
                        <Text style={{ fontFamily: F.sans, fontSize: 11, color: '#4A413A' }}>
                          {'  · '}
                          {session.mode === 'online' ? 'Online' : 'In-person'}
                        </Text>
                      </Text>
                    </View>
                    <View
                      style={{
                        backgroundColor: '#F0E0CB',
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        borderRadius: 4,
                      }}
                    >
                      <Text style={{ fontFamily: F.mono, fontSize: 10, color: '#B8743F' }}>
                        SCHEDULED
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Ledger sub-section */}
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <Text
              style={{
                fontFamily: F.mono,
                fontSize: 10,
                color: '#8A7E72',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              LEDGER — LAST 5 ENTRIES
            </Text>
            <Pressable onPress={() => setShowAllLedger(v => !v)}>
              <Text style={{ fontFamily: F.mono, fontSize: 10, color: '#4A413A' }}>
                {showAllLedger ? 'Less ←' : 'Full →'}
              </Text>
            </Pressable>
          </View>

          {ledger.length === 0 ? (
            <Text
              style={{
                fontFamily: F.serifItalic,
                fontSize: 13,
                color: '#8A7E72',
              }}
            >
              No ledger entries yet.
            </Text>
          ) : (
            visibleLedger.map(entry => (
              <LedgerRow
                key={entry.id}
                entry={buildLedgerEntryWithSession(entry)}
              />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
