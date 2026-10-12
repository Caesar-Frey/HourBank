/**
 * New lesson (ad-hoc, not booked). Route: /start-lesson?studentId=&kind=record|timer
 *
 * Two ways in: "Record a lesson that happened" (default → the Record lesson form)
 * or "Start a timer" (optional live timer).
 *
 * - Atomic create+start (createAndStartUnscheduled) — no orphan rows.
 * - Over the owing limit is a NUDGE: confirm, then retry with allowOverOwe.
 * - Another lesson running: offer to open it; never silently discard it.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { COLORS } from '../src/theme/colors';
import { F, MIN_TOUCH } from '../src/theme/fonts';
import { FormScreen } from '../src/components/FormScreen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { useToast } from '../src/components/Toast';
import { SegmentedControl } from '../src/components/calendar/SegmentedControl';
import { useSessionTimer } from '../src/contexts/SessionTimerContext';
import { listActiveStudents, listPausedStudents } from '../src/db/students';
import {
  DEFAULT_LESSON_MINUTES,
  createAndStartUnscheduled,
  getActiveOrPausedSession,
  isSessionError,
} from '../src/db/sessions';
import { isSubjectError } from '../src/db/subjects';
import type { Session } from '../src/db/schema';
import { formatHours } from '../src/utils/format';
import { balanceColour, balanceStatus } from '../src/utils/balance';
import { MODE_OPTIONS, SESSION_TYPE_OPTIONS, type LessonModeKey, type SessionTypeKey } from '../src/screens/schedule/labels';
import { balanceWarning, filterStudents, overOweMessage } from '../src/screens/schedule/startLessonModel';

type PickStudent = {
  id: string;
  full_name: string;
  subject: string;
  status: string;
  current_balance: number;
  subjects: Array<{ subject_id: string; subject: string; balance_hours: number }>;
};

type NewLessonKind = 'record' | 'timer';

const KIND_OPTIONS: Array<{ value: NewLessonKind; title: string; detail: string; icon: 'check-square' | 'play' }> = [
  { value: 'record', title: 'Record a lesson that happened', detail: 'Already taught — log time, topics and travel.', icon: 'check-square' },
  { value: 'timer', title: 'Start a timer', detail: 'Teaching now — time it live, record at the end.', icon: 'play' },
];

const LABEL = {
  fontFamily: F.mono,
  fontSize: 10,
  color: COLORS.inkFaint,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  marginBottom: 8,
};

export default function StartLessonScreen() {
  const router = useRouter();
  const toast = useToast();
  const { startTimer } = useSessionTimer();
  const { studentId: paramStudentId, kind: paramKind } = useLocalSearchParams<{ studentId?: string; kind?: string }>();
  const [kind, setKind] = useState<NewLessonKind>(paramKind === 'timer' ? 'timer' : 'record');
  const [timerSubjectId, setTimerSubjectId] = useState<string | null>(null);

  const [students, setStudents] = useState<PickStudent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(paramStudentId ?? null);
  const [mode, setMode] = useState<LessonModeKey>('in_person');
  const [sessionType, setSessionType] = useState<SessionTypeKey>('general');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      try {
        const list = [...listActiveStudents(), ...listPausedStudents()].map(s => ({
          id: s.id,
          full_name: s.full_name,
          subject: s.subject,
          status: s.status,
          current_balance: s.current_balance,
          subjects: s.subject_balances ?? [],
        }));
        list.sort((a, b) => a.full_name.localeCompare(b.full_name));
        setStudents(list);
      } catch {
        toast.show({ kind: 'error', message: 'Couldn’t load students.' });
      } finally {
        setLoaded(true);
      }
    }, [toast]),
  );

  const shown = useMemo(() => filterStudents(students, query), [students, query]);
  const selected = students.find(s => s.id === selectedId) ?? null;

  function release() {
    busyRef.current = false;
    setBusy(false);
  }

  function liveRoute(s: Pick<Session, 'id' | 'student_id'>): Href {
    return `/student/${s.student_id}/session?sessionId=${s.id}` as Href;
  }

  function selectStudent(id: string) {
    setSelectedId(id);
    setTimerSubjectId(null);
  }

  function record() {
    if (!selected) return;
    router.replace(`/student/${selected.id}/log-past` as Href);
  }

  function start(allowOverOwe = false) {
    if (!selected) return;
    if (busyRef.current && !allowOverOwe) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const session = createAndStartUnscheduled({
        studentId: selected.id,
        subjectId: timerSubjectId ?? undefined,
        mode,
        sessionType,
        allowOverOwe,
      });
      startTimer(session.id, selected.id, session.started_at!, 0);
      router.replace(liveRoute(session));
    } catch (e) {
      if (isSessionError(e, 'OVER_OWE_LIMIT')) {
        const { title, message } = overOweMessage(selected.full_name, e.details);
        Alert.alert(title, message, [
          { text: 'Cancel', style: 'cancel', onPress: release },
          { text: 'Start anyway', onPress: () => start(true) },
        ], { cancelable: true, onDismiss: release });
        return;
      }
      if (isSessionError(e, 'ALREADY_ACTIVE')) {
        let running: ReturnType<typeof getActiveOrPausedSession> = null;
        try {
          running = getActiveOrPausedSession();
        } catch {
          running = null;
        }
        const who = running?.student_full_name ?? 'another student';
        Alert.alert(
          `A lesson with ${who} is running`,
          'Finish or discard that lesson before starting a new one.',
          [
            { text: 'Cancel', style: 'cancel', onPress: release },
            ...(running
              ? [{ text: 'Open live lesson', onPress: () => router.replace(liveRoute(running!)) }]
              : []),
          ],
          { cancelable: true, onDismiss: release },
        );
        return;
      }
      if (isSubjectError(e)) {
        toast.show({ kind: 'error', message: 'That subject isn’t available any more — pick another.' });
      } else if (isSessionError(e, 'NOT_STARTABLE')) {
        toast.show({ kind: 'error', message: `${selected.full_name} can’t start a lesson right now (archived?).` });
      } else {
        toast.show({ kind: 'error', message: 'Couldn’t start the lesson. Nothing was saved — try again.' });
      }
      release();
    }
  }

  const firstName = selected ? selected.full_name.split(/\s+/)[0] : '';
  const footer = (
    <TouchableOpacity
      onPress={() => (kind === 'record' ? record() : start(false))}
      disabled={!selected || busy}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityState={{ disabled: !selected || busy }}
      style={{
        backgroundColor: selected ? COLORS.oxblood : COLORS.paperEdge,
        borderRadius: 14,
        minHeight: 52,
        paddingHorizontal: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        opacity: busy ? 0.6 : 1,
      }}
    >
      <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: selected ? COLORS.paper : COLORS.inkSoft }}>
        {!selected ? 'Pick a student' : kind === 'record' ? `Record lesson for ${firstName}` : `Start timer with ${firstName}`}
      </Text>
      <Feather name={kind === 'record' ? 'arrow-right' : 'play'} size={16} color={selected ? COLORS.paper : COLORS.inkSoft} />
    </TouchableOpacity>
  );

  return (
    <FormScreen
      header={<ScreenHeader backLabel="BACK" onBack={() => router.back()} title="New lesson" />}
      footer={footer}
    >
      <Text style={{ fontFamily: F.serif, fontSize: 26, color: COLORS.ink, marginTop: 8 }}>New lesson</Text>
      <Text style={{ fontFamily: F.serifItalic, fontSize: 18, color: COLORS.oxblood, marginBottom: 20 }}>
        not on the schedule.
      </Text>

      <View style={{ gap: 10, marginBottom: 24 }} accessibilityRole="radiogroup">
        {KIND_OPTIONS.map(opt => {
          const sel = opt.value === kind;
          return (
            <TouchableOpacity
              key={opt.value}
              onPress={() => setKind(opt.value)}
              activeOpacity={0.8}
              accessibilityRole="radio"
              accessibilityState={{ selected: sel, checked: sel }}
              accessibilityLabel={opt.title}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                minHeight: MIN_TOUCH + 16,
                padding: 14,
                borderRadius: 14,
                borderWidth: sel ? 2 : 1,
                borderColor: sel ? COLORS.oxblood : COLORS.paperEdge,
                backgroundColor: sel ? COLORS.oxbloodFill : COLORS.transparent,
              }}
            >
              <Feather name={opt.icon} size={18} color={sel ? COLORS.oxblood : COLORS.inkSoft} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.ink }}>{opt.title}</Text>
                <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkSoft, marginTop: 2 }}>{opt.detail}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {kind === 'timer' ? (
        <>
      <Text style={LABEL}>Mode</Text>
      <SegmentedControl options={MODE_OPTIONS} value={mode} onChange={setMode} style={{ marginBottom: 20 }} />

      <Text style={LABEL}>Lesson type</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
        {SESSION_TYPE_OPTIONS.map(opt => {
          const sel = opt.value === sessionType;
          return (
            <TouchableOpacity
              key={opt.value}
              onPress={() => setSessionType(opt.value)}
              activeOpacity={0.75}
              accessibilityRole="radio"
              accessibilityState={{ selected: sel }}
              hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
              style={{
                minHeight: 36,
                paddingHorizontal: 14,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: sel ? COLORS.ink : COLORS.paperEdge,
                backgroundColor: sel ? COLORS.ink : COLORS.transparent,
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontFamily: F.sans, fontSize: 13, color: sel ? COLORS.paper : COLORS.ink }}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
        </>
      ) : null}

      {kind === 'timer' && selected && selected.subjects.length > 1 ? (
        <>
          <Text style={LABEL}>Subject</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
            {selected.subjects.map(sub => {
              const sel = (timerSubjectId ?? selected.subjects[0].subject_id) === sub.subject_id;
              return (
                <TouchableOpacity
                  key={sub.subject_id}
                  onPress={() => setTimerSubjectId(sub.subject_id)}
                  activeOpacity={0.75}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: sel }}
                  hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
                  style={{
                    minHeight: 36,
                    paddingHorizontal: 14,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: sel ? COLORS.ink : COLORS.paperEdge,
                    backgroundColor: sel ? COLORS.ink : COLORS.transparent,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Text style={{ fontFamily: F.sans, fontSize: 13, color: sel ? COLORS.paper : COLORS.ink }}>{sub.subject}</Text>
                  <Text style={{ fontFamily: F.mono, fontSize: 11, color: sel ? COLORS.paper60 : COLORS.inkSoft }}>
                    {sub.balance_hours < 0 ? `−${formatHours(-sub.balance_hours)}` : formatHours(sub.balance_hours)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      ) : null}

      <Text style={LABEL}>Student</Text>
      {students.length > 5 ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: COLORS.paperDeep,
            borderRadius: 10,
            paddingHorizontal: 12,
            height: 44,
            gap: 8,
            marginBottom: 6,
          }}
        >
          <Feather name="search" size={15} color={COLORS.inkFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name or subject"
            placeholderTextColor={COLORS.inkFaint}
            autoCorrect={false}
            style={{ flex: 1, fontFamily: F.sans, fontSize: 15, color: COLORS.ink, padding: 0 }}
          />
        </View>
      ) : null}

      {loaded && students.length === 0 ? (
        <Text style={{ fontFamily: F.serifItalic, fontSize: 14, color: COLORS.inkFaint, paddingVertical: 16 }}>
          No students yet — add one from Home first.
        </Text>
      ) : null}
      {loaded && students.length > 0 && shown.length === 0 ? (
        <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkFaint, paddingVertical: 16 }}>
          No students match “{query}”.
        </Text>
      ) : null}

      {shown.map(s => {
        const sel = s.id === selectedId;
        const warn = balanceWarning(s.current_balance, DEFAULT_LESSON_MINUTES);
        const colour = balanceColour(balanceStatus(s.current_balance));
        return (
          <TouchableOpacity
            key={s.id}
            onPress={() => selectStudent(s.id)}
            activeOpacity={0.7}
            accessibilityRole="radio"
            accessibilityState={{ selected: sel }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 12,
              minHeight: MIN_TOUCH + 12,
              borderBottomWidth: 1,
              borderBottomColor: COLORS.paperEdge,
              gap: 14,
            }}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                borderWidth: 2,
                borderColor: sel ? COLORS.oxblood : COLORS.paperEdge,
                backgroundColor: sel ? COLORS.oxblood : COLORS.transparent,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {sel ? <Feather name="check" size={12} color={COLORS.paper} /> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.serif, fontSize: 16, color: COLORS.ink }} numberOfLines={1}>
                {s.full_name}
              </Text>
              <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkSoft }} numberOfLines={1}>
                {s.subjects.length > 0 ? s.subjects.map(x => x.subject).join(' · ') : s.subject}
                {s.status === 'paused' ? ' · Paused' : ''}
              </Text>
              {warn ? (
                <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.crimson, marginTop: 2 }}>{warn}</Text>
              ) : null}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontFamily: F.monoMed, fontSize: 14, color: colour }}>
                {s.current_balance < 0 ? `−${formatHours(-s.current_balance)}` : formatHours(s.current_balance)}
              </Text>
              <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, textTransform: 'uppercase' }}>
                {s.current_balance < 0 ? 'owes' : 'balance'}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </FormScreen>
  );
}
