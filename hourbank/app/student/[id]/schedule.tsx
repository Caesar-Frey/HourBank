import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { F, hitSlopFor } from '../../../src/theme/fonts';
import { COLORS } from '../../../src/theme/colors';
import { FormScreen } from '../../../src/components/FormScreen';
import { ScreenHeader } from '../../../src/components/ScreenHeader';
import { TopicChip } from '../../../src/components/TopicChip';
import { ErrorBoundary } from '../../../src/components/ErrorBoundary';
import { DurationStepperSheet } from '../../../src/components/DurationStepperSheet';
import { useToast } from '../../../src/components/Toast';
import { getStudent } from '../../../src/db/students';
import { isSubjectError } from '../../../src/db/subjects';
import { SubjectPicker, TravelKmField } from '../../../src/components/lesson/LessonFields';
import { billingRoundMinutes, loadSubjectOptions, type SubjectOption } from '../../../src/components/lesson/lessonFormData';
import { defaultSubjectId, parseKmInput } from '../../../src/components/lesson/lessonFormLogic';
import {
  createScheduled, getSession, isSessionError, listUpcomingWithProjection, updateScheduled,
} from '../../../src/db/sessions';
import { findOverlappingCalendarItems } from '../../../src/db/calendar';
import { listTopicsForStudentSubject, addCustomTopicForSubject } from '../../../src/db/catalog';
import { Session, Student } from '../../../src/db/schema';
import { formatDateLong, formatMinutes, formatScheduledTime, formatTime } from '../../../src/utils/format';
import { DateTimeField } from '../../../src/components/student/DateTimeField';
import { useUnsavedChangesGuard } from '../../../src/hooks/useUnsavedChangesGuard';
import {
  Banner, Button, ChoicePills, FieldError, LoadingState, NotFoundState, PageHeading, SectionLabel,
} from '../../../src/components/student/ui';
import {
  conflictSummary, formatBalance, projectedBalanceWithBookings, validateScheduleStart,
} from '../../../src/components/student/flowLogic';

const PRESET_MINUTES = [30, 60, 90, 120];
type Mode = Session['mode'];
type SessionType = Session['session_type'];

const SESSION_TYPES: Array<{ value: SessionType; label: string }> = [
  { value: 'general', label: 'General' },
  { value: 'review', label: 'Review' },
  { value: 'test_prep', label: 'Test prep' },
  { value: 'exam_prep', label: 'Exam prep' },
];

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function defaultStart(dateParam?: string): Date {
  if (dateParam) {
    const prefilled = new Date(`${dateParam}T00:00:00`);
    if (!Number.isNaN(prefilled.getTime())) {
      prefilled.setHours(15, 0, 0, 0);
      return prefilled;
    }
  }
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  d.setHours(15, 0, 0, 0);
  return d;
}

export default function ScheduleScreen() {
  return (
    <ErrorBoundary>
      <ScheduleScreenInner />
    </ErrorBoundary>
  );
}

function ScheduleScreenInner() {
  const { id, sessionId, date: dateParam, from, subjectId: subjectParam } = useLocalSearchParams<{ id: string; sessionId?: string; date?: string; from?: string; subjectId?: string }>();
  const isReschedule = !!sessionId;
  const router = useRouter();
  const toast = useToast();
  const savingRef = useRef(false);

  const [student, setStudent] = useState<Student | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [booked, setBooked] = useState<Array<{ id: string; estimated_duration_minutes: number | null; subject_id?: string | null }>>([]);
  const [subjectOptions, setSubjectOptions] = useState<SubjectOption[]>([]);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [km, setKm] = useState('');

  const [date, setDate] = useState<Date>(() => defaultStart(isReschedule ? undefined : dateParam));
  const [minutes, setMinutes] = useState(60);
  const [showDurationSheet, setShowDurationSheet] = useState(false);
  const [mode, setMode] = useState<Mode>('in_person');
  const [sessionType, setSessionType] = useState<SessionType>('general');
  const [topics, setTopics] = useState<string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [addingTopic, setAddingTopic] = useState(false);
  const [customTopicInput, setCustomTopicInput] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try {
      const s = getStudent(id);
      setStudent(s);
      if (!s) return;
      setBooked(listUpcomingWithProjection(id));
      const { options, primaryId: primary } = loadSubjectOptions(id);
      setSubjectOptions(options);
      setPrimaryId(primary);
      let sid = defaultSubjectId(options, subjectParam ?? null, primary);
      let lessonKm: number | null = null;
      if (sessionId) {
        const existing = getSession(sessionId);
        if (existing && existing.student_id === id) {
          sid = existing.subject_id && options.some(o => o.id === existing.subject_id) ? existing.subject_id : sid;
          lessonKm = existing.travel_km ?? null;
        }
      }
      setSubjectId(sid);
      setKm(String(lessonKm ?? s.travel_distance_km ?? 0));
      const subjectName = options.find(o => o.id === sid)?.subject ?? s.subject;
      setTopics(listTopicsForStudentSubject(subjectName).map(t => t.name));
      if (sessionId) {
        const existing = getSession(sessionId);
        if (!existing || existing.student_id !== id) {
          setLoadError('That lesson could not be found.');
        } else if (existing.status !== 'scheduled') {
          setLoadError('That lesson has already started, been logged or been cancelled.');
        } else {
          if (existing.scheduled_for) setDate(new Date(existing.scheduled_for));
          if (existing.estimated_duration_minutes) setMinutes(existing.estimated_duration_minutes);
          setMode(existing.mode);
          setSessionType(existing.session_type);
          try {
            const parsed: unknown = JSON.parse(existing.topics);
            if (Array.isArray(parsed)) {
              const list = parsed.filter((t): t is string => typeof t === 'string');
              setSelectedTopics(list);
              setTopics(prev => [...prev, ...list.filter(t => !prev.includes(t))]);
            }
          } catch { /* malformed topics */ }
          setNotes(existing.session_notes ?? '');
        }
      }
    } catch {
      setLoadError("Couldn't load this student.");
    } finally {
      setLoaded(true);
    }
  }, [id, sessionId, subjectParam]);

  const conflict = useMemo(() => {
    try {
      const end = new Date(date.getTime() + minutes * 60_000);
      return conflictSummary(
        findOverlappingCalendarItems(date.toISOString(), end.toISOString(), { excludeSessionId: sessionId }),
      );
    } catch {
      return null;
    }
  }, [date, minutes, sessionId]);

  // Unsaved-changes guard (D7).
  const formKey = JSON.stringify([subjectId, km, date.getTime(), minutes, mode, sessionType, selectedTopics, notes]);
  const baselineRef = useRef<string | null>(null);
  useEffect(() => {
    if (loaded && student && baselineRef.current === null) baselineRef.current = formKey;
  }, [loaded, student, formKey]);
  const dirty = baselineRef.current !== null && baselineRef.current !== formKey;
  const { allowLeave } = useUnsavedChangesGuard(dirty, {
    title: isReschedule ? 'Discard your changes?' : 'Discard this booking?',
    message: isReschedule ? 'The lesson keeps its old time.' : 'The lesson hasn’t been booked yet.',
  });

  if (!loaded) return <LoadingState />;
  if (!student) return <NotFoundState title="Student not found" onBack={() => router.back()} />;
  if (loadError) return <NotFoundState title={loadError} onBack={() => router.back()} />;

  const firstName = student.full_name.trim().split(/\s+/)[0];
  const validation = validateScheduleStart(date);
  const showPastError = !validation.ok;
  const subject = subjectOptions.find(o => o.id === subjectId) ?? null;
  const subjectName = subject?.subject ?? student.subject;
  const balance = subject ? subject.balance : 0;
  // Per subject: only lessons booked on this subject draw on its balance.
  const bookedSameSubject = booked.filter(b => (b.subject_id ?? primaryId) === subjectId);
  const { otherBookedHours, projected } = projectedBalanceWithBookings(balance, bookedSameSubject, minutes, sessionId);
  const parsedKm = parseKmInput(km);
  const kmError = mode === 'in_person' ? parsedKm.error : null;
  /** Stored override: null = follow the student's default km. */
  const travelKmToStore =
    mode === 'online' || parsedKm.value === null || parsedKm.value === (student.travel_distance_km ?? 0) ? null : parsedKm.value;

  function changeSubject(next: string) {
    setSubjectId(next);
    const name = subjectOptions.find(o => o.id === next)?.subject ?? student!.subject;
    const catalog = listTopicsForStudentSubject(name).map(t => t.name);
    setTopics([...catalog, ...selectedTopics.filter(t => !catalog.includes(t))]);
  }

  function changeDate(next: Date) {
    setDate(next);
  }

  function logAsPast() {
    // Built by hand: RN's URLSearchParams polyfill lacks set().
    const query = `startedAt=${encodeURIComponent(date.toISOString())}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ''}${from === 'lesson' ? '&from=lesson' : ''}`;
    allowLeave();
    router.replace(`/student/${id}/log-past?${query}`);
  }

  function toggleTopic(topic: string) {
    setSelectedTopics(prev => (prev.includes(topic) ? prev.filter(t => t !== topic) : [...prev, topic]));
  }

  function submitCustomTopic() {
    const trimmed = customTopicInput.trim();
    setAddingTopic(false);
    setCustomTopicInput('');
    if (!trimmed || !student) return;
    try {
      addCustomTopicForSubject(subjectName, trimmed);
      const refreshed = listTopicsForStudentSubject(subjectName).map(t => t.name);
      setTopics([...refreshed, ...selectedTopics.filter(t => !refreshed.includes(t))]);
    } catch {
      setTopics(prev => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    }
    setSelectedTopics(prev => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
  }

  function doConfirm() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const iso = date.toISOString();
    try {
      if (isReschedule && sessionId) {
        // One transaction: date, length, mode, topics and km together (D4).
        updateScheduled(sessionId, {
          scheduledFor: iso,
          estimatedDurationMinutes: minutes,
          mode,
          session_type: sessionType,
          topics: selectedTopics,
          notes: notes.trim() || undefined,
          subjectId: subjectId ?? undefined,
          travelKm: travelKmToStore,
        });
        toast.show({ kind: 'success', message: `Lesson moved to ${formatScheduledTime(iso)}` });
      } else {
        createScheduled({
          studentId: id,
          subjectId,
          travelKm: travelKmToStore,
          scheduledFor: iso,
          estimatedDurationMinutes: minutes,
          mode,
          session_type: sessionType,
          topics: selectedTopics,
          notes: notes.trim() || undefined,
        });
        toast.show({ kind: 'success', message: `Lesson booked · ${formatScheduledTime(iso)}` });
      }
      allowLeave();
      router.back();
    } catch (e) {
      savingRef.current = false;
      setSaving(false);
      toast.show({
        kind: 'error',
        message: isSessionError(e, 'INVALID_STATE')
          ? 'That lesson has already started or been cancelled'
          : isSubjectError(e)
            ? 'That subject isn’t available any more — pick another'
            : isSessionError(e, 'INVALID_INPUT')
              ? 'Check the km — it must be zero or more'
              : `Couldn't ${isReschedule ? 'move' : 'book'} the lesson — please try again`,
      });
    }
  }

  function handleConfirm() {
    if (!validateScheduleStart(date).ok || kmError) return;
    if (projected < 0) {
      Alert.alert(
        `${firstName} will owe ${formatBalance(-projected)}`,
        `${subjectName} balance ${formatBalance(balance)}, other booked ${subjectName} lessons ${formatMinutes(otherBookedHours * 60)}, this lesson ${formatMinutes(minutes)}. Remind the parent to top up.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: isReschedule ? 'Move anyway' : 'Book anyway', onPress: doConfirm },
        ],
      );
      return;
    }
    doConfirm();
  }

  const isCustomDuration = !PRESET_MINUTES.includes(minutes);

  return (
    <FormScreen
      header={<ScreenHeader backLabel={firstName.toUpperCase()} onBack={() => router.back()} />}
      footer={
        <Button
          label={isReschedule ? 'Move lesson' : 'Book lesson'}
          icon={isReschedule ? 'repeat' : 'calendar'}
          onPress={handleConfirm}
          disabled={!validation.ok || !!kmError}
          busy={saving}
        />
      }
    >
      <PageHeading
        eyebrow={isReschedule ? '★ RESCHEDULE LESSON' : '★ BOOK LESSON'}
        line1={isReschedule ? 'New time,' : 'When are'}
        line2={isReschedule ? 'same student.' : 'you meeting?'}
      />

      <View style={{ marginBottom: 24 }}>
        <SectionLabel>SUBJECT</SectionLabel>
        <SubjectPicker options={subjectOptions} value={subjectId} onChange={changeSubject} fallbackName={student.subject} />
      </View>

      <View style={{ flexDirection: 'row', gap: 16 }}>
        <View style={{ flex: 3 }}>
          <SectionLabel>DATE</SectionLabel>
          <DateTimeField
            mode="date"
            value={date}
            onChange={changeDate}
            display={formatDateLong(date)}
            accessibilityLabel="Lesson date"
            minimumDate={startOfToday()}
            invalid={showPastError}
          />
        </View>
        <View style={{ flex: 2 }}>
          <SectionLabel>TIME</SectionLabel>
          <DateTimeField
            mode="time"
            value={date}
            onChange={changeDate}
            display={formatTime(date)}
            accessibilityLabel="Start time"
            invalid={showPastError}
          />
        </View>
      </View>

      {showPastError && !validation.ok ? (
        <View style={{ marginTop: 8 }}>
          <FieldError message={validation.message} />
          <View style={{ marginTop: 8 }}>
            <Banner
              tone="info"
              icon="clock"
              action={{ label: 'Record it instead →', onPress: logAsPast }}
            >
              Already taught this one? Record it instead and the hours are deducted.
            </Banner>
          </View>
        </View>
      ) : null}

      {conflict ? (
        <View style={{ marginTop: 10 }}>
          <Banner tone="warn" icon="alert-triangle">{conflict}</Banner>
        </View>
      ) : null}

      <View style={{ marginTop: 24 }}>
        <SectionLabel>DURATION</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
          {[...PRESET_MINUTES.map(m => ({ m, label: formatMinutes(m), custom: false })),
            { m: -1, label: isCustomDuration ? `Custom · ${formatMinutes(minutes)}` : 'Custom', custom: true }].map(opt => {
            const active = opt.custom ? isCustomDuration : minutes === opt.m;
            return (
              <TouchableOpacity
                key={opt.label}
                onPress={() => (opt.custom ? setShowDurationSheet(true) : setMinutes(opt.m))}
                activeOpacity={0.75}
                hitSlop={hitSlopFor(36)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={opt.custom ? 'Custom duration' : opt.label}
                style={{
                  minHeight: 36,
                  justifyContent: 'center',
                  backgroundColor: active ? COLORS.ink : COLORS.transparent,
                  borderWidth: 1,
                  borderColor: active ? COLORS.ink : COLORS.paperEdge,
                  borderRadius: 999,
                  paddingHorizontal: 16,
                }}
              >
                <Text style={{ fontFamily: F.mono, fontSize: 13, color: active ? COLORS.paper : COLORS.ink }}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text
          style={{ fontFamily: F.mono, fontSize: 12, color: projected < 0 ? COLORS.crimson : COLORS.inkSoft, marginTop: 10 }}
        >
          {`${subjectName} ${formatBalance(balance)}`}
          {otherBookedHours > 0 ? ` · booked ${formatMinutes(otherBookedHours * 60)}` : ''}
          {` · after this ${formatBalance(projected)}`}
        </Text>
      </View>

      <DurationStepperSheet
        visible={showDurationSheet}
        initialMinutes={minutes}
        onConfirm={mins => { setMinutes(mins); setShowDurationSheet(false); }}
        onCancel={() => setShowDurationSheet(false)}
        step={billingRoundMinutes()}
      />

      {projected < 0 ? (
        <View style={{ marginTop: 12 }}>
          <Banner tone="bad" icon="alert-circle">
            {`${firstName} will owe ${formatBalance(-projected)} once this and the other booked lessons are taught. Remind the parent to top up before ${formatDateLong(date)}.`}
          </Banner>
        </View>
      ) : projected < 1 ? (
        <View style={{ marginTop: 12 }}>
          <Banner tone="warn" icon="alert-triangle">
            {`Only ${formatBalance(projected)} left after booked lessons. Consider a top-up.`}
          </Banner>
        </View>
      ) : null}

      <View style={{ marginTop: 24 }}>
        <SectionLabel>MODE</SectionLabel>
        <ChoicePills
          options={[{ value: 'in_person', label: 'In-person' }, { value: 'online', label: 'Online' }]}
          value={mode}
          onChange={setMode}
          icons={{ in_person: 'map-pin', online: 'monitor' }}
        />
      </View>

      {mode === 'in_person' ? (
        <View style={{ marginTop: 20 }}>
          <SectionLabel>TRAVEL</SectionLabel>
          <TravelKmField text={km} onChangeText={setKm} error={kmError} defaultKm={student.travel_distance_km ?? null} />
        </View>
      ) : null}

      <View style={{ marginTop: 24 }}>
        <SectionLabel>TYPE</SectionLabel>
        <ChoicePills options={SESSION_TYPES} value={sessionType} onChange={setSessionType} />
      </View>

      <View style={{ marginTop: 24 }}>
        <SectionLabel>TOPICS (OPTIONAL)</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {topics.map(topic => (
            <TopicChip key={topic} label={topic} selected={selectedTopics.includes(topic)} onPress={() => toggleTopic(topic)} />
          ))}
          {addingTopic ? (
            <TextInput
              autoFocus
              value={customTopicInput}
              onChangeText={setCustomTopicInput}
              onSubmitEditing={submitCustomTopic}
              onBlur={submitCustomTopic}
              placeholder="Topic name…"
              placeholderTextColor={COLORS.inkFaint}
              returnKeyType="done"
              style={{
                fontFamily: F.sans,
                fontSize: 13,
                color: COLORS.ink,
                borderWidth: 1,
                borderColor: COLORS.ink,
                borderRadius: 999,
                paddingHorizontal: 12,
                minHeight: 36,
                minWidth: 120,
              }}
            />
          ) : (
            <TouchableOpacity
              onPress={() => setAddingTopic(true)}
              activeOpacity={0.75}
              hitSlop={hitSlopFor(36)}
              accessibilityRole="button"
              accessibilityLabel="Add a topic"
              style={{
                borderWidth: 1,
                borderColor: COLORS.inkFaint,
                borderStyle: 'dashed',
                borderRadius: 999,
                paddingHorizontal: 12,
                minHeight: 36,
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft }}>+ Add</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={{ marginTop: 24 }}>
        <SectionLabel>NOTES (OPTIONAL)</SectionLabel>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder="Anything to prepare…"
          placeholderTextColor={COLORS.inkFaint}
          accessibilityLabel="Lesson notes"
          style={{
            fontFamily: F.sans,
            fontSize: 15,
            color: COLORS.ink,
            borderBottomWidth: 1,
            borderBottomColor: COLORS.paperEdge,
            paddingVertical: 10,
            minHeight: 72,
            textAlignVertical: 'top',
          }}
        />
      </View>
    </FormScreen>
  );
}
