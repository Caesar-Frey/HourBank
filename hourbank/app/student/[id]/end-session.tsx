import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Alert, StatusBar } from 'react-native';
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
  recordLesson,
  saveLiveTopics,
} from '../../../src/db/sessions';
import { isSubjectError } from '../../../src/db/subjects';
import { getOrCreateTutorProfile } from '../../../src/db/tutorProfile';
import { SubjectPicker, TravelKmField, LessonPreview } from '../../../src/components/lesson/LessonFields';
import { loadSubjectOptions, parentTravelTerms, catalogTopics, type SubjectOption } from '../../../src/components/lesson/lessonFormData';
import { balancePreview, defaultSubjectId, parseKmInput, travelPreview } from '../../../src/components/lesson/lessonFormLogic';
import { TopicChip } from '../../../src/components/TopicChip';
import { ScreenHeader } from '../../../src/components/ScreenHeader';
import { FormScreen } from '../../../src/components/FormScreen';
import { useToast } from '../../../src/components/Toast';
import { F, MIN_TOUCH } from '../../../src/theme/fonts';
import { COLORS } from '../../../src/theme/colors';
import { formatDateLong, formatHours, formatMinutes, formatTimeRange } from '../../../src/utils/format';
import { balanceStatus, balanceColour } from '../../../src/utils/balance';
import { defaultBilledMinutes, shouldWarnBilledDeviation } from '../../../src/utils/duration';
import { Session, Student } from '../../../src/db/schema';
import { useSessionTimer } from '../../../src/contexts/SessionTimerContext';
import { canEndFromStatus, lessonDraftStore } from '../../../src/contexts/SessionTimerContext.helpers';

const STEP_MINUTES = 15;

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

function billingRoundMinutes(): number {
  try {
    return getOrCreateTutorProfile().billing_round_minutes || 15;
  } catch {
    return 15;
  }
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
  const [endedAtIso] = useState(() => validIso(params.endedAt) ?? new Date().toISOString());
  // Topics from the timer; fall back to the picks persisted on the row (app was killed).
  const [initialTopics] = useState(() => {
    const fromParam = parseTopicsParam(params.topics);
    return fromParam.length > 0 ? fromParam : parseSessionTopics(session?.topics);
  });

  const actualSeconds = session?.started_at
    ? computeElapsedSeconds(session, new Date(endedAtIso))
    : parseInt(params.elapsedSeconds ?? '', 10) || 0;
  const actualMinutes = actualSeconds / 60;
  const bookedMinutes = session?.estimated_duration_minutes ?? null;

  const [defaultBilled] = useState(() => defaultBilledMinutes(actualMinutes, bookedMinutes, billingRoundMinutes()));
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
  const [topicError, setTopicError] = useState(false);
  // Only a tutor-edited amount survives a trip back to the timer; an untouched
  // auto default must be recomputed from the (longer) elapsed time.
  const [billedMinutes, setBilledMinutes] = useState(
    draft?.billedChanged && draft.billedMinutes !== undefined ? draft.billedMinutes : defaultBilled,
  );
  const [billedChanged, setBilledChanged] = useState(draft?.billedChanged ?? false);
  const [editingBilled, setEditingBilled] = useState(false);
  const [billedText, setBilledText] = useState('');
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

  const lessonMode = session?.mode ?? (params.mode === 'online' ? 'online' : 'in_person');
  const subjectOption = subjectOptions.find(o => o.id === subjectId) ?? null;
  const subjectBalance = subjectOption ? subjectOption.balance : bal;
  const subjectName = subjectOption?.subject ?? student?.subject ?? '';
  const balanceAfter = subjectBalance - billedMinutes / 60;
  const bColour = balanceColour(balanceStatus(balanceAfter));
  const firstName = student?.full_name?.trim().split(/\s+/)[0] ?? 'Student';
  const modeDisplay = lessonMode === 'online' ? 'Online' : 'In-person';
  const parsedKm = parseKmInput(kmText);
  const kmValue = lessonMode === 'in_person' ? (parsedKm.error ? null : parsedKm.value ?? 0) : null;
  const kmError = lessonMode === 'in_person' ? parsedKm.error : null;
  const preview = balancePreview({ subjectName, balanceNow: subjectBalance, billedMinutes });
  const travel = student ? travelPreview({ lessonMode, km: kmValue, ...parentTravelTerms(student) }) : null;
  // Picked a different subject or km than booked → save via recordLesson (applies both).
  const reviewChangedBooking =
    (!!subjectId && subjectId !== bookedSubjectId) || (lessonMode === 'in_person' && kmValue !== initialKm);
  const timeDisplay = session?.started_at
    ? `${formatDateLong(endedAtIso)} · ${formatTimeRange(session.started_at, endedAtIso)}`
    : formatDateLong(endedAtIso);

  const warnDeviation = shouldWarnBilledDeviation(billedMinutes, actualMinutes, billedChanged);
  const isZeroBilling = billedMinutes === 0;

  const setBilled = (m: number) => {
    setBilledMinutes(Math.max(0, Math.round(m)));
    setBilledChanged(true);
  };

  const resetBilled = () => {
    setBilledMinutes(defaultBilled);
    setBilledChanged(false);
  };

  const startEditingBilled = () => {
    setBilledText(String(billedMinutes));
    setEditingBilled(true);
  };

  /** Applies the typed minutes; returns the billed value now in effect. */
  const commitBilledText = (): number => {
    const n = parseInt(billedText.replace(/\D/g, ''), 10);
    setEditingBilled(false);
    if (Number.isFinite(n) && n !== billedMinutes) {
      setBilled(n);
      return Math.max(0, n);
    }
    return billedMinutes;
  };

  const changeSubject = (next: string) => {
    setSubjectId(next);
    const allTopics = catalogTopics(subjectOptions.find(o => o.id === next)?.subject);
    setAvailableTopics([...allTopics, ...selectedTopics.filter(t => !allTopics.includes(t))]);
  };

  const toggleTopic = (topic: string) => {
    setTopicError(false);
    setSelectedTopics(prev => (prev.includes(topic) ? prev.filter(t => t !== topic) : [...prev, topic]));
  };

  const submitCustomTopic = () => {
    const trimmed = customTopic.trim();
    if (trimmed) {
      setTopicError(false);
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
      if (reviewChangedBooking && billed > 0 && session?.started_at) {
        recordLesson({
          sessionId,
          studentId: id,
          subjectId,
          startedAt: session.started_at,
          minutes: Math.max(1, actualMinutes),
          billedMinutes: billed,
          topics: selectedTopics,
          notes: notes.trim() || null,
          mode: lessonMode,
          travelKm: kmValue,
        });
      } else {
        endSession({
          sessionId,
          endedAt: endedAtIso,
          durationMinutes: actualMinutes,
          billedMinutes: billed,
          topics: selectedTopics,
          sessionNotes: notes.trim() || undefined,
        });
      }
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

  const proceedZeroOrSave = (billed: number) => {
    if (billed === 0) {
      Alert.alert('Zero charge?', 'This lesson will be saved with no hours deducted. Continue?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save anyway', onPress: () => doSave(billed) },
      ]);
      return;
    }
    doSave(billed);
  };

  const handleSave = () => {
    if (submittingRef.current) return;
    const billed = editingBilled ? commitBilledText() : billedMinutes;
    if (selectedTopics.length < 1) {
      setTopicError(true);
      return;
    }
    if (kmError) return;
    // Warn-but-allow: going past zero credit is a confirm, never a block.
    const after = subjectBalance - billed / 60;
    if (after < 0) {
      Alert.alert(
        'Balance will go negative',
        `${firstName} has ${formatHours(subjectBalance)} of ${subjectName} left. Saving puts them at OWES ${formatHours(Math.abs(after))}.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Save anyway', onPress: () => proceedZeroOrSave(billed) },
        ],
      );
      return;
    }
    proceedZeroOrSave(billed);
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
    fontSize: 11,
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

  const stepButton = (label: string, delta: number, a11y: string) => (
    <TouchableOpacity
      onPress={() => setBilled(billedMinutes + delta)}
      disabled={delta < 0 && billedMinutes <= 0}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      activeOpacity={0.7}
      style={{
        minWidth: MIN_TOUCH + 8,
        minHeight: MIN_TOUCH,
        borderWidth: 1,
        borderColor: COLORS.paperEdge,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: delta < 0 && billedMinutes <= 0 ? 0.4 : 1,
      }}
    >
      <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.ink }}>{label}</Text>
    </TouchableOpacity>
  );

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
        header={<ScreenHeader backLabel="TIMER" onBack={handleBack} />}
        footer={
          <TouchableOpacity
            onPress={handleSave}
            disabled={submitting || alreadyClosed}
            accessibilityRole="button"
            style={{
              backgroundColor: COLORS.oxblood,
              borderRadius: 16,
              minHeight: 52,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: submitting ? 0.5 : 1,
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
            The timer is still running until you save. Go back to keep teaching.
          </Text>
        </View>

        {/* Receipt rows */}
        <View style={{ borderTopWidth: 1, borderTopColor: COLORS.paperEdge }}>
          <View style={rowStyle}>
            <Text style={labelStyle}>STUDENT</Text>
            <Text style={valueStyle(F.sansMed)}>{student?.full_name ?? '—'}</Text>
          </View>
          <View style={rowStyle}>
            <Text style={labelStyle}>WHEN</Text>
            <Text style={valueStyle(F.mono)}>{timeDisplay}</Text>
          </View>
          <View style={rowStyle}>
            <Text style={labelStyle}>GRADE</Text>
            <Text style={valueStyle(F.sans)}>{student ? `Gr ${student.grade} · ${student.curriculum}` : '—'}</Text>
          </View>
          <View style={rowStyle}>
            <Text style={labelStyle}>MODE</Text>
            <Text style={valueStyle(F.sans)}>{modeDisplay}</Text>
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
          <View style={{ flexShrink: 1 }}>
            <Text style={labelStyle}>BILLED</Text>
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint, marginTop: 2 }}>
              {`Taught ${formatMinutes(Math.round(actualMinutes))}`}
              {bookedMinutes ? ` · booked ${formatMinutes(bookedMinutes)}` : ''}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {stepButton(`−${STEP_MINUTES}m`, -STEP_MINUTES, `Bill ${STEP_MINUTES} minutes less`)}
            {editingBilled ? (
              <TextInput
                autoFocus
                value={billedText}
                onChangeText={setBilledText}
                onSubmitEditing={commitBilledText}
                onBlur={commitBilledText}
                keyboardType="number-pad"
                returnKeyType="done"
                selectTextOnFocus
                maxLength={3}
                accessibilityLabel="Billed minutes"
                style={{
                  fontFamily: F.monoMed,
                  fontSize: 15,
                  color: COLORS.ink,
                  minWidth: 64,
                  minHeight: MIN_TOUCH,
                  textAlign: 'center',
                  borderBottomWidth: 1,
                  borderBottomColor: COLORS.oxblood,
                }}
              />
            ) : (
              <TouchableOpacity
                onPress={startEditingBilled}
                accessibilityRole="button"
                accessibilityLabel={`Billed ${formatMinutes(billedMinutes)}. Tap to type minutes.`}
                style={{ minWidth: 64, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontFamily: F.monoMed, fontSize: 15, color: COLORS.ink }}>
                  {formatMinutes(billedMinutes)}
                </Text>
                <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, letterSpacing: 0.5 }}>TAP TO EDIT</Text>
              </TouchableOpacity>
            )}
            {stepButton(`+${STEP_MINUTES}m`, STEP_MINUTES, `Bill ${STEP_MINUTES} minutes more`)}
          </View>
        </View>
        {editingBilled ? (
          <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkFaint, paddingTop: 6 }}>Type minutes, e.g. 75.</Text>
        ) : null}
        {warnDeviation ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 6, gap: 12 }}>
            <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.amber, flexShrink: 1 }}>
              {`Billing ${formatMinutes(billedMinutes)} for ${formatMinutes(Math.round(actualMinutes))} taught.`}
            </Text>
            <TouchableOpacity onPress={resetBilled} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }} accessibilityRole="button">
              <Text style={{ fontFamily: F.sansMed, fontSize: 12, color: COLORS.oxblood }}>
                {`Reset to ${formatMinutes(defaultBilled)}`}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {isZeroBilling ? (
          <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.crimson, paddingTop: 6 }}>
            No hours will be deducted — you'll be asked to confirm.
          </Text>
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
          {topicError && (
            <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.crimson, marginTop: 8 }}>
              At least one topic is required.
            </Text>
          )}
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
