/**
 * Record / Edit lesson form — THE main way a lesson gets onto the books.
 *
 * - record: a booked/overdue lesson (`sessionId`, prefilled) or an unscheduled one.
 *   Save → recordLesson → toast → lesson summary (lessonNav keeps Back → student page).
 * - edit: a completed lesson → editLesson (in place). In a claim: warn, allow.
 *
 * Owing past the tutor's limit is a nudge (confirm), never a block.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Switch, Text, TextInput, View } from 'react-native';
import { useNavigationContainerRef, useRouter } from 'expo-router';
import { CommonActions } from '@react-navigation/native';
import { F, MIN_TOUCH } from '../../theme/fonts';
import { COLORS } from '../../theme/colors';
import { FormScreen } from '../FormScreen';
import { ScreenHeader } from '../ScreenHeader';
import { useToast } from '../Toast';
import { DateTimeField } from '../student/DateTimeField';
import { Banner, Button, ChoicePills, FieldError, LoadingState, NotFoundState, PageHeading, SectionLabel } from '../student/ui';
import { getStudent } from '../../db/students';
import {
  checkOweLimit, editLesson, findOverlappingLesson, getSession, isChargedNoShow, isEditableLesson, isSessionError, isSessionInClaim,
  parseSessionTopics, recordLesson,
} from '../../db/sessions';
import { getSubjectBalance, isSubjectError } from '../../db/subjects';
import { isTravelError } from '../../db/travel';
import { addCustomTopicForSubject } from '../../db/catalog';
import type { Session, Student } from '../../db/schema';
import { applyLessonSavedNav, lessonSavedNav } from '../../utils/lessonNav';
import { formatDateLong, formatDayShort, formatHours, formatMinutes, formatRand, formatTime, formatTimeRange } from '../../utils/format';
import { ClaimedLineInfo, getClaimedLineForSession } from '../../db/claims';
import {
  balancePreview,
  buildEditPatch,
  claimEditEffect,
  claimWarning,
  defaultRecordMinutes,
  defaultRecordStart,
  defaultSubjectId,
  defaultTravelKm,
  hasFormErrors,
  parseKmInput,
  topicsAfterSubjectChange,
  topicsUpdatedNote,
  travelPreview,
  validateLessonForm,
  type LessonFormValues,
  type LessonMode,
} from './lessonFormLogic';
import {
  billingRoundMinutes,
  builtinCatalogTopics,
  catalogTopics,
  claimLabelForSession,
  loadSubjectOptions,
  parentTravelTerms,
  subjectNameFor,
  type SubjectOption,
} from './lessonFormData';
import { BilledMinutesField, LessonPreview, SubjectPicker, TopicsField, TravelKmField } from './LessonFields';

export type LessonFormScreenProps =
  | { kind: 'record'; studentId: string; sessionId?: string; startedAt?: string; from?: string; subjectId?: string }
  | { kind: 'edit'; sessionId: string };

type Ctx = {
  student: Student;
  session: Session | null;
  options: SubjectOption[];
  /** Name of the lesson's own subject when it is no longer active. */
  fallbackSubject: { id: string; name: string; balance: number } | null;
  original: LessonFormValues | null;
  movedFromBooking: boolean;
  inClaim: boolean;
  claimLabel: string | null;
  claimLine: ClaimedLineInfo | null;
};

function kmText(km: number | null): string {
  return km == null ? '' : String(km);
}

/** Friendly copy for a failed save (never raw DB messages). */
export function lessonSaveErrorMessage(e: unknown, kind: 'record' | 'edit'): string {
  if (isSessionError(e, 'INVALID_STATE')) {
    return kind === 'edit' ? 'Only recorded lessons can be edited' : 'That lesson was already recorded or cancelled';
  }
  if (isSessionError(e, 'NOT_FOUND')) return 'That lesson no longer exists';
  if (isSessionError(e, 'INVALID_INPUT')) return e.message.replace(/^INVALID_INPUT:\s*/, '');
  if (isSubjectError(e)) return 'That subject isn’t available for this student any more — pick another';
  if (isTravelError(e)) return 'Couldn’t work out the travel charge — check the km';
  return kind === 'edit' ? 'Couldn’t save your changes — please try again' : 'Couldn’t record the lesson — please try again';
}

export function LessonFormScreen(props: LessonFormScreenProps) {
  const router = useRouter();
  const navRef = useNavigationContainerRef();
  const toast = useToast();
  const savingRef = useRef(false);
  const isEdit = props.kind === 'edit';
  const sessionIdProp = props.sessionId;
  const studentIdProp = props.kind === 'record' ? props.studentId : null;
  const startedAtProp = props.kind === 'record' ? props.startedAt : undefined;
  /** Preselected subject (e.g. a subject card's Record button); a booked lesson's own subject wins. */
  const subjectIdProp = props.kind === 'record' ? props.subjectId : undefined;

  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [start, setStart] = useState<Date>(() => new Date());
  const [billed, setBilled] = useState(60);
  const [mode, setMode] = useState<LessonMode>('in_person');
  const [km, setKm] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [topicsNote, setTopicsNote] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  /** Charged no-show only: "Include travel" (owner decision 2026-11-12, default off). */
  const [noShowTravel, setNoShowTravel] = useState(false);
  const [step] = useState(billingRoundMinutes);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try {
      let session: Session | null = null;
      let student: Student | null = null;
      if (isEdit) {
        session = sessionIdProp ? getSession(sessionIdProp) : null;
        if (!session) {
          setLoadError('That lesson could not be found.');
          return;
        }
        if (!isEditableLesson(session)) {
          setLoadError('Only recorded lessons can be edited.');
          return;
        }
        student = getStudent(session.student_id);
      } else {
        student = studentIdProp ? getStudent(studentIdProp) : null;
        if (student && sessionIdProp) {
          session = getSession(sessionIdProp);
          if (!session || session.student_id !== student.id) {
            setLoadError('That lesson could not be found.');
            return;
          }
          if (session.status !== 'scheduled') {
            setLoadError('That lesson has already been recorded or cancelled.');
            return;
          }
        }
      }
      if (!student) {
        setLoadError('Student not found');
        return;
      }

      const { options, primaryId } = loadSubjectOptions(student.id);
      const lessonSubject = session?.subject_id ?? null;
      const sid = isEdit && lessonSubject ? lessonSubject : defaultSubjectId(options, lessonSubject ?? subjectIdProp ?? null, primaryId);
      let fallbackSubject: Ctx['fallbackSubject'] = null;
      if (sid && !options.some(o => o.id === sid)) {
        fallbackSubject = { id: sid, name: subjectNameFor(sid) ?? 'Subject', balance: getSubjectBalance(student.id, sid) };
      }
      const sessionMode: LessonMode = session?.mode ?? 'in_person';
      const minutes = isEdit
        ? session!.billed_minutes ?? session!.duration_minutes ?? 60
        : defaultRecordMinutes(session?.estimated_duration_minutes);
      let startDate: Date;
      let movedFromBooking = false;
      if (isEdit) {
        startDate = new Date(session!.started_at ?? session!.ended_at ?? session!.scheduled_for ?? Date.now());
      } else {
        const r = defaultRecordStart({ bookedStart: session?.scheduled_for, explicitStart: startedAtProp, minutes, now: new Date() });
        startDate = r.start;
        movedFromBooking = r.movedFromBooking;
      }
      const kmValue = defaultTravelKm({ mode: sessionMode, lessonKm: session?.travel_km, studentKm: student.travel_distance_km });
      const preselected = parseSessionTopics(session?.topics);
      const subjectName = options.find(o => o.id === sid)?.subject ?? fallbackSubject?.name ?? student.subject;
      const catalog = catalogTopics(subjectName);
      const notesValue = session?.session_notes ?? '';

      setSubjectId(sid);
      setStart(startDate);
      setBilled(minutes);
      setMode(sessionMode);
      setKm(kmText(kmValue));
      setSelectedTopics(preselected);
      setTopics([...catalog, ...preselected.filter(t => !catalog.includes(t))]);
      setNotes(notesValue);
      setNoShowTravel(session?.no_show_travel === 1);

      const inClaim = isEdit ? isSessionInClaim(session!.id) : false;
      setCtx({
        student,
        session,
        options,
        fallbackSubject,
        original: isEdit
          ? {
              subjectId: sid,
              start: startDate,
              billedMinutes: minutes,
              mode: sessionMode,
              // What the km field shows initially, so an untouched field never re-prices travel.
              travelKm: parseKmInput(kmText(kmValue)).value,
              topics: preselected,
              notes: notesValue,
            }
          : null,
        movedFromBooking,
        inClaim,
        claimLabel: inClaim ? claimLabelForSession(session!.id) : null,
        claimLine: inClaim ? getClaimedLineForSession(session!.id) : null,
      });
    } catch {
      setLoadError('Couldn’t load this lesson.');
    } finally {
      setLoaded(true);
    }
  }, [isEdit, sessionIdProp, studentIdProp, startedAtProp, subjectIdProp]);

  const parsedKm = useMemo(() => parseKmInput(km), [km]);

  const subjectName = useMemo(() => {
    if (!ctx) return '';
    return ctx.options.find(o => o.id === subjectId)?.subject ?? (ctx.fallbackSubject?.id === subjectId ? ctx.fallbackSubject.name : ctx.student.subject);
  }, [ctx, subjectId]);

  if (!loaded) return <LoadingState />;
  if (loadError || !ctx) return <NotFoundState title={loadError ?? 'Lesson not found'} onBack={() => router.back()} />;

  const { student, session, original } = ctx;
  // Charged no-show: only billed time, subject and notes are editable (nobody travelled).
  const noShow = isEdit && !!session && isChargedNoShow(session);
  const firstName = student.full_name.trim().split(/\s+/)[0];
  const subjectBalance =
    ctx.options.find(o => o.id === subjectId)?.balance ?? (ctx.fallbackSubject?.id === subjectId ? ctx.fallbackSubject.balance : 0);
  const kmValue = mode === 'in_person' ? (parsedKm.error ? null : parsedKm.value ?? 0) : null;

  const balance = balancePreview({
    subjectName,
    balanceNow: subjectBalance,
    billedMinutes: billed,
    subjectId,
    original: original ? { subjectId: original.subjectId, billedMinutes: original.billedMinutes } : null,
  });
  const travel = noShow ? null : travelPreview({
    lessonMode: mode,
    km: kmValue,
    ...parentTravelTerms(student),
    snapshot: isEdit && session
      ? { fee: session.parent_travel_fee ?? null, km: original?.travelKm ?? null, mode: session.mode }
      : null,
  });
  const errors = validateLessonForm({ start, billedMinutes: billed, kmError: mode === 'in_person' ? parsedKm.error : null, subjectId });
  const visibleErrors = showErrors ? errors : { ...(errors.km ? { km: errors.km } : {}), ...(errors.start ? { start: errors.start } : {}) };
  const warnText = claimWarning(ctx.inClaim, ctx.claimLabel);

  function changeSubject(id: string) {
    setSubjectId(id);
    const name = ctx!.options.find(o => o.id === id)?.subject;
    const next = topicsAfterSubjectChange({
      selected: selectedTopics,
      oldCatalog: builtinCatalogTopics(subjectName),
      newCatalog: catalogTopics(name),
    });
    setTopics(next.topics);
    setSelectedTopics(next.selected);
    setTopicsNote(topicsUpdatedNote(next.removed, name ?? 'this subject'));
  }

  function changeMode(next: LessonMode) {
    setMode(next);
    if (next === 'in_person' && !km.trim()) {
      setKm(kmText(defaultTravelKm({ mode: next, lessonKm: session?.travel_km, studentKm: student.travel_distance_km })));
    }
  }

  function toggleTopic(t: string) {
    setTopicsNote(null);
    setSelectedTopics(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]));
  }

  function addTopic(t: string) {
    setTopicsNote(null);
    try {
      addCustomTopicForSubject(subjectName, t);
    } catch { /* still usable on this lesson */ }
    setTopics(prev => (prev.includes(t) ? prev : [...prev, t]));
    setSelectedTopics(prev => (prev.includes(t) ? prev : [...prev, t]));
  }

  function release() {
    savingRef.current = false;
    setSaving(false);
  }

  function goToSummary(sessionId: string) {
    if (props.kind === 'record' && props.from === 'lesson' && session && router.canGoBack()) {
      router.back();
      return;
    }
    applyLessonSavedNav(
      router,
      navRef,
      lessonSavedNav({ rootState: navRef.getRootState(), studentId: student.id, lessonHref: `/lesson/${sessionId}?justSaved=1` }),
      state => CommonActions.reset(state as never),
    );
  }

  function commitRecord() {
    try {
      const { session: saved } = recordLesson({
        sessionId: session?.id,
        studentId: student.id,
        subjectId,
        startedAt: start.toISOString(),
        billedMinutes: billed,
        topics: selectedTopics,
        notes: notes.trim() || null,
        mode,
        travelKm: kmValue,
      });
      toast.show({
        kind: 'success',
        message: `Lesson recorded · ${subjectName} ${formatMinutes(billed)} · ${balance.owes ? `owes ${formatHours(-balance.after)}` : `${formatHours(balance.after)} left`}`,
      });
      goToSummary(saved.id);
    } catch (e) {
      release();
      toast.show({ kind: 'error', message: lessonSaveErrorMessage(e, 'record') });
    }
  }

  function commitEdit() {
    if (!original || !session) return;
    const patch = buildEditPatch(original, {
      subjectId, start, billedMinutes: billed, mode, travelKm: kmValue, topics: selectedTopics, notes,
      // No-show: time/mode/travel aren't editable — never send them.
      ...(noShow ? { start: original.start, mode: original.mode, travelKm: original.travelKm, topics: original.topics } : {}),
    });
    if (noShow && noShowTravel !== (session.no_show_travel === 1)) patch.noShowTravel = noShowTravel;
    if (Object.keys(patch).length === 0) {
      release();
      toast.show({ kind: 'info', message: 'No changes to save' });
      router.back();
      return;
    }
    try {
      editLesson(session.id, patch);
      toast.show({ kind: 'success', message: 'Lesson updated' });
      router.back();
    } catch (e) {
      release();
      toast.show({ kind: 'error', message: lessonSaveErrorMessage(e, 'edit') });
    }
  }

  function save() {
    if (savingRef.current) return;
    setShowErrors(true);
    if (hasFormErrors(errors)) return;
    savingRef.current = true;
    setSaving(true);
    const commit = isEdit ? commitEdit : commitRecord;

    // Owing past the tutor's limit → confirm (nudge), only when this save takes more hours.
    const extraMinutes = billed - (original && original.subjectId === subjectId ? original.billedMinutes : 0);
    let over = false;
    if (extraMinutes > 0 && balance.owes) {
      try {
        over = checkOweLimit(student.id, extraMinutes, subjectId).overLimit;
      } catch {
        over = false;
      }
    }
    // Same lesson twice? Ask before recording another (A6) — a nudge, never a block.
    let duplicate: Session | null = null;
    if (!isEdit) {
      try {
        duplicate = findOverlappingLesson(student.id, start.toISOString(), billed, session?.id ?? null);
      } catch {
        duplicate = null;
      }
    }
    const confirmDuplicate = () => {
      if (!duplicate?.started_at) return commit();
      const end = duplicate.ended_at ?? new Date(new Date(duplicate.started_at).getTime() + (duplicate.billed_minutes ?? 60) * 60_000).toISOString();
      Alert.alert(
        'Already recorded?',
        `${firstName} already has a lesson recorded ${formatDayShort(duplicate.started_at)} ${formatTimeRange(duplicate.started_at, end)}. Record another?`,
        [
          { text: 'Cancel', style: 'cancel', onPress: release },
          { text: 'Record another', onPress: commit },
        ],
        { cancelable: true, onDismiss: release },
      );
    };

    const confirmOver = () => {
      if (!over) return confirmDuplicate();
      Alert.alert(
        `${firstName} will owe ${formatHours(-balance.after)}`,
        `${subjectName} goes past your owing limit. ${isEdit ? 'Save' : 'Record'} anyway and remind the parent to top up?`,
        [
          { text: 'Cancel', style: 'cancel', onPress: release },
          { text: isEdit ? 'Save anyway' : 'Record anyway', onPress: confirmDuplicate },
        ],
        { cancelable: true, onDismiss: release },
      );
    };

    // Lesson inside a finalised claim: keep the nudge, but say the rand effect (B4).
    const line = ctx?.claimLine ?? null;
    const effect = isEdit && line
      ? claimEditEffect({
          claimLabel: line.periodLabel,
          claimTotal: line.claimTotal,
          claimedHours: line.billedHours,
          claimedMode: line.mode,
          claimedTravel: line.travelFee,
          rate: line.rate,
          newBilledMinutes: billed,
          newMode: mode,
          formatRand,
        })
      : null;
    if (effect) {
      Alert.alert(effect.title, effect.message, [
        { text: 'Cancel', style: 'cancel', onPress: release },
        { text: 'Save anyway', onPress: confirmOver },
      ], { cancelable: true, onDismiss: release });
      return;
    }
    confirmOver();
  }

  const heading = noShow
    ? { eyebrow: '★ EDIT NO-SHOW', line1: 'Fix the', line2: 'charge.' }
    : isEdit
    ? { eyebrow: '★ EDIT LESSON', line1: 'Fix the', line2: 'details.' }
    : session
      ? { eyebrow: '★ RECORD LESSON', line1: 'Booked lesson,', line2: 'now taught.' }
      : { eyebrow: '★ RECORD LESSON', line1: 'Already', line2: 'taught?' };

  return (
    <FormScreen
      header={<ScreenHeader backLabel={isEdit ? 'LESSON' : firstName.toUpperCase()} onBack={() => router.back()} />}
      footer={
        <Button
          label={isEdit ? 'Save changes' : `Record lesson · ${formatMinutes(billed)}`}
          icon="check"
          onPress={save}
          disabled={!!errors.start || !!errors.km}
          busy={saving}
        />
      }
    >
      <PageHeading eyebrow={heading.eyebrow} line1={heading.line1} line2={heading.line2} />

      {warnText ? (
        <View style={{ marginBottom: 16 }}>
          <Banner tone="warn" icon="alert-triangle">{warnText}</Banner>
        </View>
      ) : null}

      <SectionLabel>SUBJECT</SectionLabel>
      <SubjectPicker
        options={ctx.options}
        value={subjectId}
        onChange={changeSubject}
        fallbackName={ctx.fallbackSubject?.name ?? null}
      />
      <FieldError message={visibleErrors.subject} />

      {!noShow ? (
      <View style={{ flexDirection: 'row', gap: 16, marginTop: 24 }}>
        <View style={{ flex: 3 }}>
          <SectionLabel>DATE</SectionLabel>
          <DateTimeField
            mode="date"
            value={start}
            onChange={setStart}
            display={formatDateLong(start)}
            accessibilityLabel="Lesson date"
            maximumDate={new Date()}
            invalid={!!visibleErrors.start}
          />
        </View>
        <View style={{ flex: 2 }}>
          <SectionLabel>START</SectionLabel>
          <DateTimeField
            mode="time"
            value={start}
            onChange={setStart}
            display={formatTime(start)}
            accessibilityLabel="Start time"
            invalid={!!visibleErrors.start}
          />
        </View>
      </View>
      ) : null}
      <FieldError message={visibleErrors.start} />
      {ctx.movedFromBooking && session?.scheduled_for ? (
        <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkSoft, marginTop: 6 }}>
          {`Booked for ${formatTime(session.scheduled_for)} — set to just taught. Adjust if needed.`}
        </Text>
      ) : null}

      <View style={{ marginTop: 24 }}>
        <SectionLabel>BILLED</SectionLabel>
        <BilledMinutesField
          value={billed}
          onChange={setBilled}
          step={step}
          presets={!isEdit}
          caption={
            session?.estimated_duration_minutes && !isEdit
              ? `booked ${formatMinutes(session.estimated_duration_minutes)}`
              : isEdit && session?.duration_minutes
                ? `taught ${formatMinutes(Math.round(session.duration_minutes))}`
                : undefined
          }
        />
      </View>

      {noShow && session?.mode === 'in_person' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: MIN_TOUCH, marginTop: 20 }}>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.ink }}>Include travel</Text>
            <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft, marginTop: 2 }}>
              Charge the parent travel and claim your travel for this lesson.
            </Text>
          </View>
          <Switch
            value={noShowTravel}
            onValueChange={setNoShowTravel}
            trackColor={{ false: COLORS.paperEdge, true: COLORS.oxblood }}
            thumbColor={COLORS.paper}
            accessibilityLabel="Include travel"
          />
        </View>
      ) : null}

      {!noShow ? (
      <View style={{ marginTop: 24 }}>
        <SectionLabel>MODE</SectionLabel>
        <ChoicePills
          options={[{ value: 'in_person', label: 'In-person' }, { value: 'online', label: 'Online' }]}
          value={mode}
          onChange={changeMode}
          icons={{ in_person: 'map-pin', online: 'monitor' }}
        />
      </View>

      ) : null}

      {mode === 'in_person' && !noShow ? (
        <View style={{ marginTop: 20 }}>
          <SectionLabel>TRAVEL</SectionLabel>
          <TravelKmField text={km} onChangeText={setKm} error={visibleErrors.km} defaultKm={student.travel_distance_km} />
        </View>
      ) : null}

      <View style={{ marginTop: 20 }}>
        <LessonPreview balanceText={balance.text} owes={balance.owes} travelText={travel?.text ?? null} />
      </View>

      {balance.owes ? (
        <View style={{ marginTop: 12 }}>
          <Banner tone="warn" icon="alert-triangle">
            {`${firstName} will owe ${formatHours(-balance.after)} on ${subjectName} after this lesson.`}
          </Banner>
        </View>
      ) : null}

      {!noShow ? (
        <View style={{ marginTop: 24 }}>
          <SectionLabel>TOPICS</SectionLabel>
          {topicsNote ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{ fontFamily: F.serifItalic, fontSize: 13, color: COLORS.inkSoft, marginBottom: 8 }}
            >
              {topicsNote}
            </Text>
          ) : null}
          <TopicsField topics={topics} selected={selectedTopics} onToggle={toggleTopic} onAdd={addTopic} />
        </View>
      ) : null}

      <View style={{ marginTop: 24 }}>
        <SectionLabel>NOTES (OPTIONAL)</SectionLabel>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder="What did you cover? Any homework?"
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
