import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { F } from '../../../src/theme/fonts';
import { COLORS } from '../../../src/theme/colors';
import { useStudent } from '../../../src/hooks/useStudent';
import { LedgerRow } from '../../../src/components/LedgerRow';
import { ScreenHeader } from '../../../src/components/ScreenHeader';
import { ActionSheet } from '../../../src/components/ActionSheet';
import { formatHoursDisplay, formatScheduledTime } from '../../../src/utils/format';
import { Session } from '../../../src/db/schema';
import { LedgerEntry } from '../../../src/db/schema';
import { archiveStudent, pauseStudent, reactivateStudent } from '../../../src/db/students';

export default function StudentLedgerScreen() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const router = useRouter();
  const { student, balance, ledger, upcoming, pastSessions, loading } = useStudent(id);
  const [showAllLedger, setShowAllLedger] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  if (loading) {
    return (
      <View className="flex-1 bg-paper items-center justify-center">
        <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.inkFaint }}>
          Loading…
        </Text>
      </View>
    );
  }

  if (!student) {
    return (
      <View className="flex-1 bg-paper items-center justify-center px-6">
        <Text style={{ fontFamily: F.serif, fontSize: 24, color: COLORS.ink, marginBottom: 16 }}>
          Student not found
        </Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.inkSoft }}>
            ← Go back
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Derive display values
  const { integer, decimal } = formatHoursDisplay(Math.abs(balance));
  const isOwes = balance < 0;
  const nextSession: Session | undefined = upcoming[0];
  const modeDisplay = nextSession
    ? nextSession.mode === 'online' ? 'Online' : 'In-person'
    : 'In-person';

  // Status tip
  let statusTip: string | null = null;
  if (balance < 0) statusTip = '— Owes hours. Top-up required.';
  else if (balance < 1) statusTip = '— Top-up due.';
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

  function handleArchive() {
    archiveStudent(id);
    router.back();
  }

  function handlePause() {
    pauseStudent(id);
    router.back();
  }

  function handleReactivate() {
    reactivateStudent(id);
    router.back();
  }

  return (
    <SafeAreaView className="flex-1 bg-paper" edges={['top']}>
      <ScreenHeader
        backLabel={from ?? 'ROSTER'}
        onBack={() => router.back()}
        rightElement={
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => setShowMenu(true)}
          >
            <Feather name="more-horizontal" size={20} color={COLORS.inkSoft} />
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
              color: COLORS.inkFaint,
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
              color: COLORS.ink,
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
              color: COLORS.inkSoft,
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
            borderColor: COLORS.ink,
            borderRadius: 16,
            padding: 20,
            backgroundColor: COLORS.paperDeep,
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
              color: isOwes ? COLORS.oxblood : COLORS.inkFaint,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 12,
            }}
          >
            {isOwes ? '★ HOURS OWED' : '★ REMAINING BALANCE'}
          </Text>

          {/* Hero number */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 8 }}>
            <Text
              style={{
                fontFamily: F.serifItalic,
                fontSize: 56,
                color: COLORS.ink,
                lineHeight: 60,
              }}
            >
              {integer}
            </Text>
            <Text
              style={{
                fontFamily: F.serifItalic,
                fontSize: 56,
                color: COLORS.oxblood,
                lineHeight: 60,
              }}
            >
              {decimal}
            </Text>
            <Text
              style={{
                fontFamily: F.serifItalic,
                fontSize: 18,
                color: COLORS.inkSoft,
                lineHeight: 60,
                marginLeft: 6,
              }}
            >
              {isOwes ? 'hrs owed' : 'hours'}
            </Text>
          </View>

          {/* Status tip */}
          {statusTip && (
            <Text
              style={{
                fontFamily: F.serifItalic,
                fontSize: 13,
                color: COLORS.inkFaint,
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
                color: COLORS.inkFaint,
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
              borderColor: COLORS.ink,
              borderRadius: 16,
              paddingHorizontal: 24,
              paddingVertical: 12,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.ink }}>
              + Top up
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push(`/student/${id}/schedule`)}
            activeOpacity={0.75}
            style={{
              flex: 1,
              backgroundColor: COLORS.oxblood,
              borderRadius: 16,
              paddingHorizontal: 24,
              paddingVertical: 12,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.paper }}>
              Schedule lesson
            </Text>
          </TouchableOpacity>
        </View>

        {/* Upcoming section — above history */}
        <View style={{ marginTop: 32 }}>
          <Text
            style={{
              fontFamily: F.mono,
              fontSize: 11,
              color: COLORS.inkFaint,
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
                color: COLORS.inkFaint,
                marginBottom: 8,
              }}
            >
              No upcoming sessions scheduled.
            </Text>
          ) : (
            <View style={{ marginBottom: 8 }}>
              {upcoming.map(session => (
                <View
                  key={session.id}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: COLORS.paperEdge,
                  }}
                >
                  <TouchableOpacity
                    style={{ flex: 1 }}
                    onPress={() => handleOpenSession(session)}
                    activeOpacity={0.7}
                  >
                    <Text>
                      <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.ink }}>
                        {session.scheduled_for ? formatScheduledTime(session.scheduled_for) : '—'}
                      </Text>
                      <Text style={{ fontFamily: F.sans, fontSize: 11, color: COLORS.inkSoft }}>
                        {'  · '}
                        {session.mode === 'online' ? 'Online' : 'In-person'}
                      </Text>
                      {(() => {
                        try {
                          const topics: string[] = JSON.parse(session.topics);
                          return topics.length > 0
                            ? <Text style={{ fontFamily: F.sans, fontSize: 11, color: COLORS.inkFaint }}>{'  · ' + topics[0]}</Text>
                            : null;
                        } catch { return null; }
                      })()}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => router.push(`/student/${id}/schedule?sessionId=${session.id}`)}
                    activeOpacity={0.7}
                    style={{ paddingLeft: 12 }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint }}>
                      EDIT
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* History section */}
        <View style={{ marginTop: 32 }}>
          <Text
            style={{
              fontFamily: F.mono,
              fontSize: 11,
              color: COLORS.inkFaint,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 16,
            }}
          >
            HISTORY
          </Text>

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
                color: COLORS.inkFaint,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              LEDGER — LAST 5 ENTRIES
            </Text>
            <Pressable onPress={() => setShowAllLedger(v => !v)}>
              <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkSoft }}>
                {showAllLedger ? 'Less ←' : 'Full →'}
              </Text>
            </Pressable>
          </View>

          {ledger.length === 0 ? (
            <Text
              style={{
                fontFamily: F.serifItalic,
                fontSize: 13,
                color: COLORS.inkFaint,
              }}
            >
              No ledger entries yet.
            </Text>
          ) : (
            visibleLedger.map(entry => (
              <LedgerRow
                key={entry.id}
                entry={buildLedgerEntryWithSession(entry)}
                onPress={entry.related_session_id
                  ? () => router.push(`/lesson/${entry.related_session_id}`)
                  : undefined}
              />
            ))
          )}
        </View>
      </ScrollView>

      <ActionSheet
        visible={showMenu}
        onDismiss={() => setShowMenu(false)}
        items={[
          {
            label: 'Edit details',
            onPress: () => { setShowMenu(false); router.push(`/student/${id}/edit`); },
          },
          {
            label: 'Top up',
            onPress: () => { setShowMenu(false); router.push(`/student/${id}/top-up`); },
          },
          {
            label: 'Schedule lesson',
            onPress: () => { setShowMenu(false); router.push(`/student/${id}/schedule`); },
          },
          ...(student.status === 'active' ? [{
            label: 'Pause student',
            onPress: () => { setShowMenu(false); handlePause(); },
          }] : []),
          ...(student.status === 'paused' ? [{
            label: 'Reactivate',
            onPress: () => { setShowMenu(false); handleReactivate(); },
          }] : []),
          {
            label: 'Archive student',
            destructive: true,
            onPress: () => { setShowMenu(false); handleArchive(); },
          },
        ]}
      />
    </SafeAreaView>
  );
}
