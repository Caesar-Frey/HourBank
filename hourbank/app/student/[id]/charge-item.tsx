/**
 * Charge an item to credit (M7, F1). Something the tutor sold (a study pack,
 * past papers) is paid for out of the student's prepaid credit. It is its own
 * line in the history and never counts as a lesson.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { F, MIN_TOUCH } from '../../../src/theme/fonts';
import { COLORS } from '../../../src/theme/colors';
import { FormScreen } from '../../../src/components/FormScreen';
import { ScreenHeader } from '../../../src/components/ScreenHeader';
import { useToast } from '../../../src/components/Toast';
import { Mixed } from '../../../src/components/Num';
import { getStudent } from '../../../src/db/students';
import { getPrimarySubjectId, getSubjectBalances, SubjectBalance } from '../../../src/db/subjects';
import { getOrCreateTutorProfile } from '../../../src/db/tutorProfile';
import { chargeItem, getSaleItems, isItemError, SaleItem, suggestItemHours } from '../../../src/db/items';
import type { Student } from '../../../src/db/schema';
import { balanceColour, balanceStatus, normaliseHours } from '../../../src/utils/balance';
import { formatDateLong, formatHours, formatRand, parseDecimal } from '../../../src/utils/format';
import { billingRoundMinutes } from '../../../src/components/lesson/lessonFormData';
import { DateTimeField } from '../../../src/components/student/DateTimeField';
import {
  Button, ChoicePills, FieldError, LoadingState, NotFoundState, PageHeading, SectionLabel, Stepper,
} from '../../../src/components/student/ui';
import { formatBalance, paidAtIso } from '../../../src/components/student/flowLogic';

const INPUT = {
  minHeight: 48,
  borderWidth: 1,
  borderColor: COLORS.paperEdge,
  borderRadius: 10,
  backgroundColor: COLORS.cardFill,
  paddingHorizontal: 14,
  fontSize: 16,
  color: COLORS.ink,
} as const;

export default function ChargeItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const savingRef = useRef(false);

  const [student, setStudent] = useState<Student | null>(null);
  const [subjects, setSubjects] = useState<SubjectBalance[]>([]);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [saved, setSaved] = useState<SaleItem[]>([]);
  const [rate, setRate] = useState(0);
  const [step, setStep] = useState(30);
  const [loaded, setLoaded] = useState(false);

  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [minutes, setMinutes] = useState(60);
  /** True once the tutor moved the stepper: a price no longer overrides it. */
  const [hoursTouched, setHoursTouched] = useState(false);
  const [date, setDate] = useState(new Date());
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try {
      const s = getStudent(id);
      setStudent(s);
      if (s) {
        const list = getSubjectBalances(id).filter(x => x.status !== 'archived');
        setSubjects(list);
        setSubjectId(getPrimarySubjectId(id) ?? list[0]?.id ?? null);
      }
      const p = getOrCreateTutorProfile();
      setRate(p.parent_hourly_price ?? 0);
      const st = billingRoundMinutes();
      setStep(st);
      setMinutes(Math.max(st, 60));
      setSaved(getSaleItems());
    } catch {
      setStudent(null);
    } finally {
      setLoaded(true);
    }
  }, [id]);

  if (!loaded) return <LoadingState />;
  if (!student) return <NotFoundState title="Student not found" onBack={() => router.back()} />;

  const firstName = student.full_name.trim().split(/\s+/)[0];
  const selected = subjects.find(x => x.id === subjectId) ?? null;
  const multiSubject = subjects.length > 1;
  const balance = normaliseHours(selected?.balance_hours ?? 0);
  const hours = minutes / 60;
  const after = normaliseHours(balance - hours);
  const priceValue = price.trim() ? parseDecimal(price) : null;
  const priceError = price.trim() && (priceValue === null || priceValue < 0) ? 'Enter a price like 450 or 450.00.' : null;
  const suggested = suggestItemHours(priceValue, rate, step);
  const nameError = submitted && !name.trim() ? 'Say what you sold.' : null;

  function onPriceChange(text: string) {
    setPrice(text);
    if (hoursTouched) return;
    const p = text.trim() ? parseDecimal(text) : null;
    const s = suggestItemHours(p, rate, step);
    if (s) setMinutes(Math.round(s * 60));
  }

  function pickSaved(item: SaleItem) {
    setName(item.name);
    setPrice(item.price ? String(item.price) : '');
    const fromPrice = suggestItemHours(item.price, rate, step);
    const h = item.hours ?? fromPrice;
    if (h) setMinutes(Math.max(step, Math.round((h * 60) / step) * step));
    setHoursTouched(item.hours != null);
  }

  function bump(dir: 1 | -1) {
    setHoursTouched(true);
    setMinutes(m => Math.max(step, m + dir * step));
  }

  function save(allowOverOwe = false) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      chargeItem({
        studentId: id,
        subjectId,
        itemName: name,
        hours,
        priceRand: priceValue,
        chargedAt: paidAtIso(date),
        allowOverOwe,
      });
      toast.show({ kind: 'success', message: `${name.trim()} charged · ${formatHours(hours)} from credit` });
      router.back();
    } catch (e) {
      savingRef.current = false;
      setSaving(false);
      if (isItemError(e) && e.code === 'OVER_OWE_LIMIT') {
        Alert.alert(
          'Past the owing limit',
          `This leaves ${firstName} owing ${formatHours(-after)}, more than you allow. Charge anyway?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Charge anyway', onPress: () => save(true) },
          ],
        );
        return;
      }
      toast.show({ kind: 'error', message: "Couldn't charge the item, please try again" });
    }
  }

  function onSubmit() {
    setSubmitted(true);
    if (!name.trim() || priceError) return;
    save(false);
  }

  return (
    <FormScreen
      edges={['top', 'bottom']}
      header={<ScreenHeader backLabel={firstName.toUpperCase()} onBack={() => router.back()} />}
      footer={
        <Button
          label={`Charge ${formatHours(hours)} to credit`}
          onPress={onSubmit}
          disabled={saving}
          busy={saving}
          testID="charge-item-save"
        />
      }
    >
      <PageHeading eyebrow="CHARGE AN ITEM" line1="What did" line2="you sell?" />
      <Text style={{ fontFamily: F.sans, fontSize: 14, lineHeight: 20, color: COLORS.inkSoft, marginTop: -16, marginBottom: 20 }}>
        {`Paid for out of ${firstName}'s credit, not a lesson.`}
      </Text>

      {multiSubject ? (
        <View style={{ marginBottom: 20 }}>
          <SectionLabel>SUBJECT</SectionLabel>
          <ChoicePills options={subjects.map(x => ({ value: x.id, label: x.subject }))} value={subjectId} onChange={setSubjectId} />
        </View>
      ) : null}

      <View style={{ marginBottom: 20, gap: 8 }}>
        <SectionLabel>ITEM</SectionLabel>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Exam study pack"
          placeholderTextColor={COLORS.inkFaint}
          accessibilityLabel="Item"
          maxLength={80}
          style={{ ...INPUT, fontFamily: F.sans, borderColor: nameError ? COLORS.crimson : COLORS.paperEdge }}
          testID="charge-item-name"
        />
        <FieldError message={nameError} />
        {saved.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {saved.map(item => (
              <TouchableOpacity
                key={item.id}
                onPress={() => pickSaved(item)}
                accessibilityRole="button"
                accessibilityLabel={`Use ${item.name}`}
                activeOpacity={0.7}
                style={{
                  minHeight: MIN_TOUCH, paddingHorizontal: 14, borderRadius: 22, justifyContent: 'center',
                  borderWidth: 1, borderColor: name.trim() === item.name ? COLORS.ink : COLORS.paperEdge,
                }}
              >
                <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.ink }}>{item.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>

      <View style={{ marginBottom: 20, gap: 8 }}>
        <SectionLabel>PRICE · OPTIONAL</SectionLabel>
        <TextInput
          value={price}
          onChangeText={onPriceChange}
          placeholder="R 0.00"
          placeholderTextColor={COLORS.inkFaint}
          keyboardType="decimal-pad"
          accessibilityLabel="Price, optional"
          style={{ ...INPUT, fontFamily: F.mono }}
        />
        <FieldError message={priceError} />
      </View>

      <View
        style={{
          borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 14, backgroundColor: COLORS.cardFill,
          paddingHorizontal: 16, paddingVertical: 14, gap: 10, marginBottom: 20,
        }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <SectionLabel style={{ marginBottom: 0 }}>TAKE FROM CREDIT</SectionLabel>
          <Stepper
            value={formatHours(hours)}
            onDecrement={() => bump(-1)}
            onIncrement={() => bump(1)}
            canDecrement={minutes > step}
            accessibilityLabel="credit to take"
          />
        </View>
        {suggested && priceValue ? (
          <Text style={{ fontFamily: F.sans, fontSize: 13, lineHeight: 18, color: COLORS.inkSoft }}>
            <Mixed text={`${formatRand(priceValue)} is about ${formatHours(suggested)} at your rate of ${formatRand(rate)}/h. Change it if you agreed otherwise.`} />
          </Text>
        ) : null}
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: COLORS.paperEdge, paddingTop: 10 }}
        >
          <SectionLabel style={{ marginBottom: 0 }}>
            {multiSubject && selected ? `${selected.subject.toUpperCase()} CREDIT` : 'CREDIT'}
          </SectionLabel>
          <Text
            style={{ fontFamily: F.monoMed, fontSize: 16 }}
            accessibilityLabel={`Credit now ${formatBalance(balance)}, after ${formatBalance(after)}`}
          >
            <Text style={{ color: balanceColour(balanceStatus(balance)) }}>{formatBalance(balance)}</Text>
            <Text style={{ color: COLORS.inkSoft }}>{' → '}</Text>
            <Text style={{ color: balanceColour(balanceStatus(after)) }}>{formatBalance(after)}</Text>
          </Text>
        </View>
      </View>

      <View style={{ marginBottom: 8 }}>
        <SectionLabel>DATE</SectionLabel>
        <DateTimeField
          mode="date"
          value={date}
          onChange={setDate}
          display={formatDateLong(date)}
          accessibilityLabel="Date sold"
          maximumDate={new Date()}
        />
      </View>
    </FormScreen>
  );
}
