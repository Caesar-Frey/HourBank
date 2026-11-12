import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { F, MIN_TOUCH } from '../../src/theme/fonts';
import { COLORS } from '../../src/theme/colors';
import { eventKindStyle } from '../../src/theme/eventColors';
import { HeaderIconButton, ScreenHeader } from '../../src/components/ScreenHeader';
import { useToast } from '../../src/components/Toast';
import { useStartLesson } from '../../src/hooks/useStartLesson';
import {
  cancelScheduled,
  DEFAULT_LESSON_MINUTES,
  getSession,
  markNoShow,
  isChargedNoShow,
  isEditableLesson,
  isRemovedLesson,
  isSessionInClaim,
  removeLesson,
  LessonInClaimError,
} from '../../src/db/sessions';
import { ActionSheet, type ActionSheetItem } from '../../src/components/ActionSheet';
import { BilledMinutesField } from '../../src/components/lesson/LessonFields';
import { billingRoundMinutes } from '../../src/components/lesson/lessonFormData';
import { formatHours } from '../../src/utils/format';
import { getStudent } from '../../src/db/students';
import { currentBalance, getSessionDeduction, type LedgerRow } from '../../src/db/ledger';
import { getPrimarySubjectId, getStudentSubject, getSubjectBalance } from '../../src/db/subjects';
import { formatDateLong, formatMinutes, formatRand, formatTimeRange } from '../../src/utils/format';
import { balanceColour, balanceStatus } from '../../src/utils/balance';
import { Session, Student, PreferredContact } from '../../src/db/schema';
import { getLessonReceiptText, getSessionReceipt, shareSessionReceipt } from '../../src/utils/receipt';
import { openWhatsApp } from '../../src/utils/whatsapp';
import { resolveRecipient } from '../../src/utils/recipient';
import { RecipientChooser } from '../../src/components/student/RecipientChooser';
import {
  PDF_SHARE_SHEET_OPENED_TOAST,
  SHARE_SHEET_OPENED_TOAST,
  ShareStamp,
  pdfShareLabel,
  summaryShareLabel,
} from '../../src/utils/shareCopy';
import { balanceTileText, lessonStatusKind, LessonStatusKind } from '../../src/contexts/SessionTimerContext.helpers';

type Loaded =
  | { state: 'loading' }
  | { state: 'not_found' }
  | {
      state: 'ready';
      session: Session;
      student: Student | null;
      entry: LedgerRow | null;
      /** Current balance of the lesson's subject (student total if it has none). */
      balanceNow: number;
      subjectName: string | null;
    };

/** The lesson's subject (NULL = primary) and its current balance. */
function lessonSubject(session: Session): { name: string | null; balance: number } {
  const sid = session.subject_id ?? getPrimarySubjectId(session.student_id);
  if (!sid) return { name: null, balance: currentBalance(session.student_id) };
  return { name: getStudentSubject(sid)?.subject ?? null, balance: getSubjectBalance(session.student_id, sid) };
}

function parseTopics(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function actualMinutes(s: Session): number | null {
  if (s.duration_minutes != null) return Math.round(s.duration_minutes);
  if (s.started_at && s.ended_at && s.status === 'completed') {
    const ms = new Date(s.ended_at).getTime() - new Date(s.started_at).getTime();
    return Math.max(0, Math.round(ms / 60_000 - (s.paused_seconds ?? 0) / 60));
  }
  return null;
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

const BADGE_LABEL: Record<LessonStatusKind, string> = {
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
  no_show: 'NO-SHOW',
  scheduled: 'SCHEDULED',
  overdue: 'OVERDUE',
  active: 'LIVE',
  paused: 'PAUSED',
};

export default function LessonDetailScreen() {
  const { sessionId, justSaved } = useLocalSearchParams<{ sessionId: string; justSaved?: string }>();
  const router = useRouter();
  const toast = useToast();
  const startLesson = useStartLesson();

  const [data, setData] = useState<Loaded>({ state: 'loading' });
  const [pdfSharedAt, setPdfSharedAt] = useState<string | null>(null);
  const [messageSent, setMessageSent] = useState<ShareStamp>(null);
  const [busy, setBusy] = useState<null | 'pdf' | 'whatsapp'>(null);
  const [noShowOpen, setNoShowOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sendTo, setSendTo] = useState<PreferredContact | null>(null);

  const load = useCallback(() => {
    try {
      const session = getSession(sessionId);
      if (!session) {
        setData({ state: 'not_found' });
        return;
      }
      // Live per-subject balance_after (stored values go stale after edits).
      const entry = getSessionDeduction(sessionId);
      const subject = lessonSubject(session);
      setData({
        state: 'ready',
        session,
        student: getStudent(session.student_id, { includeArchived: true }),
        entry,
        balanceNow: subject.balance,
        subjectName: subject.name,
      });
      const receipt = getSessionReceipt(sessionId);
      setPdfSharedAt(receipt ? (receipt.shared_at ?? receipt.created_at) : null);
    } catch (e) {
      console.error('LessonDetail load error', e);
      setData({ state: 'not_found' });
    }
  }, [sessionId]);

  useFocusEffect(load);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const canRemove = data.state === 'ready' && isEditableLesson(data.session);
  const header = (
    <ScreenHeader
      backLabel="BACK"
      onBack={goBack}
      title="Lesson"
      right={canRemove ? (
        <HeaderIconButton icon="more-horizontal" accessibilityLabel="More lesson actions" onPress={() => setMenuOpen(true)} />
      ) : undefined}
    />
  );

  if (data.state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top', 'bottom']}>
        {header}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={COLORS.inkFaint} />
        </View>
      </SafeAreaView>
    );
  }

  if (data.state === 'not_found') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top', 'bottom']}>
        {header}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Text style={{ fontFamily: F.serif, fontSize: 22, color: COLORS.ink, marginBottom: 8 }}>Lesson not found</Text>
          <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.inkSoft, textAlign: 'center', marginBottom: 24 }}>
            It may have been removed.
          </Text>
          <TouchableOpacity
            onPress={goBack}
            accessibilityRole="button"
            style={{ borderWidth: 1, borderColor: COLORS.ink, borderRadius: 14, minHeight: MIN_TOUCH, paddingHorizontal: 24, justifyContent: 'center' }}
          >
            <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.ink }}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const { session, student, entry, balanceNow, subjectName } = data;
  const kind = lessonStatusKind(session);
  const badge = eventKindStyle(kind);
  const topics = parseTopics(session.topics);
  const booked = session.estimated_duration_minutes;
  const isUpcoming = kind === 'scheduled' || kind === 'overdue';
  const hasStarted = session.scheduled_for ? new Date(session.scheduled_for).getTime() <= Date.now() : true;
  const studentName = student?.full_name ?? 'Student';
  const recipient = student
    ? resolveRecipient(student, sendTo)
    : { phone: null, name: null, who: 'parent' as const };

  // ── When ──
  const whenStart = session.started_at ?? session.scheduled_for;
  const whenEnd = session.started_at
    ? session.ended_at
    : session.scheduled_for
      ? addMinutes(session.scheduled_for, booked ?? DEFAULT_LESSON_MINUTES)
      : null;
  const dateText = whenStart ? formatDateLong(whenStart) : session.ended_at ? formatDateLong(session.ended_at) : '—';
  const timeText = whenStart && whenEnd ? formatTimeRange(whenStart, whenEnd) : null;

  // ── Tiles ──
  const actual = actualMinutes(session);
  const balanceBefore = entry ? entry.balance_after - entry.hours_delta : isUpcoming ? balanceNow : null;
  const balanceAfter = entry
    ? entry.balance_after
    : isUpcoming
      ? balanceNow - (booked ?? DEFAULT_LESSON_MINUTES) / 60
      : null;
  const tiles: { label: string; value: string; colour: string }[] = [
    {
      label: isUpcoming ? 'Booked' : 'Duration',
      value: isUpcoming ? formatMinutes(booked ?? DEFAULT_LESSON_MINUTES) : actual != null ? formatMinutes(actual) : '—',
      colour: COLORS.ink,
    },
    {
      label: 'Billed',
      value: session.billed_minutes != null ? formatMinutes(session.billed_minutes) : isUpcoming ? 'Not yet' : 'None',
      colour: session.billed_minutes != null ? COLORS.ink : COLORS.inkFaint,
    },
    {
      label: isUpcoming ? 'Balance now' : 'Balance before',
      value: balanceBefore != null ? balanceTileText(balanceBefore) : '—',
      colour: balanceBefore != null ? balanceColour(balanceStatus(balanceBefore)) : COLORS.inkFaint,
    },
    {
      label: isUpcoming ? 'After lesson' : 'Balance after',
      value: balanceAfter != null ? balanceTileText(balanceAfter) : '—',
      colour: balanceAfter != null ? balanceColour(balanceStatus(balanceAfter)) : COLORS.inkFaint,
    },
  ];

  // ── Actions ──
  async function handleWhatsApp() {
    if (busy) return;
    const text = getLessonReceiptText(sessionId, { recipientName: recipient.name, audience: recipient.who });
    if (!text) {
      toast.show({ kind: 'error', message: "Couldn't build the lesson summary" });
      return;
    }
    setBusy('whatsapp');
    try {
      if (recipient.phone) {
        const result = await openWhatsApp(recipient.phone, text);
        if (result === 'dismissed') return;
        setMessageSent({ via: result === 'whatsapp' ? 'whatsapp' : 'sheet', at: new Date().toISOString() });
        toast.show({ kind: 'success', message: result === 'whatsapp' ? 'Opened in WhatsApp — tap send there' : SHARE_SHEET_OPENED_TOAST });
      } else {
        const result = await Share.share({ message: text });
        if (result.action === Share.dismissedAction) return;
        setMessageSent({ via: 'sheet', at: new Date().toISOString() });
        toast.show({ kind: 'success', message: SHARE_SHEET_OPENED_TOAST });
      }
    } catch (e) {
      console.error('WhatsApp share error', e);
      toast.show({ kind: 'error', message: "Couldn't open WhatsApp or the share sheet" });
    } finally {
      setBusy(null);
    }
  }

  async function handleSharePdf() {
    if (busy) return;
    setBusy('pdf');
    try {
      const res = await shareSessionReceipt(sessionId);
      if (res.shared) {
        setPdfSharedAt(new Date().toISOString());
        toast.show({ kind: 'success', message: PDF_SHARE_SHEET_OPENED_TOAST });
      }
    } catch (e) {
      console.error('shareSessionReceipt error', e);
      toast.show({ kind: 'error', message: "Couldn't share the receipt. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  function handleEdit() {
    router.push(`/lesson/edit/${sessionId}`);
  }

  function handleStart() {
    startLesson(sessionId, {
      studentName,
      onStarted: () => router.replace(`/student/${session.student_id}/session?sessionId=${sessionId}`),
    });
  }

  function handleRecord() {
    router.push(`/student/${session.student_id}/log-past?sessionId=${sessionId}&from=lesson`);
  }

  function handleReschedule() {
    router.push(`/student/${session.student_id}/schedule?sessionId=${sessionId}&from=lesson`);
  }

  function handleCancel() {
    Alert.alert('Cancel this lesson?', `The lesson with ${studentName} will be marked cancelled. No hours are deducted.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel lesson',
        style: 'destructive',
        onPress: () => {
          try {
            cancelScheduled(sessionId);
            toast.show({ kind: 'success', message: 'Lesson cancelled' });
          } catch (e) {
            console.error('cancelScheduled error', e);
            toast.show({ kind: 'error', message: "Couldn't cancel — the lesson may have changed" });
          }
          load();
        },
      },
    ]);
  }

  function confirmNoShow(charge: boolean, minutes: number, includeTravel: boolean) {
    setNoShowOpen(false);
    try {
      markNoShow(sessionId, { charge, minutes: charge ? minutes : undefined, includeTravel });
      toast.show({
        kind: 'success',
        message: charge ? `Marked no-show · ${formatMinutes(minutes)} deducted` : 'Marked no-show · nothing deducted',
      });
    } catch (e) {
      console.error('markNoShow error', e);
      toast.show({ kind: 'error', message: "Couldn't mark no-show — the lesson may have changed" });
    }
    load();
  }

  function confirmRemove() {
    setMenuOpen(false);
    const first = studentName.trim().split(/\s+/)[0];
    if (isSessionInClaim(sessionId)) {
      Alert.alert('This lesson is in a claim', 'Void the claim first, then remove the lesson.', [{ text: 'OK' }]);
      return;
    }
    const hours = (session.billed_minutes ?? 0) / 60;
    const credit = subjectName ? `${first}'s ${subjectName} credit` : `${first}'s credit`;
    Alert.alert(
      'Remove this lesson?',
      `The lesson is struck from history and ${formatHours(hours)} goes back to ${credit}.`,
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Remove lesson',
          style: 'destructive',
          onPress: () => {
            try {
              removeLesson(sessionId);
              toast.show({ kind: 'success', message: `Lesson removed · ${formatHours(hours)} returned` });
            } catch (e) {
              console.error('removeLesson error', e);
              toast.show({
                kind: 'error',
                message: e instanceof LessonInClaimError ? 'This lesson is in a claim. Void the claim first.' : "Couldn't remove the lesson — please try again",
              });
            }
            load();
          },
        },
      ],
    );
  }

  const menuItems: ActionSheetItem[] = [
    { label: 'Edit lesson', icon: 'edit-2', onPress: () => { setMenuOpen(false); handleEdit(); } },
    { label: 'Remove lesson…', icon: 'trash-2', destructive: true, onPress: confirmRemove },
  ];

  const sectionLabel = { fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, letterSpacing: 1, marginBottom: 6 } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top', 'bottom']}>
      {header}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 32 }}>
        {/* Status badge + student */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <View style={{ backgroundColor: badge.fill, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ fontFamily: F.monoMed, fontSize: 10, color: badge.fg, letterSpacing: 1 }}>{BADGE_LABEL[kind]}</Text>
          </View>
          <View style={{ borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkSoft, letterSpacing: 1 }}>
              {session.mode === 'online' ? 'ONLINE' : 'IN-PERSON'}
            </Text>
          </View>
          {session.session_type !== 'general' && (
            <View style={{ borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ fontFamily: F.sansMed, fontSize: 10, color: COLORS.ink, textTransform: 'uppercase' }}>
                {session.session_type === 'review' ? 'Review' : session.session_type === 'test_prep' ? 'Test Prep' : 'Exam Prep'}
              </Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          onPress={() => router.push(`/student/${session.student_id}`)}
          accessibilityRole="link"
          accessibilityLabel={`Open ${studentName}'s profile`}
          style={{ alignSelf: 'flex-start', minHeight: MIN_TOUCH, justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: F.serif, fontSize: 26, color: COLORS.ink }}>{studentName}</Text>
        </TouchableOpacity>
        <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkSoft, marginBottom: 4 }}>
          {timeText ? `${dateText} · ${timeText}` : dateText}
        </Text>
        {session.edited_at ? (
          <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint, marginBottom: 4 }}>
            {`Edited ${formatDateLong(session.edited_at)}`}
          </Text>
        ) : null}
        {isRemovedLesson(session) ? (
          <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkFaint }}>
            {`Removed${session.removed_at ? ` ${formatDateLong(session.removed_at)}` : ''} — its hours went back to the student's credit.`}
          </Text>
        ) : null}
        {kind === 'cancelled' && session.cancel_reason === 'discarded' ? (
          <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkFaint }}>Discarded during the lesson — nothing deducted.</Text>
        ) : null}
        {kind === 'no_show' ? (
          <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkFaint }}>
            {session.billed_minutes ? 'Student did not show — charged.' : 'Student did not show — not charged.'}
          </Text>
        ) : null}
        {kind === 'overdue' ? (
          <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.oxblood }}>
            This lesson's time has passed and it hasn't been recorded. What happened?
          </Text>
        ) : null}

        {/* 2×2 tiles */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 20, marginBottom: 24, marginHorizontal: -6 }}>
          {tiles.map(t => (
            <View key={t.label} style={{ width: '50%', padding: 6 }}>
              <View style={{ borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 14, padding: 14, minHeight: 72 }}>
                <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                  {t.label}
                </Text>
                <Text style={{ fontFamily: F.monoMed, fontSize: 17, color: t.colour }}>{t.value}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Subject + grade */}
        {student && (
          <View style={{ marginBottom: 20 }}>
            <Text style={sectionLabel}>SUBJECT</Text>
            <Text style={{ fontFamily: F.sans, fontSize: 15, color: COLORS.ink }}>
              {subjectName ?? student.subject}
              <Text style={{ color: COLORS.inkSoft }}>{' · Grade '}{student.grade}</Text>
            </Text>
          </View>
        )}

        {session.mode === 'in_person' && (kind === 'completed' || session.travel_km != null || session.no_show_travel === 1) ? (
          <View style={{ marginBottom: 20 }}>
            <Text style={sectionLabel}>TRAVEL</Text>
            <Text style={{ fontFamily: F.mono, fontSize: 14, color: COLORS.ink }}>
              {[
                session.travel_km != null ? `${session.travel_km} km` : kind === 'completed' ? null : 'student default km',
                (kind === 'completed' || kind === 'no_show') && (session.parent_travel_fee ?? 0) > 0 ? `${formatRand(session.parent_travel_fee ?? 0)} to parent` : null,
              ].filter(Boolean).join(' · ') || '—'}
            </Text>
          </View>
        ) : null}

        {topics.length > 0 && (
          <View style={{ marginBottom: 20 }}>
            <Text style={{ ...sectionLabel, marginBottom: 8 }}>TOPICS</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {topics.map(topic => (
                <View
                  key={topic}
                  style={{ borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: COLORS.paperDeep }}
                >
                  <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft }}>{topic}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {session.session_notes ? (
          <View style={{ marginBottom: 20 }}>
            <Text style={sectionLabel}>NOTES</Text>
            <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.inkSoft, lineHeight: 20 }}>{session.session_notes}</Text>
          </View>
        ) : null}

        {/* Completed → tell the parent */}
        {kind === 'completed' && (
          <View style={{ marginTop: 8, gap: 10 }}>
            {justSaved ? (
              <Text style={{ fontFamily: F.serifItalic, fontSize: 18, color: COLORS.ink, marginBottom: 2 }}>
                {recipient.who === 'student' ? `Let ${recipient.name ?? 'the student'} know.` : 'Let the parent know.'}
              </Text>
            ) : null}
            <RecipientChooser student={student} value={recipient.who} onChange={setSendTo} />
            <PrimaryButton
              label={summaryShareLabel(messageSent, { parentPhone: !!recipient.phone, parentName: recipient.name })}
              onPress={handleWhatsApp}
              busy={busy === 'whatsapp'}
              done={messageSent != null}
            />
            <SecondaryButton label={pdfShareLabel(pdfSharedAt)} onPress={handleSharePdf} busy={busy === 'pdf'} />
            <TouchableOpacity
              onPress={handleEdit}
              accessibilityRole="button"
              accessibilityLabel="Edit lesson"
              style={{ minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.oxblood }}>Edit lesson</Text>
            </TouchableOpacity>
            {!recipient.phone ? (
              <TouchableOpacity onPress={() => router.push(`/student/${session.student_id}/edit`)} style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}>
                <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkSoft, textAlign: 'center' }}>
                  Add a parent or student WhatsApp number to send directly →
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {/* Charged no-show → fix the charge (billed time, subject, notes) */}
        {kind === 'no_show' && isChargedNoShow(session) ? (
          <TouchableOpacity
            onPress={handleEdit}
            accessibilityRole="button"
            accessibilityLabel="Edit lesson"
            style={{ minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', marginTop: 8 }}
          >
            <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.oxblood }}>Edit lesson</Text>
          </TouchableOpacity>
        ) : null}

        {/* In flight → back to the timer */}
        {(kind === 'active' || kind === 'paused') && (
          <PrimaryButton
            label={kind === 'paused' ? 'Open paused lesson' : 'Open live lesson'}
            onPress={() => router.push(`/student/${session.student_id}/session?sessionId=${sessionId}`)}
          />
        )}

        {/* Scheduled / overdue → action hub */}
        {isUpcoming && (
          <View style={{ marginTop: 8, gap: 10 }}>
            <PrimaryButton label="Record lesson" onPress={handleRecord} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <SecondaryButton label="▶ Start timer" onPress={handleStart} />
              </View>
              {hasStarted ? (
                <View style={{ flex: 1 }}>
                  <SecondaryButton label="No-show…" onPress={() => setNoShowOpen(true)} />
                </View>
              ) : null}
            </View>
            <SecondaryButton label="Reschedule" onPress={handleReschedule} />
            <TouchableOpacity
              onPress={handleCancel}
              accessibilityRole="button"
              style={{ minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.crimson }}>Cancel lesson</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <NoShowSheet
        visible={noShowOpen}
        studentName={studentName}
        defaultMinutes={booked ?? DEFAULT_LESSON_MINUTES}
        inPerson={session.mode === 'in_person'}
        step={billingRoundMinutes()}
        onCancel={() => setNoShowOpen(false)}
        onConfirm={confirmNoShow}
      />
      <ActionSheet visible={menuOpen} onDismiss={() => setMenuOpen(false)} items={menuItems} />
    </SafeAreaView>
  );
}

// ─── Buttons ────────────────────────────────────────────────────────────────

function PrimaryButton({ label, onPress, busy, done }: { label: string; onPress: () => void; busy?: boolean; done?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      activeOpacity={0.85}
      style={{
        backgroundColor: done ? COLORS.paperDeep : COLORS.oxblood,
        borderWidth: done ? 1 : 0,
        borderColor: COLORS.paperEdge,
        borderRadius: 14,
        minHeight: 52,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: busy ? 0.6 : 1,
      }}
    >
      {busy ? (
        <ActivityIndicator color={done ? COLORS.ink : COLORS.paper} />
      ) : (
        <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: done ? COLORS.inkSoft : COLORS.paper }}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

function SecondaryButton({ label, onPress, busy }: { label: string; onPress: () => void; busy?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      activeOpacity={0.8}
      style={{
        borderWidth: 1,
        borderColor: COLORS.ink,
        borderRadius: 14,
        minHeight: 48,
        paddingHorizontal: 12,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: busy ? 0.6 : 1,
      }}
    >
      {busy ? (
        <ActivityIndicator color={COLORS.ink} />
      ) : (
        <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.ink }} numberOfLines={1}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

// ─── No-show sheet ──────────────────────────────────────────────────────────

function NoShowSheet({
  visible,
  studentName,
  defaultMinutes,
  inPerson,
  step,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  studentName: string;
  defaultMinutes: number;
  /** Only an in-person lesson can carry travel. */
  inPerson: boolean;
  /** Lesson-length step from Settings (15 or 30). */
  step: number;
  onCancel: () => void;
  onConfirm: (charge: boolean, minutes: number, includeTravel: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const [charge, setCharge] = useState(false);
  const [includeTravel, setIncludeTravel] = useState(false);
  const [minutes, setMinutes] = useState(defaultMinutes);

  const onShow = () => {
    setCharge(false);
    setIncludeTravel(false);
    setMinutes(defaultMinutes);
  };

  const switchRow = (label: string, value: boolean, onChange: (v: boolean) => void, hint?: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: MIN_TOUCH, marginBottom: 8, gap: 12 }}>
      <View style={{ flexShrink: 1 }}>
        <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.ink }}>{label}</Text>
        {hint ? <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft, marginTop: 2 }}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: COLORS.paperEdge, true: COLORS.oxblood }}
        thumbColor={COLORS.paper}
        accessibilityLabel={label}
      />
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel} onShow={onShow}>
      <Pressable style={{ flex: 1, backgroundColor: COLORS.scrim }} onPress={onCancel} accessibilityLabel="Close" />
      <View
        style={{
          backgroundColor: COLORS.paper,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          paddingHorizontal: 24,
          paddingTop: 20,
          paddingBottom: 20 + insets.bottom,
        }}
      >
        <Text style={{ fontFamily: F.serif, fontSize: 22, color: COLORS.ink }}>Mark as no-show</Text>
        <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.inkSoft, marginTop: 6, marginBottom: 16 }}>
          {`${studentName} didn't attend. The lesson is closed as a no-show.`}
        </Text>

        {switchRow('Charge for this lesson', charge, setCharge)}

        {charge ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, letterSpacing: 1 }}>DEDUCT</Text>
            <BilledMinutesField value={minutes} onChange={setMinutes} step={step} label="Deduct" />
          </View>
        ) : null}

        {charge && inPerson
          ? switchRow('Include travel', includeTravel, setIncludeTravel, 'Charge the parent travel and claim your travel for this lesson.')
          : null}

        <TouchableOpacity
          onPress={() => onConfirm(charge, minutes, charge && inPerson && includeTravel)}
          accessibilityRole="button"
          style={{ backgroundColor: COLORS.oxblood, borderRadius: 14, minHeight: 52, alignItems: 'center', justifyContent: 'center', marginTop: 8 }}
        >
          <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.paper }}>
            {charge ? `Mark no-show · deduct ${formatMinutes(minutes)}` : 'Mark no-show · no charge'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onCancel} accessibilityRole="button" style={{ minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', marginTop: 4 }}>
          <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.inkSoft }}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

function StepButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={{
        minWidth: MIN_TOUCH + 8,
        minHeight: MIN_TOUCH,
        borderWidth: 1,
        borderColor: COLORS.paperEdge,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.ink }}>{label}</Text>
    </TouchableOpacity>
  );
}
