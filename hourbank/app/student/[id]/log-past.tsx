import React, { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useNavigationContainerRef, useRouter } from 'expo-router';
import { CommonActions } from '@react-navigation/native';
import { applyLessonSavedNav, lessonSavedNav } from '../../../src/utils/lessonNav';
import { F } from '../../../src/theme/fonts';
import { COLORS } from '../../../src/theme/colors';
import { FormScreen } from '../../../src/components/FormScreen';
import { ScreenHeader } from '../../../src/components/ScreenHeader';
import { TopicChip } from '../../../src/components/TopicChip';
import { useToast } from '../../../src/components/Toast';
import { getStudent } from '../../../src/db/students';
import { currentBalance } from '../../../src/db/ledger';
import { getSession, isSessionError, logPastSession, DEFAULT_LESSON_MINUTES } from '../../../src/db/sessions';
import { getOrCreateTutorProfile } from '../../../src/db/tutorProfile';
import { listTopicsForStudentSubject } from '../../../src/db/catalog';
import { Session, Student } from '../../../src/db/schema';
import { defaultBilledMinutes } from '../../../src/utils/duration';
import { formatDateLong, formatMinutes, formatTime } from '../../../src/utils/format';
import { DateTimeField } from '../../../src/components/student/DateTimeField';
import {
  Banner, Button, ChoicePills, FieldError, LoadingState, NotFoundState, PageHeading, SectionLabel, Stepper,
} from '../../../src/components/student/ui';
import {
  balanceReviewLine, defaultPastStart, formatBalance, MAX_LESSON_MINUTES, MIN_LESSON_MINUTES, stepMinutes, validatePastStart,
} from '../../../src/components/student/flowLogic';

type Mode = Session['mode'];

function parseTopics(json: string | null | undefined): string[] {
  try {
    const t = JSON.parse(json ?? '[]');
    return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export default function LogPastLessonScreen() {
  const { id, sessionId, startedAt, from } = useLocalSearchParams<{ id: string; sessionId?: string; startedAt?: string; from?: string }>();
  const router = useRouter();
  const navRef = useNavigationContainerRef();
  const toast = useToast();
  const savingRef = useRef(false);

  const [student, setStudent] = useState<Student | null>(null);
  const [booked, setBooked] = useState<Session | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [balance, setBalance] = useState(0);
  const [roundTo, setRoundTo] = useState(15);

  const [start, setStart] = useState<Date>(() => defaultPastStart(new Date(), DEFAULT_LESSON_MINUTES));
  const [minutes, setMinutes] = useState(DEFAULT_LESSON_MINUTES);
  const [billed, setBilled] = useState(DEFAULT_LESSON_MINUTES);
  const [billedTouched, setBilledTouched] = useState(false);
  const [mode, setMode] = useState<Mode>('in_person');
  const [topics, setTopics] = useState<string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [startError, setStartError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try {
      const s = getStudent(id);
      setStudent(s);
      if (!s) return;
      setBalance(currentBalance(id));
      try {
        const p = getOrCreateTutorProfile();
        if (p.billing_round_minutes > 0) setRoundTo(p.billing_round_minutes);
      } catch { /* default 15 */ }
      const catalogTopics = listTopicsForStudentSubject(s.subject).map(t => t.name);

      let initialMinutes = DEFAULT_LESSON_MINUTES;
      let initialStart: Date | null = null;
      let preselected: string[] = [];
      if (sessionId) {
        const sess = getSession(sessionId);
        if (!sess || sess.student_id !== id) {
          setLoadError('That lesson could not be found.');
        } else if (sess.status !== 'scheduled') {
          setLoadError('That lesson has already been logged or cancelled.');
        } else {
          setBooked(sess);
          initialMinutes = sess.estimated_duration_minutes ?? DEFAULT_LESSON_MINUTES;
          if (sess.scheduled_for) initialStart = new Date(sess.scheduled_for);
          setMode(sess.mode);
          preselected = parseTopics(sess.topics);
          if (sess.session_notes) setNotes(sess.session_notes);
        }
      }
      // An explicit start (e.g. "Log as past lesson" from the schedule screen)
      // wins over the booked time.
      if (startedAt) {
        const d = new Date(startedAt);
        if (!Number.isNaN(d.getTime())) initialStart = d;
      }
      setMinutes(initialMinutes);
      setBilled(initialMinutes);
      setStart(initialStart ?? defaultPastStart(new Date(), initialMinutes));
      setSelectedTopics(preselected);
      setTopics([...catalogTopics, ...preselected.filter(t => !catalogTopics.includes(t))]);
    } catch {
      setLoadError("Couldn't load this student.");
    } finally {
      setLoaded(true);
    }
  }, [id, sessionId, startedAt]);

  if (!loaded) return <LoadingState />;
  if (!student) return <NotFoundState title="Student not found" onBack={() => router.back()} />;
  if (loadError) return <NotFoundState title={loadError} onBack={() => router.back()} />;

  const firstName = student.full_name.trim().split(/\s+/)[0];
  const bookedMinutes = booked?.estimated_duration_minutes ?? null;
  const balanceAfter = balance - billed / 60;
  const liveStartError = startError ?? null;

  function changeMinutes(dir: 1 | -1) {
    const next = stepMinutes(minutes, dir);
    setMinutes(next);
    if (!billedTouched) setBilled(defaultBilledMinutes(next, bookedMinutes, roundTo));
  }

  function changeBilled(dir: 1 | -1) {
    setBilledTouched(true);
    setBilled(b => stepMinutes(b, dir));
  }

  function changeStart(next: Date) {
    setStart(next);
    setStartError(validatePastStart(next));
  }

  function toggleTopic(t: string) {
    setSelectedTopics(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]));
  }

  function save() {
    if (savingRef.current) return;
    const err = validatePastStart(start);
    setStartError(err);
    if (err) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const { session } = logPastSession({
        studentId: id,
        startedAt: start.toISOString(),
        minutes,
        billedMinutes: billed,
        topics: selectedTopics,
        notes: notes.trim() || undefined,
        sessionId: booked?.id,
        mode,
      });
      toast.show({ kind: 'success', message: `Lesson logged · ${formatMinutes(billed)} · balance ${formatBalance(balanceAfter)}` });
      // Opened from that lesson's own detail screen: go back to it (it reloads on
      // focus) instead of stacking a second copy of the same lesson.
      if (from === 'lesson' && booked && router.canGoBack()) router.back();
      // From the student page → [..., student, summary] so Back returns there.
      else {
        applyLessonSavedNav(
          router,
          navRef,
          lessonSavedNav({ rootState: navRef.getRootState(), studentId: id, lessonHref: `/lesson/${session.id}` }),
          state => CommonActions.reset(state as never),
        );
      }
    } catch (e) {
      savingRef.current = false;
      setSaving(false);
      const message = isSessionError(e, 'INVALID_STATE')
        ? 'That lesson was already logged or cancelled'
        : isSessionError(e, 'INVALID_INPUT')
          ? e.message
          : "Couldn't log the lesson — please try again";
      toast.show({ kind: 'error', message });
    }
  }

  return (
    <FormScreen
      header={<ScreenHeader backLabel={firstName.toUpperCase()} onBack={() => router.back()} />}
      footer={
        <Button
          label={`Log lesson · ${formatMinutes(billed)}`}
          icon="check"
          onPress={save}
          disabled={!!liveStartError}
          busy={saving}
        />
      }
    >
      <PageHeading
        eyebrow={booked ? '★ LOG AS TAUGHT' : '★ LOG PAST LESSON'}
        line1={booked ? 'Booked lesson,' : 'Already'}
        line2={booked ? 'now taught.' : 'taught?'}
      />

      <View style={{ flexDirection: 'row', gap: 16 }}>
        <View style={{ flex: 3 }}>
          <SectionLabel>DATE</SectionLabel>
          <DateTimeField
            mode="date"
            value={start}
            onChange={changeStart}
            display={formatDateLong(start)}
            accessibilityLabel="Lesson date"
            maximumDate={new Date()}
            invalid={!!liveStartError}
          />
        </View>
        <View style={{ flex: 2 }}>
          <SectionLabel>START</SectionLabel>
          <DateTimeField
            mode="time"
            value={start}
            onChange={changeStart}
            display={formatTime(start)}
            accessibilityLabel="Start time"
            invalid={!!liveStartError}
          />
        </View>
      </View>
      <FieldError message={liveStartError} />

      <View style={{ marginTop: 24 }}>
        <SectionLabel>LENGTH</SectionLabel>
        <Stepper
          value={formatMinutes(minutes)}
          label={bookedMinutes ? `booked ${formatMinutes(bookedMinutes)}` : `ends ${formatTime(new Date(start.getTime() + minutes * 60_000))}`}
          onDecrement={() => changeMinutes(-1)}
          onIncrement={() => changeMinutes(1)}
          canDecrement={minutes > MIN_LESSON_MINUTES}
          canIncrement={minutes < MAX_LESSON_MINUTES}
          accessibilityLabel="lesson length"
        />
      </View>

      <View style={{ marginTop: 24 }}>
        <SectionLabel>BILLED</SectionLabel>
        <Stepper
          value={formatMinutes(billed)}
          label={billedTouched ? 'set by you' : 'default'}
          onDecrement={() => changeBilled(-1)}
          onIncrement={() => changeBilled(1)}
          canDecrement={billed > MIN_LESSON_MINUTES}
          canIncrement={billed < MAX_LESSON_MINUTES}
          accessibilityLabel="billed time"
        />
        <Text style={{ fontFamily: F.mono, fontSize: 12, color: balanceAfter < 0 ? COLORS.crimson : COLORS.inkSoft, marginTop: 10 }}>
          {balanceReviewLine(balance, balanceAfter)}
        </Text>
      </View>

      {balanceAfter < 0 ? (
        <View style={{ marginTop: 12 }}>
          <Banner tone="warn" icon="alert-triangle">
            {`${firstName} will owe ${formatBalance(-balanceAfter)} after this lesson.`}
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

      {topics.length > 0 ? (
        <View style={{ marginTop: 24 }}>
          <SectionLabel>TOPICS</SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {topics.map(t => (
              <TopicChip key={t} label={t} selected={selectedTopics.includes(t)} onPress={() => toggleTopic(t)} />
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ marginTop: 24 }}>
        <SectionLabel>NOTES (OPTIONAL)</SectionLabel>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder="What did you cover?"
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
