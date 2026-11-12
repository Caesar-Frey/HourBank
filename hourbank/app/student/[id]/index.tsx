import React, { useCallback, useState } from 'react';
import { Alert, View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { F, MIN_TOUCH, hitSlopFor } from '../../../src/theme/fonts';
import { COLORS } from '../../../src/theme/colors';
import { useStudent } from '../../../src/hooks/useStudent';
import { ScreenHeader, HeaderIconButton } from '../../../src/components/ScreenHeader';
import { ActionSheet, ActionSheetItem } from '../../../src/components/ActionSheet';
import { useToast } from '../../../src/components/Toast';
import { formatHours, formatScheduledTime } from '../../../src/utils/format';
import { balanceColour, balanceStatus } from '../../../src/utils/balance';
import { LedgerEntry, PreferredContact } from '../../../src/db/schema';
import { reactivateStudent, restoreStudent } from '../../../src/db/students';
import { getPrimarySubjectId, getSubjectBalances, listStudentSubjects, SubjectBalance } from '../../../src/db/subjects';
import type { LedgerRow } from '../../../src/db/ledger';
import { SubjectBalanceCard } from '../../../src/components/student/SubjectBalanceCard';
import { TravelOwedCard } from '../../../src/components/student/TravelOwedCard';
import { lessonSubjectName, lowestSubject } from '../../../src/components/student/subjectLogic';
import { getLowBalanceReminderText } from '../../../src/utils/receipt';
import { getOrCreateTutorProfile } from '../../../src/db/tutorProfile';
import { openWhatsApp } from '../../../src/utils/whatsapp';
import { resolveRecipient } from '../../../src/utils/recipient';
import { StudentLedgerRow } from '../../../src/components/student/StudentLedgerRow';
import { ContactsCard } from '../../../src/components/student/ContactsCard';
import { RecipientChooser } from '../../../src/components/student/RecipientChooser';
import { Button, LoadingState, NotFoundState, SectionLabel } from '../../../src/components/student/ui';
import { confirmArchiveStudent, confirmPauseStudent } from '../../../src/components/student/studentActions';
import {
  archivedToastMessage,
  ledgerRowHref,
  shouldOfferTopUpReminder,
  upcomingOweWarning,
} from '../../../src/components/student/flowLogic';

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
  const [sendTo, setSendTo] = useState<PreferredContact | null>(null);
  // Each subject has its own balance (migration 009).
  const [subjects, setSubjects] = useState<SubjectBalance[]>([]);
  const [subjectNames, setSubjectNames] = useState<Record<string, string>>({});
  const [primaryId, setPrimaryId] = useState<string | null>(null);

  const loadSubjects = useCallback(() => {
    try {
      setSubjects(getSubjectBalances(id));
      const names: Record<string, string> = {};
      for (const s of listStudentSubjects(id, { includeArchived: true })) names[s.id] = s.subject;
      setSubjectNames(names);
      setPrimaryId(getPrimarySubjectId(id));
    } catch {
      setSubjects([]);
    }
  }, [id]);
  useFocusEffect(loadSubjects);

  const reloadAll = useCallback(() => {
    reload();
    loadSubjects();
  }, [reload, loadSubjects]);

  if (loading) return <LoadingState />;
  if (!student) return <NotFoundState title="Student not found" onBack={() => router.back()} />;

  const name = student.full_name.trim();
  // Archived students open read-only (B6): history stays reachable, actions hidden.
  const archived = student.status === 'archived';
  const isOwes = Math.round(balance * 60) < 0;
  const statusColour = balanceColour(balanceStatus(balance));
  const nextLesson = upcomingProjected[0];
  const modeLabel = nextLesson ? (nextLesson.mode === 'online' ? 'Online' : 'In-person') : null;
  const activeSubjects = subjects.filter(s => s.status === 'active');
  // Single-subject students look exactly like before (no per-subject clutter).
  const multiSubject = subjects.length > 1;
  const lowest = lowestSubject(subjects);
  const reminderBalance = multiSubject && lowest ? lowest.balance_hours : balance;
  const showReminder = shouldOfferTopUpReminder(reminderBalance);
  const subjectLine = activeSubjects.length > 0 ? activeSubjects.map(s => s.subject).join(' · ') : student.subject;
  const subjectQuery = (subjectId: string) => `subjectId=${encodeURIComponent(subjectId)}`;

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

  function handleRestore() {
    try {
      restoreStudent(id);
      toast.show({ kind: 'success', message: `${student!.full_name.trim().split(/\s+/)[0]} restored` });
      reloadAll();
    } catch {
      showError('Couldn’t restore this student. Try again.');
    }
  }

  function handlePause() {
    confirmPauseStudent({
      studentId: id,
      name,
      onPaused: () => {
        toast.show({ kind: 'success', message: `${nameParts[0]} paused` });
        reloadAll();
      },
      onError: showError,
    });
  }

  function handleReactivate() {
    try {
      reactivateStudent(id);
      toast.show({ kind: 'success', message: `${nameParts[0]} is active again` });
      reloadAll();
    } catch {
      showError("Couldn't reactivate — please try again");
    }
  }

  const recipient = resolveRecipient(student, sendTo);

  function sendReminder() {
    if (!student) return;
    let hasDetails = true;
    try {
      hasDetails = !!getOrCreateTutorProfile().payment_details?.trim();
    } catch { /* send anyway */ }
    if (hasDetails) {
      void sendReminderNow();
      return;
    }
    Alert.alert('No bank details yet', "Parents won't know how to pay you.", [
      { text: 'Add bank details', onPress: () => router.navigate('/profile?focus=payment') },
      { text: 'Send anyway', onPress: () => { void sendReminderNow(); } },
    ]);
  }

  async function sendReminderNow() {
    if (!student) return;
    try {
      // Subject balance(s), suggested package, travel owed, payment details + reference.
      const text = getLowBalanceReminderText(student.id, {
        recipientName: recipient.name,
        audience: recipient.who,
      });
      if (!text) throw new Error('student not found');
      await openWhatsApp(recipient.phone, text);
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
        right={archived ? undefined : (
          <HeaderIconButton icon="more-horizontal" accessibilityLabel="Student actions" onPress={() => setShowMenu(true)} />
        )}
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
            {modeLabel ? `${subjectLine} · ${modeLabel}` : subjectLine}
          </Text>
        </View>

        {archived ? (
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: COLORS.paperEdge, backgroundColor: COLORS.cardFill, borderRadius: 12, paddingLeft: 14, marginBottom: 16 }}
            testID="student-archived-banner"
          >
            <Feather name="archive" size={16} color={COLORS.inkSoft} />
            <Text style={{ flex: 1, fontFamily: F.mono, fontSize: 12, color: COLORS.inkSoft, letterSpacing: 0.5 }}>ARCHIVED</Text>
            <TouchableOpacity
              onPress={handleRestore}
              accessibilityRole="button"
              accessibilityLabel={`Restore ${name}`}
              style={{ minHeight: MIN_TOUCH, paddingHorizontal: 14, justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.oxblood }}>Restore</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {multiSubject ? (
          <View style={{ gap: 10 }}>
            {subjects.map(sub => (
              <SubjectBalanceCard
                key={sub.id}
                subject={sub.subject}
                balanceHours={sub.balance_hours}
                archived={sub.status === 'archived'}
                onTopUp={archived ? undefined : () => router.push(`/student/${id}/top-up?${subjectQuery(sub.id)}`)}
                onRecord={archived ? undefined : () => router.push(`/student/${id}/log-past?${subjectQuery(sub.id)}`)}
                onBook={archived ? undefined : () => router.push(`/student/${id}/schedule?${subjectQuery(sub.id)}`)}
              />
            ))}
            {nextLesson?.scheduled_for ? (
              <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint }}>
                {`Next: ${formatScheduledTime(nextLesson.scheduled_for)} · ${lessonSubjectName(nextLesson.subject_id, subjectNames, primaryId) ?? ''} · ${modeLabel}`}
              </Text>
            ) : null}
          </View>
        ) : (
          <>
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

          </>
        )}

        {/* Primary actions */}
        {archived ? null : (
        <View style={{ marginTop: 16, gap: 10 }}>
          <Button label="Start lesson now" icon="play" onPress={() => router.push(`/start-lesson?studentId=${id}`)} />
          {multiSubject ? null : (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button label="Book lesson" icon="calendar" variant="secondary" style={{ flex: 1 }} onPress={() => router.push(`/student/${id}/schedule`)} />
              <Button label="Top up" icon="plus" variant="secondary" style={{ flex: 1 }} onPress={() => router.push(`/student/${id}/top-up`)} />
            </View>
          )}
          {showReminder ? (
            <View style={{ gap: 8 }}>
              <RecipientChooser student={student} value={recipient.who} onChange={setSendTo} />
              <Button
                label="Send top-up reminder"
                icon="message-circle"
                variant="quiet"
                onPress={sendReminder}
                accessibilityHint={`Opens WhatsApp with a reminder for the ${recipient.who}`}
              />
              {multiSubject && lowest ? (
                <Text style={{ fontFamily: F.serifItalic, fontSize: 12, color: COLORS.inkSoft, textAlign: 'center' }}>
                  {`About ${lowest.subject} — the lowest balance.`}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>

        )}

        {/* Parent travel owed (B3) */}
        {archived ? null : (
          <View style={{ marginTop: 16 }}>
            <TravelOwedCard studentId={id} onChanged={reloadAll} />
          </View>
        )}

        {/* Contacts */}
        <View style={{ marginTop: 28 }}>
          <SectionLabel>CONTACTS</SectionLabel>
          <ContactsCard
            student={student}
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
                      {multiSubject ? ` · ${lessonSubjectName(session.subject_id, subjectNames, primaryId) ?? ''}` : ''}
                      {topic ? ` · ${topic}` : ''}
                    </Text>
                    {warn ? (
                      <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.crimson, marginTop: 2 }}>{warn}</Text>
                    ) : null}
                  </TouchableOpacity>
                  {archived ? null : <TouchableOpacity
                    onPress={() => router.push(`/student/${id}/schedule?sessionId=${session.id}`)}
                    activeOpacity={0.7}
                    hitSlop={hitSlopFor(24)}
                    accessibilityRole="button"
                    accessibilityLabel="Reschedule lesson"
                    style={{ paddingLeft: 12, minHeight: MIN_TOUCH, justifyContent: 'center' }}
                  >
                    <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkSoft }}>MOVE</Text>
                  </TouchableOpacity>}
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
                subjectName={multiSubject ? (entry as LedgerRow).subject_name : null}
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
