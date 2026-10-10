import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { F, MIN_TOUCH, hitSlopFor } from '../../../src/theme/fonts';
import { COLORS } from '../../../src/theme/colors';
import { useStudent } from '../../../src/hooks/useStudent';
import { ScreenHeader, HeaderIconButton } from '../../../src/components/ScreenHeader';
import { ActionSheet, ActionSheetItem } from '../../../src/components/ActionSheet';
import { useToast } from '../../../src/components/Toast';
import { formatHours, formatScheduledTime } from '../../../src/utils/format';
import { balanceColour, balanceStatus } from '../../../src/utils/balance';
import { LedgerEntry } from '../../../src/db/schema';
import { reactivateStudent } from '../../../src/db/students';
import { getOrCreateTutorProfile, PackageTier } from '../../../src/db/tutorProfile';
import { buildLowBalanceReminderText } from '../../../src/utils/parentMessages';
import { openWhatsApp } from '../../../src/utils/whatsapp';
import { StudentLedgerRow } from '../../../src/components/student/StudentLedgerRow';
import { ParentContactCard } from '../../../src/components/student/ParentContactCard';
import { Button, LoadingState, NotFoundState, SectionLabel } from '../../../src/components/student/ui';
import { confirmArchiveStudent, confirmPauseStudent } from '../../../src/components/student/studentActions';
import {
  archivedToastMessage,
  ledgerRowHref,
  shouldOfferTopUpReminder,
  suggestTopUpPackage,
  upcomingOweWarning,
} from '../../../src/components/student/flowLogic';

function parseTiers(json: string | null | undefined): PackageTier[] {
  try {
    const parsed = JSON.parse(json ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function firstTopic(topicsJson: string | null | undefined): string | null {
  try {
    const t = JSON.parse(topicsJson ?? '[]');
    return Array.isArray(t) && typeof t[0] === 'string' ? t[0] : null;
  } catch {
    return null;
  }
}

export default function StudentDetailScreen() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const router = useRouter();
  const toast = useToast();
  const { student, balance, ledger, upcomingProjected, pastSessions, loading, reload } = useStudent(id);
  const [showMenu, setShowMenu] = useState(false);

  if (loading) return <LoadingState />;
  if (!student) return <NotFoundState title="Student not found" onBack={() => router.back()} />;

  const name = student.full_name.trim();
  const isOwes = Math.round(balance * 60) < 0;
  const statusColour = balanceColour(balanceStatus(balance));
  const nextLesson = upcomingProjected[0];
  const modeLabel = nextLesson ? (nextLesson.mode === 'online' ? 'Online' : 'In-person') : null;
  const showReminder = shouldOfferTopUpReminder(balance);

  let statusTip: string | null = null;
  if (isOwes) statusTip = 'Owes hours — top-up required.';
  else if (balance < 1) statusTip = 'Top-up due.';
  else if (balance < 3) statusTip = 'Running low.';

  const nameParts = name.split(/\s+/);
  const firstName = nameParts.slice(0, -1).join(' ') || nameParts[0];
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';

  function showError(message: string) {
    toast.show({ kind: 'error', message });
  }

  function handleArchive() {
    confirmArchiveStudent({
      studentId: id,
      name,
      balance,
      onArchived: cancelled => {
        toast.show({
          kind: 'success',
          message: archivedToastMessage(cancelled),
          actionLabel: 'View archived',
          onAction: () => router.push('/student/archived'),
        });
        router.back();
      },
      onError: showError,
    });
  }

  function handlePause() {
    confirmPauseStudent({
      studentId: id,
      name,
      onPaused: () => {
        toast.show({ kind: 'success', message: `${nameParts[0]} paused` });
        reload();
      },
      onError: showError,
    });
  }

  function handleReactivate() {
    try {
      reactivateStudent(id);
      toast.show({ kind: 'success', message: `${nameParts[0]} is active again` });
      reload();
    } catch {
      showError("Couldn't reactivate — please try again");
    }
  }

  async function sendReminder() {
    try {
      const profile = getOrCreateTutorProfile();
      const tiers = profile.tier_system_enabled === 1 ? parseTiers(profile.package_tiers) : [];
      const pkg = suggestTopUpPackage(tiers, balance);
      const text = buildLowBalanceReminderText({
        tutorName: profile.full_name,
        studentName: nameParts[0],
        parentName: student?.parent_name,
        balanceHours: balance,
        suggestedPackage: pkg ? { hours: pkg.hours, price: pkg.price } : null,
        paymentDetails: profile.payment_details,
      });
      await openWhatsApp(student?.parent_phone, text);
    } catch {
      showError("Couldn't open WhatsApp");
    }
  }

  function openLedgerEntry(entry: LedgerEntry) {
    const href = ledgerRowHref(entry);
    if (href) router.push(href);
  }

  const menuItems: ActionSheetItem[] = [
    { label: 'Edit details', icon: 'edit-2', onPress: () => { setShowMenu(false); router.push(`/student/${id}/edit`); } },
    { label: 'Correct balance', icon: 'sliders', onPress: () => { setShowMenu(false); router.push(`/student/${id}/adjust`); } },
    { label: 'Log past lesson', icon: 'clock', onPress: () => { setShowMenu(false); router.push(`/student/${id}/log-past`); } },
    ...(student.status === 'active'
      ? [{ label: 'Pause student', icon: 'pause-circle', onPress: () => { setShowMenu(false); handlePause(); } }]
      : []),
    ...(student.status === 'paused'
      ? [{ label: 'Reactivate', icon: 'play-circle', onPress: () => { setShowMenu(false); handleReactivate(); } }]
      : []),
    { label: 'Archive student', icon: 'archive', destructive: true, onPress: () => { setShowMenu(false); handleArchive(); } },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top', 'bottom']}>
      <ScreenHeader
        backLabel={from ?? 'BACK'}
        onBack={() => router.back()}
        right={
          <HeaderIconButton icon="more-horizontal" accessibilityLabel="Student actions" onPress={() => setShowMenu(true)} />
        }
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Meta header */}
        <View style={{ marginTop: 16, marginBottom: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {`STUDENT · GR ${student.grade} · ${student.curriculum}`}
            </Text>
            {student.status === 'paused' ? (
              <View style={{ backgroundColor: COLORS.warnFill, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.amber }}>PAUSED</Text>
              </View>
            ) : null}
          </View>
          <Text style={{ fontFamily: F.serif, fontSize: 32, color: COLORS.ink, lineHeight: 36 }}>
            {firstName}
            {lastName ? `\n${lastName}` : ''}
          </Text>
          <Text style={{ fontFamily: F.serifItalic, fontSize: 15, color: COLORS.inkSoft, marginTop: 4 }}>
            {modeLabel ? `${student.subject} · ${modeLabel}` : student.subject}
          </Text>
        </View>

        {/* Balance hero */}
        <View
          accessible
          accessibilityLabel={`${isOwes ? 'Owes' : 'Balance'} ${formatHours(Math.abs(balance))}`}
          style={{ borderWidth: 1.5, borderColor: COLORS.ink, borderRadius: 16, padding: 20, backgroundColor: COLORS.paperDeep }}
        >
          <View
            pointerEvents="none"
            style={{ position: 'absolute', top: 12, left: 12, right: 12, bottom: 12, borderWidth: 0.5, borderColor: COLORS.inkHairline, borderRadius: 12 }}
          />
          <Text style={{ fontFamily: F.mono, fontSize: 11, color: isOwes ? COLORS.oxblood : COLORS.inkFaint, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
            {isOwes ? '★ HOURS OWED' : '★ REMAINING BALANCE'}
          </Text>
          <Text style={{ fontFamily: F.monoMed, fontSize: 44, color: statusColour, lineHeight: 52 }}>
            {formatHours(Math.abs(balance))}
          </Text>
          {statusTip ? (
            <Text style={{ fontFamily: F.serifItalic, fontSize: 13, color: COLORS.inkSoft, marginTop: 4 }}>{statusTip}</Text>
          ) : null}
          {nextLesson?.scheduled_for ? (
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint, marginTop: 6 }}>
              {`Next: ${formatScheduledTime(nextLesson.scheduled_for)} · ${modeLabel}`}
            </Text>
          ) : null}
        </View>

        {/* Primary actions */}
        <View style={{ marginTop: 16, gap: 10 }}>
          <Button label="Start lesson now" icon="play" onPress={() => router.push(`/start-lesson?studentId=${id}`)} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label="Book lesson" icon="calendar" variant="secondary" style={{ flex: 1 }} onPress={() => router.push(`/student/${id}/schedule`)} />
            <Button label="Top up" icon="plus" variant="secondary" style={{ flex: 1 }} onPress={() => router.push(`/student/${id}/top-up`)} />
          </View>
          {showReminder ? (
            <Button
              label="Send top-up reminder"
              icon="message-circle"
              variant="quiet"
              onPress={sendReminder}
              accessibilityHint="Opens WhatsApp with a reminder for the parent"
            />
          ) : null}
        </View>

        {/* Parent */}
        <View style={{ marginTop: 28 }}>
          <SectionLabel>PARENT</SectionLabel>
          <ParentContactCard
            parentName={student.parent_name}
            parentPhone={student.parent_phone}
            onAddContact={() => router.push(`/student/${id}/edit`)}
            onError={showError}
          />
        </View>

        {/* Upcoming */}
        <View style={{ marginTop: 28 }}>
          <SectionLabel>UPCOMING</SectionLabel>
          {upcomingProjected.length === 0 ? (
            <Text style={{ fontFamily: F.serifItalic, fontSize: 13, color: COLORS.inkFaint }}>No lessons booked.</Text>
          ) : (
            upcomingProjected.map(session => {
              const warn = upcomingOweWarning(session.projected_balance_after);
              const topic = firstTopic(session.topics);
              return (
                <View
                  key={session.id}
                  style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge }}
                >
                  <TouchableOpacity
                    style={{ flex: 1, paddingVertical: 10, minHeight: MIN_TOUCH + 4, justifyContent: 'center' }}
                    onPress={() => router.push(`/lesson/${session.id}`)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Lesson ${session.scheduled_for ? formatScheduledTime(session.scheduled_for) : ''}${warn ? `, ${warn}` : ''}`}
                  >
                    <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.ink }}>
                      {session.scheduled_for ? formatScheduledTime(session.scheduled_for) : '—'}
                      <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkSoft }}>
                        {`  · ${formatHours((session.estimated_duration_minutes ?? 60) / 60)}`}
                      </Text>
                    </Text>
                    <Text numberOfLines={1} style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkSoft, marginTop: 2 }}>
                      {session.mode === 'online' ? 'Online' : 'In-person'}
                      {topic ? ` · ${topic}` : ''}
                    </Text>
                    {warn ? (
                      <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.crimson, marginTop: 2 }}>{warn}</Text>
                    ) : null}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => router.push(`/student/${id}/schedule?sessionId=${session.id}`)}
                    activeOpacity={0.7}
                    hitSlop={hitSlopFor(24)}
                    accessibilityRole="button"
                    accessibilityLabel="Reschedule lesson"
                    style={{ paddingLeft: 12, minHeight: MIN_TOUCH, justifyContent: 'center' }}
                  >
                    <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkSoft }}>MOVE</Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </View>

        {/* Ledger */}
        <View style={{ marginTop: 28 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <SectionLabel style={{ marginBottom: 0 }}>LEDGER — LATEST</SectionLabel>
            {ledger.length > 0 ? (
              <TouchableOpacity
                onPress={() => router.push(`/student/${id}/ledger`)}
                accessibilityRole="button"
                accessibilityLabel="See full ledger"
                style={{ minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, justifyContent: 'center', alignItems: 'flex-end' }}
              >
                <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.oxblood }}>See all →</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {ledger.length === 0 ? (
            <Text style={{ fontFamily: F.serifItalic, fontSize: 13, color: COLORS.inkFaint, marginTop: 6 }}>
              No ledger entries yet — add a top-up to get started.
            </Text>
          ) : (
            ledger.map(entry => (
              <StudentLedgerRow
                key={entry.id}
                entry={entry}
                sessionTopics={pastSessions.find(s => s.id === entry.related_session_id)?.topics}
                onPress={() => openLedgerEntry(entry)}
              />
            ))
          )}
        </View>
      </ScrollView>

      <ActionSheet visible={showMenu} onDismiss={() => setShowMenu(false)} items={menuItems} />
    </SafeAreaView>
  );
}
