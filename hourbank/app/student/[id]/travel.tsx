/**
 * Travel — a family's PARENT travel account (rand, billed in arrears):
 * owed total, unpaid in-person lessons, record a travel payment on its own
 * (partial allowed), and the history of travel payments.
 */
import React, { useCallback, useRef, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { F, MIN_TOUCH } from '../../../src/theme/fonts';
import { COLORS } from '../../../src/theme/colors';
import { FormScreen } from '../../../src/components/FormScreen';
import { ScreenHeader } from '../../../src/components/ScreenHeader';
import { useToast } from '../../../src/components/Toast';
import { getStudent } from '../../../src/db/students';
import { getTravelOwed, isTravelError, listTravelSettlements, settleTravel, TravelOwed } from '../../../src/db/travel';
import type { CreditPackage, Student, TravelSettlement } from '../../../src/db/schema';
import { formatLedgerDate, formatRand } from '../../../src/utils/format';
import { getTravelPaymentText } from '../../../src/utils/receipt';
import { openWhatsApp } from '../../../src/utils/whatsapp';
import { resolveRecipient } from '../../../src/utils/recipient';
import {
  kmLabel, travelAmountInput, travelOwedSummary, validateTravelPayment,
} from '../../../src/utils/travelBilling';
import {
  Button, ChoicePills, FieldHint, LoadingState, NotFoundState, PageHeading, SectionLabel,
} from '../../../src/components/student/ui';

type PaymentMethod = CreditPackage['payment_method'];

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'eft', label: 'EFT' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
];

const METHOD_LABEL: Record<string, string> = { eft: 'EFT', cash: 'Cash', card: 'Card', other: 'Other' };

const INPUT = {
  fontFamily: F.mono,
  fontSize: 17,
  color: COLORS.ink,
  borderBottomWidth: 1,
  borderBottomColor: COLORS.paperEdge,
  paddingVertical: 10,
} as const;

const ROW = {
  borderBottomWidth: 1,
  borderBottomColor: COLORS.paperEdge,
  paddingVertical: 12,
  minHeight: MIN_TOUCH,
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 12,
};

function DateCol({ iso }: { iso: string }) {
  const { day, month } = formatLedgerDate(iso);
  return (
    <View style={{ alignItems: 'center', minWidth: 32 }}>
      <Text style={{ fontFamily: F.mono, fontSize: 16, color: COLORS.ink, lineHeight: 18 }}>{day}</Text>
      <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint }}>{month}</Text>
    </View>
  );
}

export default function TravelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const savingRef = useRef(false);
  const navigating = useRef(false);

  const [student, setStudent] = useState<Student | null>(null);
  const [owed, setOwed] = useState<TravelOwed | null>(null);
  const [history, setHistory] = useState<TravelSettlement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('eft');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    navigating.current = false;
    try {
      const s = getStudent(id);
      setStudent(s);
      if (s) {
        const o = getTravelOwed(id);
        setOwed(o);
        setHistory(listTravelSettlements(id));
        setAmountInput(travelAmountInput(o.amount));
      }
    } catch {
      setStudent(null);
    } finally {
      setLoaded(true);
    }
  }, [id]);

  useFocusEffect(load);

  if (!loaded) return <LoadingState />;
  if (!student || !owed) return <NotFoundState title="Student not found" onBack={() => router.back()} />;

  const firstName = student.full_name.trim().split(/\s+/)[0];
  const check = validateTravelPayment(amountInput, owed.amount);
  const canPay = owed.amount > 0;
  const ready = canPay && check.value !== null;

  function go(href: string) {
    if (navigating.current) return;
    navigating.current = true;
    router.push(href as Href);
  }

  async function sendConfirmation(settlementId: string) {
    if (!student) return;
    try {
      const recipient = resolveRecipient(student, null);
      const text = getTravelPaymentText(settlementId, { recipientName: recipient.name, audience: recipient.who });
      if (!text) throw new Error('missing');
      await openWhatsApp(recipient.phone, text);
    } catch {
      toast.show({ kind: 'error', message: "Couldn't prepare the confirmation" });
    }
  }

  function handleRecord() {
    if (savingRef.current || !ready || check.value === null) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const st = settleTravel({ studentId: id, amount: check.value, method, note: note.trim() || null });
      const left = getTravelOwed(id).amount;
      toast.show({
        kind: 'success',
        message: left > 0
          ? `Travel ${formatRand(st.amount)} recorded · ${formatRand(left)} still owed`
          : `Travel ${formatRand(st.amount)} recorded · all paid up`,
        actionLabel: 'Send confirmation',
        onAction: () => { void sendConfirmation(st.id); },
        durationMs: 8000,
      });
      setNote('');
      load();
    } catch (e) {
      toast.show({
        kind: 'error',
        message: isTravelError(e, 'EXCEEDS_OWED')
          ? 'That is more than the travel owed — check the amount'
          : "Couldn't record the travel payment — please try again",
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const summary = travelOwedSummary(owed);

  return (
    <FormScreen
      header={<ScreenHeader backLabel={firstName.toUpperCase()} onBack={() => router.back()} />}
      footer={canPay ? (
        <Button
          label={check.value !== null ? `Record travel payment · ${formatRand(check.value)}` : 'Record travel payment'}
          onPress={handleRecord}
          disabled={!ready}
          busy={saving}
          testID="travel-record"
        />
      ) : undefined}
    >
      <PageHeading eyebrow="★ TRAVEL" line1="Travel" line2="owed" />

      <Text style={{ fontFamily: F.mono, fontSize: 32, color: canPay ? COLORS.amber : COLORS.ink }} testID="travel-owed-amount">
        {formatRand(owed.amount)}
      </Text>
      <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkSoft, marginTop: 4 }}>
        {canPay ? summary : 'All paid up'}
      </Text>
      {owed.credit > 0 ? (
        <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.moss, marginTop: 4 }}>
          {`In credit ${formatRand(owed.credit)} (paid more than charged)`}
        </Text>
      ) : null}
      <FieldHint>
        Charged per in-person lesson at the family’s travel rate when the lesson was recorded. Usually settled with a top-up.
      </FieldHint>

      {owed.lessons.length > 0 ? (
        <View style={{ marginTop: 24 }}>
          <SectionLabel>UNPAID LESSONS</SectionLabel>
          {owed.lessons.map(l => {
            const km = kmLabel('in_person', l.travel_km);
            const partial = l.unpaid < l.parent_travel_fee;
            return (
              <TouchableOpacity
                key={l.session_id}
                onPress={() => go(`/lesson/${l.session_id}`)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Lesson ${l.subject_name ?? ''} travel ${formatRand(l.unpaid)}`}
                style={ROW}
              >
                <DateCol iso={l.date} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.ink }} numberOfLines={1}>
                    {l.subject_name ?? 'Lesson'}
                  </Text>
                  <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkSoft, marginTop: 2 }}>
                    {[km, partial ? `part paid · ${formatRand(l.parent_travel_fee)} charged` : null].filter(Boolean).join(' · ') || 'Flat fee'}
                  </Text>
                </View>
                <Text style={{ fontFamily: F.monoMed, fontSize: 14, color: COLORS.ink }}>{formatRand(l.unpaid)}</Text>
                <Feather name="chevron-right" size={14} color={COLORS.inkFaint} />
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {canPay ? (
        <View style={{ marginTop: 24 }}>
          <SectionLabel>RECORD TRAVEL PAYMENT</SectionLabel>
          <TextInput
            value={amountInput}
            onChangeText={setAmountInput}
            placeholder={travelAmountInput(owed.amount)}
            placeholderTextColor={COLORS.inkFaint}
            keyboardType="decimal-pad"
            accessibilityLabel="Travel amount paid in rand"
            testID="travel-amount"
            style={{ ...INPUT, borderBottomColor: check.error ? COLORS.crimson : COLORS.paperEdge }}
          />
          {check.error ? (
            <FieldHint tone="bad">{check.error}</FieldHint>
          ) : check.value !== null && check.value < owed.amount ? (
            <FieldHint>{`Part payment · ${formatRand(owed.amount - check.value)} will still be owed`}</FieldHint>
          ) : null}

          <SectionLabel style={{ marginTop: 16 }}>PAYMENT METHOD</SectionLabel>
          <ChoicePills options={PAYMENT_METHODS} value={method} onChange={setMethod} />

          <SectionLabel style={{ marginTop: 16 }}>NOTE (OPTIONAL)</SectionLabel>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Paid with cash at lesson"
            placeholderTextColor={COLORS.inkFaint}
            accessibilityLabel="Note"
            style={{ ...INPUT, fontFamily: F.sans, fontSize: 15 }}
          />
        </View>
      ) : null}

      <View style={{ marginTop: 28 }}>
        <SectionLabel>TRAVEL PAYMENTS</SectionLabel>
        {history.length === 0 ? (
          <Text style={{ fontFamily: F.serifItalic, fontSize: 14, color: COLORS.inkFaint, marginTop: 4 }}>
            No travel payments yet.
          </Text>
        ) : (
          history.map(t => (
            <TouchableOpacity
              key={t.id}
              onPress={() => go(`/transaction/${t.id}`)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Travel payment ${formatRand(t.amount)}`}
              style={ROW}
            >
              <DateCol iso={t.created_at} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.ink }}>
                  {t.package_id ? 'With top-up' : 'Travel payment'}
                </Text>
                <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkSoft, marginTop: 2 }} numberOfLines={1}>
                  {[METHOD_LABEL[t.payment_method] ?? t.payment_method, t.note].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Text style={{ fontFamily: F.monoMed, fontSize: 14, color: COLORS.moss }}>{formatRand(t.amount)}</Text>
              <Feather name="chevron-right" size={14} color={COLORS.inkFaint} />
            </TouchableOpacity>
          ))
        )}
      </View>
    </FormScreen>
  );
}
