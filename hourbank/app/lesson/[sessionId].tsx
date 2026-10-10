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
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { useToast } from '../../src/components/Toast';
import { useStartLesson } from '../../src/hooks/useStartLesson';
import {
  cancelScheduled,
  DEFAULT_LESSON_MINUTES,
  getSession,
  markNoShow,
} from '../../src/db/sessions';
import { getStudent } from '../../src/db/students';
import { currentBalance } from '../../src/db/ledger';
import { getDb } from '../../src/db/client';
import { formatDateLong, formatMinutes, formatTimeRange } from '../../src/utils/format';
import { balanceColour, balanceStatus } from '../../src/utils/balance';
import { Session, LedgerEntry, Student } from '../../src/db/schema';
import { getLessonReceiptText, getSessionReceipt, shareSessionReceipt } from '../../src/utils/receipt';
import { normaliseSaPhone, openWhatsApp } from '../../src/utils/whatsapp';
import { balanceTileText, lessonStatusKind, LessonStatusKind } from '../../src/contexts/SessionTimerContext.helpers';

type Loaded =
  | { state: 'loading' }
  | { state: 'not_found' }
  | { state: 'ready'; session: Session; student: Student | null; entry: LedgerEntry | null; balanceNow: number };

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
  const [pdfShared, setPdfShared] = useState(false);
  const [messageSent, setMessageSent] = useState<null | 'whatsapp' | 'shared'>(null);
  const [busy, setBusy] = useState<null | 'pdf' | 'whatsapp'>(null);
  const [noShowOpen, setNoShowOpen] = useState(false);

  const load = useCallback(() => {
    try {
      const session = getSession(sessionId);
      if (!session) {
        setData({ state: 'not_found' });
        return;
      }
      const entry =
        getDb().getFirstSync<LedgerEntry>(
          'SELECT * FROM ledger_entries WHERE related_session_id = ? ORDER BY created_at ASC LIMIT 1',
          [sessionId],
        ) ?? null;
      setData({
        state: 'ready',
        session,
        student: getStudent(session.student_id),
        entry,
        balanceNow: currentBalance(session.student_id),
      });
      setPdfShared(getSessionReceipt(sessionId) != null);
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

  const header = <ScreenHeader backLabel="BACK" onBack={goBack} title="Lesson" />;

  if (data.state === 'loading') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
        {header}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={COLORS.inkFaint} />
        </View>
      </SafeAreaView>
    );
  }

  if (data.state === 'not_found') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
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

  const { session, student, entry, balanceNow } = data;
  const kind = lessonStatusKind(session);
  const badge = eventKindStyle(kind);
  const topics = parseTopics(session.topics);
  const booked = session.estimated_duration_minutes;
  const isUpcoming = kind === 'scheduled' || kind === 'overdue';
  const hasStarted = session.scheduled_for ? new Date(session.scheduled_for).getTime() <= Date.now() : true;
  const studentName = student?.full_name ?? 'Student';
  const parentPhone = normaliseSaPhone(student?.parent_phone);

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
    const text = getLessonReceiptText(sessionId, { parentName: student?.parent_name });
    if (!text) {
      toast.show({ kind: 'error', message: "Couldn't build the lesson summary" });
      return;
    }
    setBusy('whatsapp');
    try {
      if (parentPhone) {
        const result = await openWhatsApp(parentPhone, text);
        if (result === 'dismissed') return;
        setMessageSent(result === 'whatsapp' ? 'whatsapp' : 'shared');
        toast.show({ kind: 'success', message: result === 'whatsapp' ? 'Opened in WhatsApp — tap send there' : 'Summary shared' });
      } else {
        const result = await Share.share({ message: text });
        if (result.action === Share.dismissedAction) return;
        setMessageSent('shared');
        toast.show({ kind: 'success', message: 'Summary shared' });
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
        setPdfShared(true);
        toast.show({ kind: 'success', message: 'Receipt PDF shared' });
      }
    } catch (e) {
      console.error('shareSessionReceipt error', e);
      toast.show({ kind: 'error', message: "Couldn't share the receipt. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  function handleStart() {
    startLesson(sessionId, {
      studentName,
      onStarted: () => router.replace(`/student/${session.student_id}/session?sessionId=${sessionId}`),
    });
  }

  function handleLogAsTaught() {
    router.push(`/student/${session.student_id}/log-past?sessionId=${sessionId}`);
  }

  function handleReschedule() {
    router.push(`/student/${session.student_id}/schedule?sessionId=${sessionId}`);
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

  function confirmNoShow(charge: boolean, minutes: number) {
    setNoShowOpen(false);
    try {
      markNoShow(sessionId, { charge, minutes: charge ? minutes : undefined });
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
            This lesson's time has passed and it was never started. What happened?
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
              {student.subject}
              <Text style={{ color: COLORS.inkSoft }}>{' · Grade '}{student.grade}</Text>
            </Text>
          </View>
        )}

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
              <Text style={{ fontFamily: F.serifItalic, fontSize: 18, color: COLORS.ink, marginBottom: 2 }}>Let the parent know.</Text>
            ) : null}
            <PrimaryButton
              label={
                messageSent === 'whatsapp'
                  ? 'Opened in WhatsApp ✓ · Send again'
                  : messageSent === 'shared'
                    ? 'Summary shared ✓ · Share again'
                    : parentPhone
                    ? `Send to ${student?.parent_name?.trim() || 'parent'} via WhatsApp`
                    : 'Share lesson summary'
              }
              onPress={handleWhatsApp}
              busy={busy === 'whatsapp'}
              done={messageSent != null}
            />
            <SecondaryButton label={pdfShared ? 'Receipt PDF shared ✓ · Share again' : 'Share PDF receipt'} onPress={handleSharePdf} busy={busy === 'pdf'} />
            {!parentPhone ? (
              <TouchableOpacity onPress={() => router.push(`/student/${session.student_id}/edit`)} style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}>
                <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkSoft, textAlign: 'center' }}>
                  Add a parent WhatsApp number to send directly →
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

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
            <PrimaryButton label="▶ Start now" onPress={handleStart} />
            {hasStarted ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <SecondaryButton label="Log as taught" onPress={handleLogAsTaught} />
                </View>
                <View style={{ flex: 1 }}>
                  <SecondaryButton label="No-show…" onPress={() => setNoShowOpen(true)} />
                </View>
              </View>
            ) : null}
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
        onCancel={() => setNoShowOpen(false)}
        onConfirm={confirmNoShow}
      />
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
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  studentName: string;
  defaultMinutes: number;
  onCancel: () => void;
  onConfirm: (charge: boolean, minutes: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [charge, setCharge] = useState(false);
  const [minutes, setMinutes] = useState(defaultMinutes);

  const onShow = () => {
    setCharge(false);
    setMinutes(defaultMinutes);
  };

  const step = (delta: number) => setMinutes(m => Math.max(15, m + delta));

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

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: MIN_TOUCH, marginBottom: 8 }}>
          <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.ink, flexShrink: 1 }}>Charge for this lesson</Text>
          <Switch
            value={charge}
            onValueChange={setCharge}
            trackColor={{ false: COLORS.paperEdge, true: COLORS.oxblood }}
            thumbColor={COLORS.paper}
            accessibilityLabel="Charge for this lesson"
          />
        </View>

        {charge ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint, letterSpacing: 1 }}>DEDUCT</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <StepButton label="−15m" onPress={() => step(-15)} disabled={minutes <= 15} />
              <Text style={{ fontFamily: F.monoMed, fontSize: 15, color: COLORS.ink, minWidth: 64, textAlign: 'center' }}>
                {formatMinutes(minutes)}
              </Text>
              <StepButton label="+15m" onPress={() => step(15)} />
            </View>
          </View>
        ) : null}

        <TouchableOpacity
          onPress={() => onConfirm(charge, minutes)}
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
