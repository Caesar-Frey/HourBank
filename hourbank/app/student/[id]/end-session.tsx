import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Alert, StatusBar } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useNavigationContainerRef, useRouter } from 'expo-router';
import { CommonActions } from '@react-navigation/native';
import { applyLessonSavedNav, lessonSavedNav } from '../../../src/utils/lessonNav';
import { getStudent } from '../../../src/db/students';
import { currentBalance as fetchBalance } from '../../../src/db/ledger';
import {
  computeElapsedSeconds,
  endSession,
  getSession,
  isSessionError,
  parseSessionTopics,
  saveLiveTopics,
  setInFlightMode,
} from '../../../src/db/sessions';
import { isSubjectError } from '../../../src/db/subjects';
import { BilledMinutesField, SubjectPicker, TravelKmField, LessonPreview } from '../../../src/components/lesson/LessonFields';
import {
  billingRoundMinutes, loadSubjectOptions, parentTravelTerms, catalogTopics, type SubjectOption,
} from '../../../src/components/lesson/lessonFormData';
import {
  balancePreview, defaultSubjectId, parseKmInput, timerReviewOverrides, travelPreview,
} from '../../../src/components/lesson/lessonFormLogic';
import { DateTimeField } from '../../../src/components/student/DateTimeField';
import { SegmentedControl } from '../../../src/components/calendar/SegmentedControl';
import { TopicChip } from '../../../src/components/TopicChip';
import { ScreenHeader } from '../../../src/components/ScreenHeader';
import { FormScreen } from '../../../src/components/FormScreen';
import { useToast } from '../../../src/components/Toast';
import { F, MIN_TOUCH } from '../../../src/theme/fonts';
import { COLORS } from '../../../src/theme/colors';
import { formatDayShort, formatHours, formatMinutes, formatTime } from '../../../src/utils/format';
import { balanceStatus, balanceColour } from '../../../src/utils/balance';
import {
  defaultBilledMinutes, isRunawayTimer, runawayDefaultEnd, shouldWarnBilledDeviation, taughtMinutesUntil,
} from '../../../src/utils/duration';
import { Session, Student } from '../../../src/db/schema';
import { useSessionTimer } from '../../../src/contexts/SessionTimerContext';
import { canEndFromStatus, lessonDraftStore } from '../../../src/contexts/SessionTimerContext.helpers';

function parseTopicsParam(raw: string | undefined): string[] {
  try {
    const v: unknown = JSON.parse(decodeURIComponent(raw || '[]'));
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function validIso(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = decodeURIComponent(raw);
  return Number.isNaN(new Date(s).getTime()) ? null : s;
}

export default function EndSessionScreen() {
  const params = useLocalSearchParams<{
    id: string;
    sessionId: string;
    endedAt?: string;
    /** Legacy: elapsed snapshot when no session row can be read. */
    elapsedSeconds?: string;
    mode?: string;
    topics?: string;
    /** '1' when the end time was picked on the "timer left running" sheet. */
    chosenEnd?: string;
    /** Back label (e.g. 'BACK' when opened from the orphan sheet). */
    back?: string;
  }>();
  const id = params.id as string;
  const sessionId = params.sessionId as string;
  const router = useRouter();
  const toast = useToast();
  const { endTimer, refreshFromDb } = useSessionTimer();
  const navRef = useNavigationContainerRef();

  // Snapshot once: the lesson as it stood when "End lesson" was tapped.
  const [session] = useState<Session | null>(() => {
    try {
      return getSession(sessionId);
    } catch {
      return null;
    }
  });
  /** When "End lesson" was tapped (or the orphan sheet's chosen end). */
  const [openedAt] = useState(() => new Date(validIso(params.endedAt) ?? new Date().toISOString()));
  // Topics from the timer; fall back to the picks persisted on the row (app was killed).
  const [initialTopics] = useState(() => {
    const fromParam = parseTopicsParam(params.topics);
    return fromParam.length > 0 ? fromParam : parseSessionTopics(session?.topics);
  });
  const [step] = useState(billingRoundMinutes);
  const bookedMinutes = session?.estimated_duration_minutes ?? null;
  const startedAt = session?.started_at ?? null;

  // A forgotten timer (A2): default the end to the booked end and say so.
  const [runawayMinutes] = useState(() =>
    session?.started_at ? computeElapsedSeconds(session, openedAt) / 60 : 0,
  );
  const runaway = !!startedAt && isRunawayTimer(runawayMinutes, bookedMinutes);
  const [endedAt, setEndedAt] = useState<Date>(() => {
    if (runaway && startedAt && params.chosenEnd !== '1') {
      const booked = runawayDefaultEnd(startedAt, bookedMinutes);
      return booked.getTime() < openedAt.getTime() ? booked : openedAt;
    }
    return openedAt;
  });
  const endMoved = endedAt.getTime() !== openedAt.getTime();

  // Taught = end − start − pauses. With the end moved, only closed pauses count
  // (an open pause after the real end must not eat the lesson).
  const actualMinutes = startedAt && session
    ? endMoved
      ? taughtMinutesUntil(startedAt, endedAt, session.paused_seconds ?? 0)
      : computeElapsedSeconds(session, endedAt) / 60
    : (parseInt(params.elapsedSeconds ?? '', 10) || 0) / 60;
  const endError = startedAt
    ? endedAt.getTime() <= new Date(startedAt).getTime()
      ? 'The end must be after the start'
      : endedAt.getTime() > Date.now() + 60_000
        ? 'The end can’t be in the future'
        : null
    : null;

  const defaultBilled = defaultBilledMinutes(actualMinutes, bookedMinutes, step);
  
  const [draft] = useState(() => lessonDraftStore.get(sessionId));
  const [student, setStudent] = useState<Student | null>(null);
  const [bal, setBal] = useState(0);
  const [subjectOptions, setSubjectOptions] = useState<SubjectOption[]>([]);
  const [subjectId, setSubjectId] = useState<string | null>(draft?.subjectId ?? session?.subject_id ?? null);
  /** Subject + km as booked, so an untouched review keeps the timer's own save path. */
  const [bookedSubjectId, setBookedSubjectId] = useState<string | null>(session?.subject_id ?? null);
  const [initialKm, setInitialKm] = useState<number | null>(null);
  const [kmText, setKmText] = useState(draft?.kmText ?? '');
  const [selectedTopics, setSelectedTopics] = useState<string[]>(initialTopics);
  const [availableTopics, setAvailableTopics] = useState<string[]>(initialTopics);
  const [addingTopic, setAddingTopic] = useState(false);
  const [customTopic, setCustomTopic] = useState('');
  const [notes, setNotes] = useState(draft?.notes ?? '');
  // Only a tutor-edited amount survives a trip back to the timer (or an end-time
  // change); an untouched default follows the taught time.
  const [billedOverride, setBilledOverride] = useState<number | null>(
    draft?.billedChanged && draft.billedMinutes !== undefined ? draft.billedMinutes : null,
  );
  const billedChanged = billedOverride !== null;
  const billedMinutes = billedOverride ?? defaultBilled;
  const [mode, setModeState] = useState<Session['mode']>(session?.mode ?? (params.mode === 'online' ? 'online' : 'in_person'));
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    try {
      const s = getStudent(id);
      let subjectName: string | null = s?.subject ?? null;
      if (s) {
        setStudent(s);
        try {
          const { options, primaryId } = loadSubjectOptions(id);
          const booked = session?.subject_id ?? primaryId ?? null;
          setSubjectOptions(options);
          setBookedSubjectId(booked);
          const prev = draft?.subjectId ?? null;
          const pick = prev && options.some(o => o.id === prev) ? prev : defaultSubjectId(options, booked, primaryId);
          subjectName = options.find(o => o.id === pick)?.subject ?? subjectName;
          setSubjectId(pick);
        } catch (e) {
          console.error('EndSessionScreen subjects load error', e);
        }
        const km = session?.travel_km ?? s.travel_distance_km ?? 0;
        setInitialKm(parseKmInput(String(km)).value);
        if (!draft?.kmText) setKmText(String(km));
        const allTopics = catalogTopics(subjectName);
        const extras = initialTopics.filter(t => !allTopics.includes(t));
        setAvailableTopics([...allTopics, ...extras]);
      }
      setBal(fetchBalance(id));
    } catch (e) {
      console.error('EndSessionScreen load error', e);
    }
  }, [id, initialTopics, session, draft]);

  // Topic edits go to the in-flight row too, so the timer (and a relaunch) sees them.
  useEffect(() => {
    try {
      saveLiveTopics(sessionId, selectedTopics);
    } catch (e) {
      console.error('saveLiveTopics error', e);
    }
  }, [sessionId, selectedTopics]);

  // Keep edits while the tutor hops back to the timer (in memory only).
  useEffect(() => {
    lessonDraftStore.set(sessionId, { notes, billedMinutes, billedChanged, subjectId, kmText });
  }, [sessionId, notes, billedMinutes, billedChanged, subjectId, kmText]);

  // Lesson already finished/discarded elsewhere → nothing to review.
  const alreadyClosed = !!session && !canEndFromStatus(session.status);
  useEffect(() => {
    if (alreadyClosed) router.replace(`/lesson/${sessionId}`);
  }, [alreadyClosed, sessionId, router]);

  const lessonMode = mode;
  const subjectOption = subjectOptions.find(o => o.id === subjectId) ?? null;
  const subjectBalance = subjectOption ? subjectOption.balance : bal;
  const subjectName = subjectOption?.subject ?? student?.subject ?? '';
  const balanceAfter = subjectBalance - billedMinutes / 60;
  const bColour = balanceColour(balanceStatus(balanceAfter));
  const firstName = student?.full_name?.trim().split(/\s+/)[0] ?? 'Student';
  const parsedKm = parseKmInput(kmText);
  const kmValue = lessonMode === 'in_person' ? (parsedKm.error ? null : parsedKm.value ?? 0) : null;
  const kmError = lessonMode === 'in_person' ? parsedKm.error : null;
  const preview = balancePreview({ subjectName, balanceNow: subjectBalance, billedMinutes });
  const travel = student ? travelPreview({ lessonMode, km: kmValue, ...parentTravelTerms(student) }) : null;
  // Subject / km picked on review that differ from the booking.
  const reviewOverrides = timerReviewOverrides({ subjectId, bookedSubjectId, mode: lessonMode, km: kmValue, initialKm });

  const warnDeviation = shouldWarnBilledDeviation(billedMinutes, actualMinutes, billedChanged);

  const setBilled = (m: number) => setBilledOverride(Math.max(step, Math.round(m)));
  const resetBilled = () => setBilledOverride(null);

  /** Mode on the review is saved on the lesson too, so Back to the timer shows it. */
  const changeMode = (next: Session['mode']) => {
    if (next === mode) return;
    const prev = mode;
    setModeState(next);
    try {
      setInFlightMode(sessionId, next);
    } catch (e) {
      console.error('setInFlightMode error', e);
      setModeState(prev);
      toast.show({ kind: 'error', message: "Couldn't switch the lesson mode — try again" });
    }
  };

  const changeSubject = (next: string) => {
    setSubjectId(next);
    const allTopics = catalogTopics(subjectOptions.find(o => o.id === next)?.subject);
    setAvailableTopics([...allTopics, ...selectedTopics.filter(t => !allTopics.includes(t))]);
  };

  const toggleTopic = (topic: string) => {
    setSelectedTopics(prev => (prev.includes(topic) ? prev.filter(t => t !== topic) : [...prev, topic]));
  };

  const submitCustomTopic = () => {
    const trimmed = customTopic.trim();
    if (trimmed) {
      setSelectedTopics(prev => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
      setAvailableTopics(prev => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    }
    setCustomTopic('');
    setAddingTopic(false);
  };

  // Back = return to the still-running timer (nothing is saved or lost).
  const handleBack = () => router.back();

  const doSave = (billed: number) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      endSession({
        sessionId,
        endedAt: endedAt.toISOString(),
        durationMinutes: actualMinutes,
        billedMinutes: billed,
        topics: selectedTopics,
        sessionNotes: notes.trim() || undefined,
        mode: lessonMode,
        ...reviewOverrides,
      });
    } catch (e: unknown) {
      submittingRef.current = false;
      setSubmitting(false);
      console.error('endSession error', e);
      if (isSubjectError(e)) {
        Alert.alert('Pick another subject', 'That subject is no longer active for this student. Nothing was deducted.');
        return;
      }
      if (isSessionError(e, 'INVALID_STATE') || isSessionError(e, 'NOT_FOUND')) {
        refreshFromDb();
        Alert.alert(
          'Lesson already closed',
          'This lesson was already saved or discarded, so nothing was changed.',
          [{ text: 'OK', onPress: () => router.replace(isSessionError(e, 'NOT_FOUND') ? '/' : `/lesson/${sessionId}`) }],
        );
      } else {
        Alert.alert('Could not save lesson', 'Nothing was deducted. Please try again.');
      }
      return;
    }

    // Committed: only now reset the live timer.
    lessonDraftStore.clear(sessionId);
    endTimer();
    toast.show({ kind: 'success', message: `Lesson saved · ${formatMinutes(billed)} deducted` });
    // Timer + review are popped either way, so Back never shows a stale timer.
    // Started from the student page → [..., student, summary]; else replace.
    applyLessonSavedNav(
      router,
      navRef,
      lessonSavedNav({ rootState: navRef.getRootState(), studentId: id, lessonHref: `/lesson/${sessionId}?justSaved=1` }),
      state => CommonActions.reset(state as never),
    );
  };

  const handleSave = () => {
    if (submittingRef.current) return;
    const billed = billedMinutes;
    if (endError) return;
    // Topics are optional, as on the Record form (C6).
    if (kmError) return;
    // Warn-but-allow: going past zero credit is a confirm, never a block.
    const after = subjectBalance - billed / 60;
    if (after < 0) {
      Alert.alert(
        'Balance will go negative',
        `${firstName} has ${formatHours(subjectBalance)} of ${subjectName} left. Saving puts them at OWES ${formatHours(Math.abs(after))}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Save anyway', onPress: () => doSave(billed) },
        ],
      );
      return;
    }
    doSave(billed);
  };

  const rowStyle = {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.paperEdge,
  };
  const labelStyle = {
    fontFamily: F.mono,
    fontSize: 12,
    color: COLORS.inkFaint,
    letterSpacing: 1,
  };
  const valueStyle = (family: string, colour: string = COLORS.ink) => ({
    fontFamily: family,
    fontSize: 14,
    color: colour,
    textAlign: 'right' as const,
    flexShrink: 1,
    marginLeft: 16,
  });

  if (!session) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.paper }}>
        <StatusBar barStyle="dark-content" />
        <FormScreen header={<ScreenHeader backLabel="BACK" onBack={handleBack} />}>
          <Text style={{ fontFamily: F.serif, fontSize: 22, color: COLORS.ink, marginTop: 24 }}>Lesson not found</Text>
          <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.inkSoft, marginTop: 8 }}>
            It may have been removed. Nothing was saved.
          </Text>
        </FormScreen>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.paper }}>
      <StatusBar barStyle="dark-content" />
      <FormScreen
        header={<ScreenHeader backLabel={params.back === 'home' ? 'BACK' : 'TIMER'} onBack={handleBack} />}
        footer={
          <TouchableOpacity
            onPress={handleSave}
            disabled={submitting || alreadyClosed || !!endError}
            accessibilityRole="button"
            style={{
              backgroundColor: COLORS.oxblood,
              borderRadius: 16,
              minHeight: 52,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: submitting || endError ? 0.5 : 1,
            }}
            activeOpacity={0.8}
          >
            <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.paper }}>
              {`Save lesson · deduct ${formatMinutes(billedMinutes)} ▸`}
            </Text>
          </TouchableOpacity>
        }
      >
        {/* Title block */}
        <View style={{ paddingTop: 4, paddingBottom: 24 }}>
          <Text style={{ ...labelStyle, letterSpacing: 1.5, marginBottom: 4 }}>REVIEW & SIGN OFF</Text>
          <Text style={{ fontFamily: F.serif, fontSize: 28, color: COLORS.ink }}>Lesson</Text>
          <Text style={{ fontFamily: F.serifItalic, fontSize: 28, color: COLORS.oxblood }}>complete.</Text>
          <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft, marginTop: 8 }}>
            {params.back === 'home' ? 'Check the end time, then save.' : 'The timer is still running until you save. Go back to keep teaching.'}
          </Text>
        </View>

        {runaway ? (
          <View
            accessibilityLiveRegion="polite"
            style={{ backgroundColor: COLORS.warnFill, borderRadius: 12, padding: 12, flexDirection: 'row', gap: 10, marginBottom: 16 }}
          >
            <Feather name="alert-circle" size={18} color={COLORS.ink} style={{ marginTop: 1 }} />
            <Text style={{ fontFamily: F.sans, fontSize: 14, lineHeight: 20, color: COLORS.ink, flexShrink: 1 }}>
              {'The timer ran '}
              <Text style={{ fontFamily: F.mono, fontSize: 13 }}>{formatMinutes(Math.round(runawayMinutes))}</Text>
              {bookedMinutes
                ? ', far longer than the booked lesson. The end time is set to the booked end. Check it before saving.'
                : ', far longer than a usual lesson. Check the end time before saving.'}
            </Text>
          </View>
        ) : null}

        {/* Receipt rows */}
        <View style={{ borderTopWidth: 1, borderTopColor: COLORS.paperEdge }}>
          <View style={rowStyle}>
            <Text style={labelStyle}>STUDENT</Text>
            <Text style={valueStyle(F.serif)}>{student?.full_name ?? '—'}</Text>
          </View>
          <View style={rowStyle}>
            <Text style={labelStyle}>GRADE</Text>
            <Text style={valueStyle(F.sans)}>{student ? `Gr ${student.grade} · ${student.curriculum}` : '—'}</Text>
          </View>
          {startedAt ? (
            <View style={rowStyle}>
              <Text style={labelStyle}>STARTED</Text>
              <Text style={valueStyle(F.mono)}>{`${formatDayShort(startedAt)} · ${formatTime(startedAt)}`}</Text>
            </View>
          ) : null}
          {startedAt ? (
            <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge }}>
              <Text style={labelStyle}>ENDED</Text>
              <View style={{ flexDirection: 'row', gap: 16 }}>
                <View style={{ flex: 3 }}>
                  <DateTimeField
                    mode="date"
                    value={endedAt}
                    onChange={setEndedAt}
                    display={formatDayShort(endedAt)}
                    accessibilityLabel="Lesson end date"
                    minimumDate={new Date(startedAt)}
                    maximumDate={new Date()}
                    invalid={!!endError}
                  />
                </View>
                <View style={{ flex: 2 }}>
                  <DateTimeField
                    mode="time"
                    value={endedAt}
                    onChange={setEndedAt}
                    display={formatTime(endedAt)}
                    accessibilityLabel="Lesson end time"
                    invalid={!!endError}
                  />
                </View>
              </View>
              {endError ? (
                <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.crimson, marginTop: 6 }}>{endError}</Text>
              ) : null}
            </View>
          ) : null}
          <View style={rowStyle}>
            <Text style={labelStyle}>TAUGHT</Text>
            <Text style={valueStyle(F.mono)}>
              {formatMinutes(Math.round(actualMinutes))}
              {bookedMinutes ? ` · booked ${formatMinutes(bookedMinutes)}` : ''}
            </Text>
          </View>
          <View style={rowStyle}>
            <Text style={labelStyle}>MODE</Text>
            <SegmentedControl
              accessibilityLabel="Lesson mode"
              options={[{ value: 'in_person', label: 'In-person' }, { value: 'online', label: 'Online' }]}
              value={lessonMode}
              onChange={changeMode}
            />
          </View>
        </View>

        <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge, gap: 8 }}>
          <Text style={labelStyle}>SUBJECT</Text>
          <SubjectPicker options={subjectOptions} value={subjectId} onChange={changeSubject} fallbackName={student?.subject ?? null} />
        </View>
        {lessonMode === 'in_person' ? (
          <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge, gap: 4 }}>
            <Text style={labelStyle}>TRAVEL</Text>
            <TravelKmField text={kmText} onChangeText={setKmText} error={kmError} defaultKm={student?.travel_distance_km ?? null} />
          </View>
        ) : null}

        {/* Billed duration */}
        <View style={{ ...rowStyle, paddingVertical: 12 }}>
          <Text style={labelStyle}>BILLED</Text>
          <BilledMinutesField value={billedMinutes} onChange={setBilled} step={step} />
        </View>
        {warnDeviation ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 6, gap: 12 }}>
            <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkSoft, flexShrink: 1 }}>
              {`Billing ${formatMinutes(billedMinutes)} for ${formatMinutes(Math.round(actualMinutes))} taught.`}
            </Text>
            <TouchableOpacity onPress={resetBilled} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }} accessibilityRole="button">
              <Text style={{ fontFamily: F.sansMed, fontSize: 12, color: COLORS.oxblood }}>
                {`Reset to ${formatMinutes(defaultBilled)}`}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={{ ...rowStyle, marginBottom: 12 }}>
          <Text style={labelStyle}>BALANCE AFTER</Text>
          <Text style={valueStyle(F.monoMed, bColour)}>
            {balanceAfter < 0 ? `OWES ${formatHours(Math.abs(balanceAfter))}` : `${formatHours(balanceAfter)} left`}
          </Text>
        </View>
        <View style={{ marginBottom: 28 }}>
          <LessonPreview balanceText={preview.text} owes={preview.owes} travelText={travel?.text ?? null} />
        </View>

        {/* Topics */}
        <View style={{ marginBottom: 28 }}>
          <Text style={{ ...labelStyle, letterSpacing: 1.5, marginBottom: 12 }}>TOPICS COVERED</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {availableTopics.map(topic => (
              <TopicChip
                key={topic}
                label={topic}
                selected={selectedTopics.includes(topic)}
                onPress={() => toggleTopic(topic)}
                dark={false}
              />
            ))}
            {addingTopic ? (
              <TextInput
                autoFocus
                value={customTopic}
                onChangeText={setCustomTopic}
                onSubmitEditing={submitCustomTopic}
                onBlur={submitCustomTopic}
                placeholder="Topic name…"
                placeholderTextColor={COLORS.ink40}
                returnKeyType="done"
                style={{
                  fontFamily: F.sans,
                  fontSize: 13,
                  color: COLORS.ink,
                  borderWidth: 1,
                  borderColor: COLORS.paperEdge,
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  minWidth: 120,
                }}
              />
            ) : (
              <TouchableOpacity
                onPress={() => setAddingTopic(true)}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                style={{
                  borderWidth: 1,
                  borderColor: COLORS.inkFaint,
                  borderStyle: 'dashed',
                  borderRadius: 999,
                  paddingHorizontal: 12,
                  minHeight: 36,
                  justifyContent: 'center',
                }}
                activeOpacity={0.75}
              >
                <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkFaint }}>+ add</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Notes */}
        <View style={{ marginBottom: 12 }}>
          <Text style={{ ...labelStyle, letterSpacing: 1.5, marginBottom: 12 }}>NOTES</Text>
          <TextInput
            multiline
            value={notes}
            onChangeText={setNotes}
            placeholder="What did you cover? Any homework?"
            placeholderTextColor={COLORS.inkFaint}
            style={{
              fontFamily: F.serifItalic,
              fontSize: 15,
              color: COLORS.ink,
              borderWidth: 1,
              borderColor: COLORS.paperEdge,
              borderRadius: 12,
              padding: 12,
              backgroundColor: COLORS.cardFill,
              minHeight: 96,
              textAlignVertical: 'top',
            }}
          />
        </View>
      </FormScreen>
    </View>
  );
}
