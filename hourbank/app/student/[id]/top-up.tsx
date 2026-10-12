import React, { useEffect, useRef, useState } from 'react';
import { Image, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import { F, MIN_TOUCH, hitSlopFor } from '../../../src/theme/fonts';
import { COLORS } from '../../../src/theme/colors';
import { FormScreen } from '../../../src/components/FormScreen';
import { ScreenHeader } from '../../../src/components/ScreenHeader';
import { PackageCard } from '../../../src/components/PackageCard';
import { useToast } from '../../../src/components/Toast';
import { getStudent } from '../../../src/db/students';
import { createPackage } from '../../../src/db/packages';
import { getPrimarySubjectId, getSubjectBalances, isSubjectError, SubjectBalance } from '../../../src/db/subjects';
import { getTravelOwed, listTravelSettlementsForPackage, settleTravel } from '../../../src/db/travel';
import {
  topUpCtaWithTravel, topUpGrandTotal, topUpSuccessMessage, topUpTravelAmount, topUpTravelToggleLabel,
} from '../../../src/utils/travelBilling';
import { newId } from '../../../src/db/uuid';
import { getOrCreateTutorProfile, PackageTier, TutorProfile } from '../../../src/db/tutorProfile';
import { CreditPackage, Student } from '../../../src/db/schema';
import { formatRand } from '../../../src/utils/format';
import { persistProofImage } from '../../../src/utils/proofImages';
import { getTopUpReceiptText } from '../../../src/utils/receipt';
import { openWhatsApp } from '../../../src/utils/whatsapp';
import { resolveRecipient } from '../../../src/utils/recipient';
import { RecipientChooser } from '../../../src/components/student/RecipientChooser';
import type { PreferredContact } from '../../../src/db/schema';
import {
  Button, ChoicePills, FieldHint, LoadingState, NotFoundState, PageHeading, SectionLabel,
} from '../../../src/components/student/ui';
import {
  balanceReviewLine, decimalPreview, formatBalance, tierSavings,
} from '../../../src/components/student/flowLogic';

type PaymentMethod = CreditPackage['payment_method'];
type Selection = number | 'custom' | null;

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'eft', label: 'EFT' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
];

const INPUT = {
  fontFamily: F.mono,
  fontSize: 17,
  color: COLORS.ink,
  borderBottomWidth: 1,
  borderBottomColor: COLORS.paperEdge,
  paddingVertical: 10,
} as const;

function parseTiers(p: TutorProfile): PackageTier[] {
  if (p.tier_system_enabled !== 1) return [];
  try {
    const parsed = JSON.parse(p.package_tiers);
    return Array.isArray(parsed)
      ? (parsed as PackageTier[]).filter(t => t.hours > 0).sort((a, b) => a.sort_order - b.sort_order)
      : [];
  } catch {
    return [];
  }
}

export default function TopUpScreen() {
  const { id, subjectId: subjectParam } = useLocalSearchParams<{ id: string; subjectId?: string }>();
  const router = useRouter();
  const toast = useToast();
  // Generated once per screen visit: makes a double-submitted top-up idempotent.
  const [packageId] = useState(() => newId());
  const savingRef = useRef(false);

  const [student, setStudent] = useState<Student | null>(null);
  const [profile, setProfile] = useState<TutorProfile | null>(null);
  const [tiers, setTiers] = useState<PackageTier[]>([]);
  const [subjects, setSubjects] = useState<SubjectBalance[]>([]);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [travelOwed, setTravelOwed] = useState<{ amount: number; lessonCount: number }>({ amount: 0, lessonCount: 0 });
  const [includeTravel, setIncludeTravel] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const [selection, setSelection] = useState<Selection>(null);
  const [customHours, setCustomHours] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('eft');
  const [reference, setReference] = useState('');
  const [proofUri, setProofUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sendTo, setSendTo] = useState<PreferredContact | null>(null);

  useEffect(() => {
    try {
      const s = getStudent(id);
      setStudent(s);
      if (s) {
        const active = getSubjectBalances(id).filter(b => b.status === 'active');
        setSubjects(active);
        const wanted = typeof subjectParam === 'string' && active.some(b => b.id === subjectParam) ? subjectParam : null;
        setSubjectId(wanted ?? getPrimarySubjectId(id) ?? active[0]?.id ?? null);
        try {
          const o = getTravelOwed(id);
          setTravelOwed({ amount: o.amount, lessonCount: o.lessonCount });
        } catch {
          // travel is optional on this screen
        }
      }
      const p = getOrCreateTutorProfile();
      setProfile(p);
      setTiers(parseTiers(p));
    } catch {
      // student stays null → not-found state; profile optional
    } finally {
      setLoaded(true);
    }
  }, [id, subjectParam]);

  if (!loaded) return <LoadingState />;
  if (!student) return <NotFoundState title="Student not found" onBack={() => router.back()} />;

  const hasTiers = tiers.length > 0;
  const isCustom = !hasTiers || selection === 'custom';
  const hasSelection = !hasTiers || selection !== null;
  const hoursPreview = decimalPreview(customHours, 'hours');
  const amountPreview = decimalPreview(customAmount, 'rand');
  const tier = typeof selection === 'number' ? tiers[selection] : undefined;
  const hours = isCustom ? hoursPreview.value : tier?.hours ?? null;
  const price = isCustom ? amountPreview.value : tier?.price ?? null;
  const ready = hasSelection && hours !== null && hours > 0 && price !== null && price >= 0;
  const parentPrice = profile?.parent_hourly_price ?? null;
  const customSaving = isCustom && hours && price !== null ? tierSavings(hours, price, parentPrice) : null;
  const firstName = student.full_name.trim().split(/\s+/)[0];
  const multiSubject = subjects.length > 1;
  const subject = subjects.find(b => b.id === subjectId) ?? null;
  const balance = subject?.balance_hours ?? 0;
  const subjectName = multiSubject ? subject?.subject ?? null : null;
  const travel = topUpTravelAmount(travelOwed.amount, includeTravel);
  const grandTotal = ready ? topUpGrandTotal(price, travel) : null;

  async function pickProof() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.8 });
      if (!result.canceled && result.assets[0]) setProofUri(result.assets[0].uri);
    } catch {
      toast.show({ kind: 'error', message: "Couldn't open your photos" });
    }
  }

  const recipient = resolveRecipient(student, sendTo);

  async function sendConfirmation(pkgId: string) {
    try {
      const text = getTopUpReceiptText(pkgId, { recipientName: recipient.name, audience: recipient.who });
      if (!text) throw new Error('missing package');
      await openWhatsApp(recipient.phone, text);
    } catch {
      toast.show({ kind: 'error', message: "Couldn't prepare the confirmation" });
    }
  }

  async function handleConfirm() {
    if (savingRef.current || !ready || hours === null || price === null) return;
    savingRef.current = true;
    setSaving(true);

    let storedProof: string | undefined;
    if (proofUri) {
      try {
        storedProof = await persistProofImage(proofUri);
        setProofUri(storedProof);
      } catch {
        savingRef.current = false;
        setSaving(false);
        toast.show({ kind: 'error', message: "Couldn't save the proof photo — remove it or try again" });
        return;
      }
    }

    let created: ReturnType<typeof createPackage>;
    try {
      created = createPackage({
        id: packageId,
        studentId: id,
        subjectId,
        hoursAdded: hours,
        amountPaid: price,
        paymentMethod,
        paymentRef: reference.trim() || undefined,
        proofImageUri: storedProof,
      });
    } catch (e) {
      savingRef.current = false;
      setSaving(false);
      toast.show({
        kind: 'error',
        message: isSubjectError(e)
          ? 'That subject is no longer available — pick another'
          : "Couldn't add the top-up — please try again",
      });
      return;
    }

    // Travel owed is settled in the same payment (separate rand record, linked to the package).
    let travelSettled = 0;
    let travelFailed = false;
    if (travel > 0) {
      try {
        if (listTravelSettlementsForPackage(created.pkg.id).length === 0) {
          travelSettled = settleTravel({ studentId: id, amount: travel, packageId: created.pkg.id, method: paymentMethod }).amount;
        }
      } catch {
        travelFailed = true;
      }
    }

    const pkgId = created.pkg.id;
    toast.show({
      kind: travelFailed ? 'info' : 'success',
      message: topUpSuccessMessage({
        hours,
        subjectName,
        balanceLabel: formatBalance(created.entry.balance_after),
        travelSettled,
        travelFailed,
      }),
      actionLabel: 'Send confirmation',
      onAction: () => { void sendConfirmation(pkgId); },
      durationMs: travelFailed ? 10000 : 8000,
    });
    router.back();
  }

  return (
    <FormScreen
      header={<ScreenHeader backLabel={firstName.toUpperCase()} onBack={() => router.back()} />}
      footer={
        <View style={{ gap: 8 }}>
          {ready && hours !== null ? (
            <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkSoft, textAlign: 'center' }}>
              {`${subjectName ? `${subjectName} · ` : ''}${balanceReviewLine(balance, balance + hours)}`}
              {travel > 0 && grandTotal !== null ? ` · total ${formatRand(grandTotal)}` : ''}
            </Text>
          ) : null}
          <Button
            label={topUpCtaWithTravel({ hours, price, hasSelection, subjectName, travel })}
            onPress={handleConfirm}
            disabled={!ready}
            busy={saving}
            testID="top-up-confirm"
          />
        </View>
      }
    >
      <PageHeading eyebrow="★ ADD CREDITS" line1="How many" line2="hours?" />

      {multiSubject ? (
        <View style={{ marginBottom: 16 }}>
          <SectionLabel>SUBJECT</SectionLabel>
          <ChoicePills
            options={subjects.map(b => ({ value: b.id, label: `${b.subject} · ${formatBalance(b.balance_hours)}` }))}
            value={subjectId}
            onChange={setSubjectId}
          />
        </View>
      ) : null}

      <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkSoft, marginBottom: 16 }}>
        {`${firstName} has ${formatBalance(balance)}${subjectName ? ` ${subjectName}` : ''} now`}
      </Text>

      {hasTiers ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }} accessibilityRole="radiogroup">
          {tiers.map((t, i) => (
            <View key={`${t.hours}-${t.price}-${i}`} style={{ width: '48%' }}>
              <PackageCard
                hours={t.hours}
                price={t.price}
                badge={t.label || null}
                save={tierSavings(t.hours, t.price, parentPrice)}
                selected={selection === i}
                onPress={() => setSelection(i)}
              />
            </View>
          ))}
          <View style={{ width: '48%' }}>
            <PackageCard
              hours={0}
              price={null}
              badge={null}
              save={null}
              selected={selection === 'custom'}
              onPress={() => setSelection('custom')}
              isCustom
            />
          </View>
        </View>
      ) : null}

      {isCustom ? (
        <View style={{ marginTop: hasTiers ? 16 : 0 }}>
          <SectionLabel>HOURS</SectionLabel>
          <TextInput
            value={customHours}
            onChangeText={setCustomHours}
            placeholder="e.g. 8 or 7,5"
            placeholderTextColor={COLORS.inkFaint}
            keyboardType="decimal-pad"
            accessibilityLabel="Hours to add"
            style={{ ...INPUT, borderBottomColor: hoursPreview.error ? COLORS.crimson : COLORS.paperEdge }}
          />
          {hoursPreview.text ? <FieldHint tone={hoursPreview.error ? 'bad' : 'soft'}>{hoursPreview.text}</FieldHint> : null}

          <SectionLabel style={{ marginTop: 16 }}>{`AMOUNT PAID (${profile?.currency ?? 'ZAR'})`}</SectionLabel>
          <TextInput
            value={customAmount}
            onChangeText={setCustomAmount}
            placeholder="e.g. 4 500"
            placeholderTextColor={COLORS.inkFaint}
            keyboardType="decimal-pad"
            accessibilityLabel="Amount paid in rand"
            style={{ ...INPUT, borderBottomColor: amountPreview.error ? COLORS.crimson : COLORS.paperEdge }}
          />
          {amountPreview.text ? <FieldHint tone={amountPreview.error ? 'bad' : 'soft'}>{amountPreview.text}</FieldHint> : null}
          {customSaving ? (
            <View style={{ backgroundColor: COLORS.okFill, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginTop: 8, alignSelf: 'flex-start' }}>
              <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.moss }}>
                {`Parent saves ${formatRand(customSaving)} vs hourly price`}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {hasTiers && selection === null ? (
        <FieldHint>Pick the package the parent paid for.</FieldHint>
      ) : null}

      {travelOwed.amount > 0 ? (
        <View
          style={{
            marginTop: 24,
            borderWidth: 1,
            borderColor: includeTravel ? COLORS.amber : COLORS.paperEdge,
            backgroundColor: includeTravel ? COLORS.warnFill : COLORS.cardFill,
            borderRadius: 14,
            padding: 14,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.ink }}>
              {topUpTravelToggleLabel(travelOwed.amount, travelOwed.lessonCount)}
            </Text>
            <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkSoft, marginTop: 2 }}>
              {includeTravel ? 'Included in this payment' : 'Not included — stays owed'}
            </Text>
          </View>
          <Switch
            value={includeTravel}
            onValueChange={setIncludeTravel}
            trackColor={{ false: COLORS.paperEdge, true: COLORS.moss }}
            thumbColor={COLORS.paper}
            accessibilityLabel="Include travel owed in this payment"
            testID="top-up-include-travel"
          />
        </View>
      ) : null}

      <View style={{ marginTop: 24 }}>
        <SectionLabel>PAYMENT METHOD</SectionLabel>
        <ChoicePills options={PAYMENT_METHODS} value={paymentMethod} onChange={setPaymentMethod} />
      </View>

      <View style={{ marginTop: 24 }}>
        <SectionLabel>REFERENCE (OPTIONAL)</SectionLabel>
        <TextInput
          value={reference}
          onChangeText={setReference}
          placeholder="e.g. AN0504"
          placeholderTextColor={COLORS.inkFaint}
          autoCapitalize="characters"
          accessibilityLabel="Payment reference"
          style={INPUT}
        />
      </View>

      <View style={{ marginTop: 24 }}>
        <SectionLabel>PROOF OF PAYMENT (OPTIONAL)</SectionLabel>
        {proofUri ? (
          <View>
            <Image source={{ uri: proofUri }} style={{ width: '100%', height: 160, borderRadius: 12 }} resizeMode="cover" />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Button label="Replace" icon="image" variant="quiet" style={{ flex: 1 }} onPress={pickProof} />
              <Button label="Remove" icon="x" variant="danger" style={{ flex: 1 }} onPress={() => setProofUri(null)} />
            </View>
          </View>
        ) : (
          <TouchableOpacity
            onPress={pickProof}
            activeOpacity={0.75}
            hitSlop={hitSlopFor(MIN_TOUCH)}
            accessibilityRole="button"
            accessibilityLabel="Attach proof of payment image"
            style={{
              minHeight: MIN_TOUCH + 4,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: COLORS.inkFaint,
              borderRadius: 12,
              paddingHorizontal: 16,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Feather name="paperclip" size={15} color={COLORS.inkSoft} />
            <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.inkSoft }}>Attach image</Text>
          </TouchableOpacity>
        )}
      </View>

      <RecipientChooser
        student={student}
        value={recipient.who}
        onChange={setSendTo}
        style={{ marginTop: 24 }}
      />
    </FormScreen>
  );
}
