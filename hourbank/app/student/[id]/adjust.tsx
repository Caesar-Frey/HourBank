import React, { useEffect, useRef, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { F } from '../../../src/theme/fonts';
import { COLORS } from '../../../src/theme/colors';
import { FormScreen } from '../../../src/components/FormScreen';
import { ScreenHeader } from '../../../src/components/ScreenHeader';
import { useToast } from '../../../src/components/Toast';
import { createAdjustment, getStudent } from '../../../src/db/students';
import { getPrimarySubjectId, getSubjectBalances, isSubjectError, SubjectBalance } from '../../../src/db/subjects';
import { Student } from '../../../src/db/schema';
import {
  Banner, Button, ChoicePills, FieldError, FieldHint, LoadingState, NotFoundState, PageHeading, SectionLabel,
} from '../../../src/components/student/ui';
import { AdjustDirection, adjustmentPreview, formatBalance } from '../../../src/components/student/flowLogic';

const INPUT = {
  fontFamily: F.mono,
  fontSize: 18,
  color: COLORS.ink,
  borderBottomWidth: 1,
  borderBottomColor: COLORS.paperEdge,
  paddingVertical: 10,
} as const;

export default function AdjustBalanceScreen() {
  const { id, subjectId: subjectParam } = useLocalSearchParams<{ id: string; subjectId?: string }>();
  const router = useRouter();
  const toast = useToast();
  const savingRef = useRef(false);

  const [student, setStudent] = useState<Student | null>(null);
  /** Active subjects (+ archived with a balance) — each has its own balance. */
  const [subjects, setSubjects] = useState<SubjectBalance[]>([]);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [direction, setDirection] = useState<AdjustDirection>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try {
      const s = getStudent(id);
      setStudent(s);
      if (s) {
        const list = getSubjectBalances(id);
        setSubjects(list);
        const fromParam = subjectParam && list.some(x => x.id === subjectParam) ? subjectParam : null;
        setSubjectId(fromParam ?? getPrimarySubjectId(id) ?? list[0]?.id ?? null);
      }
    } catch {
      setStudent(null);
    } finally {
      setLoaded(true);
    }
  }, [id, subjectParam]);

  if (!loaded) return <LoadingState />;
  if (!student) return <NotFoundState title="Student not found" onBack={() => router.back()} />;

  const selected = subjects.find(x => x.id === subjectId) ?? null;
  const balance = selected?.balance_hours ?? 0;
  const multiSubject = subjects.length > 1;
  const preview = adjustmentPreview(direction, amount, balance);
  const reasonError = submitted && reason.trim() === '' ? 'Say why — this note is shown on the ledger.' : null;
  const amountError = preview.error ?? (submitted && preview.hoursDelta === null ? 'Enter how many hours.' : null);
  const canSave = preview.hoursDelta !== null && reason.trim() !== '' && !saving;
  const firstName = student.full_name.trim().split(/\s+/)[0];

  function save() {
    if (savingRef.current || preview.hoursDelta === null || reason.trim() === '') return;
    savingRef.current = true;
    setSaving(true);
    try {
      createAdjustment({ studentId: id, hoursDelta: preview.hoursDelta, reason: reason.trim(), subjectId });
      const now = formatBalance(preview.balanceAfter ?? balance);
      const message = multiSubject && selected
        ? `${selected.subject} balance corrected · now ${now}`
        : `Balance corrected · now ${now}`;
      toast.show({ kind: 'success', message });
      router.back();
    } catch (e) {
      savingRef.current = false;
      setSaving(false);
      toast.show({
        kind: 'error',
        message: isSubjectError(e) ? "That subject isn't available — pick another" : "Couldn't save the correction — please try again",
      });
    }
  }

  function handleConfirm() {
    setSubmitted(true);
    if (!canSave || preview.hoursDelta === null) return;
    Alert.alert(
      `${direction === 'add' ? 'Add' : 'Remove'} ${preview.deltaLabel.replace(/^[+−]/, '')}?`,
      `${multiSubject && selected ? `${selected.subject}: ` : ''}${preview.reviewLine}\n\nReason: ${reason.trim()}\n\nThis adds a permanent line to ${firstName}'s ledger.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save correction', onPress: save },
      ],
    );
  }

  return (
    <FormScreen
      edges={['top', 'bottom']}
      header={<ScreenHeader backLabel={firstName.toUpperCase()} onBack={() => router.back()} />}
      footer={
        <Button
          label={preview.hoursDelta !== null ? `Save correction · ${preview.deltaLabel}` : 'Save correction'}
          onPress={handleConfirm}
          disabled={saving}
          busy={saving}
        />
      }
    >
      <PageHeading eyebrow="★ CORRECT BALANCE" line1="Fix the" line2="balance." />

      <Banner tone="info" icon="info">
        Corrections are permanent. They are added to the ledger as a new line with your reason — nothing is edited
        or deleted. Use this for mistakes; use Top up for payments.
      </Banner>

      {multiSubject ? (
        <View style={{ marginTop: 20 }}>
          <SectionLabel>SUBJECT</SectionLabel>
          <ChoicePills
            options={subjects.map(x => ({ value: x.id, label: x.status === 'archived' ? `${x.subject} (archived)` : x.subject }))}
            value={subjectId}
            onChange={setSubjectId}
          />
        </View>
      ) : null}

      <View style={{ marginTop: 20 }}>
        <SectionLabel>{multiSubject && selected ? `${selected.subject.toUpperCase()} BALANCE` : 'CURRENT BALANCE'}</SectionLabel>
        <Text style={{ fontFamily: F.monoMed, fontSize: 20, color: COLORS.ink }}>{formatBalance(balance)}</Text>
      </View>

      <View style={{ marginTop: 20 }}>
        <SectionLabel>DIRECTION</SectionLabel>
        <ChoicePills
          options={[{ value: 'add', label: 'Add hours' }, { value: 'remove', label: 'Remove hours' }]}
          value={direction}
          onChange={setDirection}
          icons={{ add: 'plus', remove: 'minus' }}
        />
      </View>

      <View style={{ marginTop: 20 }}>
        <SectionLabel>HOURS</SectionLabel>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          placeholder="e.g. 1,5"
          placeholderTextColor={COLORS.inkFaint}
          keyboardType="decimal-pad"
          accessibilityLabel="Hours to adjust"
          style={{ ...INPUT, borderBottomColor: amountError ? COLORS.crimson : COLORS.paperEdge }}
        />
        {amountError ? <FieldError message={amountError} /> : preview.deltaLabel ? (
          <FieldHint tone={direction === 'add' ? 'good' : 'soft'}>{preview.deltaLabel}</FieldHint>
        ) : (
          <FieldHint>Decimal hours: 1,5 = 1h 30m</FieldHint>
        )}
      </View>

      <View style={{ marginTop: 20 }}>
        <SectionLabel>REASON (REQUIRED)</SectionLabel>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="e.g. Lesson logged twice on 3 Oct"
          placeholderTextColor={COLORS.inkFaint}
          multiline
          maxLength={200}
          accessibilityLabel="Reason for the correction"
          style={{
            fontFamily: F.sans,
            fontSize: 15,
            color: COLORS.ink,
            borderBottomWidth: 1,
            borderBottomColor: reasonError ? COLORS.crimson : COLORS.paperEdge,
            paddingVertical: 10,
            minHeight: 64,
            textAlignVertical: 'top',
          }}
        />
        <FieldError message={reasonError} />
      </View>

      {preview.reviewLine ? (
        <View style={{ marginTop: 24, borderTopWidth: 1, borderTopColor: COLORS.ink, paddingTop: 12 }}>
          <SectionLabel>REVIEW</SectionLabel>
          <Text style={{ fontFamily: F.monoMed, fontSize: 16, color: COLORS.ink }}>{preview.reviewLine}</Text>
        </View>
      ) : null}
    </FormScreen>
  );
}
