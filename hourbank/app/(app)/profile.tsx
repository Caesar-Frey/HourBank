import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, Alert, Switch, TextInput, Modal, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { F, MIN_TOUCH, hitSlopFor } from '../../src/theme/fonts';
import { COLORS } from '../../src/theme/colors';
import { FormScreen } from '../../src/components/FormScreen';
import { TabHeader } from '../../src/components/ScreenHeader';
import { useToast } from '../../src/components/Toast';
import {
  SectionLabel,
  SettingsField,
  SettingsLinkRow,
  ChipRow,
  FieldError,
  ROW_CONTAINER,
  FIELD_LABEL,
  HELP_TEXT,
} from '../../src/components/settings/SettingsParts';
import { RestoreBackupModal } from '../../src/components/settings/RestoreBackupModal';
import { PaymentReferenceField } from '../../src/components/settings/PaymentReferenceField';
import { DEFAULT_PAYMENT_REFERENCE_TEMPLATE } from '../../src/utils/paymentReference';
import { listActiveStudents } from '../../src/db/students';
import { useKeyboardOverlap } from '../../src/components/FormScreen';
import {
  BILLING_ROUND_OPTIONS,
  MAX_OWE_EXPLANATION,
  TierDraft,
  TierErrors,
  backupErrorMessage,
  billingRoundingExplanation,
  lastBackupLabel,
  tierDraftsFromTiers,
  validateAmount,
  validateTierDrafts,
} from '../../src/components/settings/settingsLogic';
import { seedDemoData, resetDb } from '../../src/db/seed';
import { getOrCreateTutorProfile, upsertTutorProfile, PackageTier, TutorProfile } from '../../src/db/tutorProfile';
import { ALL_MIGRATIONS } from '../../src/db/migrations';
import { exportDatabase, getLastBackupAt, importBackup, BackupSummary } from '../../src/utils/backup';
import { BACKUP_READY_TOAST } from '../../src/utils/shareCopy';
import { formatHours, formatRand } from '../../src/utils/format';
import { useSessionTimer } from '../../src/contexts/SessionTimerContext';
import { SHOW_ALL_GRADES_KEY } from '../../src/config';

type AmountField = 'parentPrice' | 'payoutRate' | 'maxOwe' | 'perKm';
type PendingRestore = Awaited<ReturnType<typeof importBackup>>;

/** Used for the payment reference preview until the tutor has a student. */
const SAMPLE_REFERENCE_STUDENT = { id: 'sample-student', full_name: 'Amahle Dlamini' };

let tierKeySeq = 0;
const nextTierKey = () => `tier-${++tierKeySeq}`;

function parseTiers(json: string | null | undefined): PackageTier[] {
  try {
    const parsed = JSON.parse(json ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function SettingsScreen() {
  const router = useRouter();
  const toast = useToast();
  const { status: timerStatus, endTimer } = useSessionTimer();

  const profileRef = useRef<TutorProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [showAllGrades, setShowAllGrades] = useState(false);

  // Drafts (strings keep half-typed input like "1," intact).
  const [fullName, setFullName] = useState('');
  const [amounts, setAmounts] = useState<Record<AmountField, string>>({
    parentPrice: '',
    payoutRate: '',
    maxOwe: '0',
    perKm: '0',
  });
  const [errors, setErrors] = useState<Partial<Record<AmountField, string | null>>>({});
  const [paymentDetails, setPaymentDetails] = useState('');
  const [referenceTemplate, setReferenceTemplate] = useState(DEFAULT_PAYMENT_REFERENCE_TEMPLATE);
  const [referenceSample, setReferenceSample] = useState(SAMPLE_REFERENCE_STUDENT);
  const [roundMinutes, setRoundMinutes] = useState(15);
  const [travelMode, setTravelMode] = useState<'flat' | 'distance'>('flat');
  const [tierEnabled, setTierEnabled] = useState(true);
  const [tierDrafts, setTierDrafts] = useState<TierDraft[]>([]);
  const [tierErrors, setTierErrors] = useState<TierErrors>({});

  // Backup & restore
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState<'export' | 'inspect' | 'restore' | null>(null);
  const busyRef = useRef(false);
  const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null);
  const [restoreSummary, setRestoreSummary] = useState<BackupSummary | null>(null);

  // Dev tools
  const [resetConfirmVisible, setResetConfirmVisible] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const keyboardOverlap = useKeyboardOverlap();

  const loadProfile = useCallback(() => {
    try {
      const p = getOrCreateTutorProfile();
      profileRef.current = p;
      setFullName(p.full_name ?? '');
      setAmounts({
        parentPrice: String(p.parent_hourly_price ?? p.hourly_rate),
        payoutRate: String(p.hourly_rate),
        maxOwe: String(p.max_owe_hours ?? 0),
        perKm: String(p.per_km_rate ?? 0),
      });
      setErrors({});
      setPaymentDetails(p.payment_details ?? '');
      setReferenceTemplate(p.payment_reference_template || DEFAULT_PAYMENT_REFERENCE_TEMPLATE);
      try {
        const first = listActiveStudents()[0];
        setReferenceSample(first ? { id: first.id, full_name: first.full_name } : SAMPLE_REFERENCE_STUDENT);
      } catch {
        setReferenceSample(SAMPLE_REFERENCE_STUDENT);
      }
      setRoundMinutes(p.billing_round_minutes || 15);
      setTravelMode(p.travel_mode === 'distance' ? 'distance' : 'flat');
      setTierEnabled(p.tier_system_enabled === 1);
      setTierDrafts(tierDraftsFromTiers(parseTiers(p.package_tiers), nextTierKey));
      setTierErrors({});
      setLastBackupAt(p.last_backup_at ?? null);
      setProfileLoaded(true);
    } catch {
      toast.show({ kind: 'error', message: "Couldn't load your settings." });
    }
  }, [toast]);

  useEffect(() => {
    loadProfile();
    AsyncStorage.getItem(SHOW_ALL_GRADES_KEY)
      .then(v => setShowAllGrades(v === 'true'))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The tab stays mounted — refresh the backup age whenever it regains focus.
  useFocusEffect(
    useCallback(() => {
      getLastBackupAt().then(setLastBackupAt).catch(() => {});
    }, [])
  );

  /** Autosave: write only what changed, confirm with a toast; failures are error toasts. */
  const save = useCallback(
    (patch: Partial<TutorProfile>): boolean => {
      const current = profileRef.current;
      if (current) {
        const changed = (Object.keys(patch) as (keyof TutorProfile)[]).some(k => patch[k] !== current[k]);
        if (!changed) return true;
      }
      try {
        profileRef.current = upsertTutorProfile(patch);
        toast.show({ kind: 'success', message: 'Saved' });
        return true;
      } catch {
        toast.show({ kind: 'error', message: "Couldn't save — please try again." });
        return false;
      }
    },
    [toast]
  );

  /** Blank resets to the default so reminders always carry a usable reference. */
  function commitReferenceTemplate(v: string) {
    const next = v.trim() || DEFAULT_PAYMENT_REFERENCE_TEMPLATE;
    if (next !== v) setReferenceTemplate(next);
    save({ payment_reference_template: next });
  }

  // ── Amount fields ──────────────────────────────────────────────────────
  const AMOUNT_COLUMN: Record<AmountField, keyof TutorProfile> = {
    parentPrice: 'parent_hourly_price',
    payoutRate: 'hourly_rate',
    maxOwe: 'max_owe_hours',
    perKm: 'per_km_rate',
  };

  function changeAmount(field: AmountField, text: string) {
    setAmounts(a => ({ ...a, [field]: text }));
    if (errors[field]) setErrors(e => ({ ...e, [field]: null }));
  }

  function blurAmount(field: AmountField) {
    const { value, error } = validateAmount(amounts[field]);
    setErrors(e => ({ ...e, [field]: error }));
    if (error || value === null) return;
    save({ [AMOUNT_COLUMN[field]]: value } as Partial<TutorProfile>);
  }

  function amountPreview(field: AmountField, kind: 'rand' | 'hours'): string | null {
    const { value, error } = validateAmount(amounts[field]);
    if (error || value === null) return null;
    return `= ${kind === 'rand' ? formatRand(value) : formatHours(value)}`;
  }

  // ── Package tiers ──────────────────────────────────────────────────────
  function persistTiers(drafts: TierDraft[]) {
    const { tiers, errors: errs } = validateTierDrafts(drafts);
    setTierErrors(errs);
    if (!tiers) return;
    save({ package_tiers: JSON.stringify(tiers) });
  }

  function changeTier(key: string, field: 'hours' | 'price' | 'label', value: string) {
    setTierDrafts(ds => ds.map(d => (d.key === key ? { ...d, [field]: value } : d)));
    if (field !== 'label' && tierErrors[key]?.[field]) {
      setTierErrors(e => ({ ...e, [key]: { ...e[key], [field]: undefined } }));
    }
  }

  function addTier() {
    const nextSort = tierDrafts.length > 0 ? Math.max(...tierDrafts.map(t => t.sort_order)) + 1 : 0;
    setTierDrafts(ds => [...ds, { key: nextTierKey(), hours: '', price: '', label: '', sort_order: nextSort }]);
  }

  function deleteTier(draft: TierDraft) {
    const hours = validateAmount(draft.hours, { positive: true }).value;
    const name = hours ? `the ${formatHours(hours)} package` : 'this package';
    Alert.alert('Delete package?', `Remove ${name} from the top-up screen? Past top-ups are not affected.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const remaining = tierDrafts.filter(d => d.key !== draft.key);
          setTierDrafts(remaining);
          persistTiers(remaining);
        },
      },
    ]);
  }

  // ── Backup & restore ───────────────────────────────────────────────────
  function claimBusy(kind: 'export' | 'inspect' | 'restore'): boolean {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBackupBusy(kind);
    return true;
  }
  function releaseBusy() {
    busyRef.current = false;
    setBackupBusy(null);
  }

  async function handleBackup() {
    if (!claimBusy('export')) return;
    try {
      await exportDatabase();
      setLastBackupAt(await getLastBackupAt());
      toast.show({ kind: 'success', message: BACKUP_READY_TOAST });
    } catch {
      toast.show({ kind: 'error', message: "Couldn't create the backup. Please try again." });
    } finally {
      releaseBusy();
    }
  }

  async function handlePickRestore() {
    if (!claimBusy('inspect')) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
      if (picked.canceled || !picked.assets?.[0]) return;
      const pending = await importBackup(picked.assets[0].uri, ALL_MIGRATIONS);
      setPendingRestore(pending);
      setRestoreSummary(pending.summary);
    } catch (e) {
      toast.show({ kind: 'error', message: backupErrorMessage(e) });
    } finally {
      releaseBusy();
    }
  }

  async function cancelRestore() {
    const pending = pendingRestore;
    setRestoreSummary(null);
    setPendingRestore(null);
    await pending?.cancel().catch(() => {});
  }

  async function confirmRestore() {
    const pending = pendingRestore;
    if (!pending || !claimBusy('restore')) return;
    try {
      await pending.restore();
      // The DB file was swapped: drop in-memory lesson state and reload everything.
      endTimer();
      setRestoreSummary(null);
      setPendingRestore(null);
      loadProfile();
      toast.show({
        kind: 'success',
        message: `Backup restored — ${pending.summary.students} ${pending.summary.students === 1 ? 'student' : 'students'}.`,
      });
      router.replace('/');
    } catch (e) {
      setRestoreSummary(null);
      setPendingRestore(null);
      toast.show({ kind: 'error', message: backupErrorMessage(e) });
    } finally {
      releaseBusy();
    }
  }

  // ── Dev tools ──────────────────────────────────────────────────────────
  function handleSeed() {
    try {
      seedDemoData();
      toast.show({ kind: 'success', message: 'Demo students loaded.' });
    } catch {
      toast.show({ kind: 'error', message: "Couldn't load demo data." });
    }
  }

  function confirmReset() {
    try {
      resetDb();
      setResetConfirmVisible(false);
      endTimer();
      loadProfile();
      toast.show({ kind: 'success', message: 'Database cleared.' });
    } catch {
      toast.show({ kind: 'error', message: "Couldn't clear the database." });
    }
  }

  const backupAge = lastBackupLabel(lastBackupAt);

  return (
    <FormScreen header={<TabHeader title="Settings" />} edges={['top']} contentContainerStyle={{ paddingBottom: 48 }}>
      {/* ── Profile ───────────────────────────────────────────────────── */}
      <SectionLabel>Profile</SectionLabel>
      <SettingsField
        label="Your name"
        value={fullName}
        onChangeText={setFullName}
        onBlur={() => save({ full_name: fullName.trim() })}
        placeholder="Your full name"
        help="Shown on receipts and claims."
      />
      <View style={[ROW_CONTAINER, { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH }]}>
        <Text style={[FIELD_LABEL, { flex: 1, marginBottom: 0 }]}>Currency</Text>
        <Text style={{ fontFamily: F.mono, fontSize: 14, color: COLORS.inkSoft }}>ZAR (R)</Text>
      </View>

      {/* ── Rates ─────────────────────────────────────────────────────── */}
      <SectionLabel>Rates</SectionLabel>
      <SettingsField
        testID="parent-price"
        label="Parent price per hour"
        value={amounts.parentPrice}
        onChangeText={t => changeAmount('parentPrice', t)}
        onBlur={() => blurAmount('parentPrice')}
        keyboardType="decimal-pad"
        mono
        placeholder="450"
        error={errors.parentPrice}
        preview={amountPreview('parentPrice', 'rand')}
        help="What parents pay for one hour. Used to show savings on top-up packages."
      />
      <SettingsField
        testID="payout-rate"
        label="Your payout rate per hour"
        value={amounts.payoutRate}
        onChangeText={t => changeAmount('payoutRate', t)}
        onBlur={() => blurAmount('payoutRate')}
        keyboardType="decimal-pad"
        mono
        placeholder="300"
        error={errors.payoutRate}
        preview={amountPreview('payoutRate', 'rand')}
        help="What you're paid per hour taught. Used for payout claims."
      />

      <View style={ROW_CONTAINER}>
        <Text style={FIELD_LABEL}>Travel fee</Text>
        <ChipRow
          options={['flat', 'distance'] as const}
          value={travelMode}
          format={m => (m === 'flat' ? 'Flat' : 'Per km')}
          onChange={m => {
            setTravelMode(m);
            save({ travel_mode: m });
          }}
        />
        <Text style={HELP_TEXT}>Flat: a set fee per student. Per km: charged by distance travelled.</Text>
      </View>
      {travelMode === 'distance' && (
        <SettingsField
          label="Rate per km"
          value={amounts.perKm}
          onChangeText={t => changeAmount('perKm', t)}
          onBlur={() => blurAmount('perKm')}
          keyboardType="decimal-pad"
          mono
          placeholder="4.50"
          error={errors.perKm}
          preview={amountPreview('perKm', 'rand')}
        />
      )}

      {/* ── Billing ───────────────────────────────────────────────────── */}
      <SectionLabel>Billing</SectionLabel>
      <View style={ROW_CONTAINER}>
        <Text style={FIELD_LABEL}>Round lessons to</Text>
        <ChipRow
          options={BILLING_ROUND_OPTIONS}
          value={roundMinutes as (typeof BILLING_ROUND_OPTIONS)[number]}
          format={m => `${m} min`}
          onChange={m => {
            setRoundMinutes(m);
            save({ billing_round_minutes: m });
          }}
        />
        <Text style={HELP_TEXT}>{billingRoundingExplanation(roundMinutes)}</Text>
      </View>
      <SettingsField
        testID="max-owe"
        label="Max hours a student may owe"
        value={amounts.maxOwe}
        onChangeText={t => changeAmount('maxOwe', t)}
        onBlur={() => blurAmount('maxOwe')}
        keyboardType="decimal-pad"
        mono
        placeholder="0"
        error={errors.maxOwe}
        preview={amountPreview('maxOwe', 'hours')}
        help={MAX_OWE_EXPLANATION}
      />
      <SettingsField
        label="Payment details"
        value={paymentDetails}
        onChangeText={setPaymentDetails}
        onBlur={() => save({ payment_details: paymentDetails.trim() || null })}
        multiline
        placeholder={'e.g. FNB · Acc 62000000000 · Branch 250655'}
        help="Added to WhatsApp top-up reminders so parents know where to pay."
      />
      <PaymentReferenceField
        value={referenceTemplate}
        onChangeText={setReferenceTemplate}
        onCommit={commitReferenceTemplate}
        sampleStudent={referenceSample}
      />

      {/* ── Packages ──────────────────────────────────────────────────── */}
      <SectionLabel>Top-up packages</SectionLabel>
      <View style={[ROW_CONTAINER, { flexDirection: 'row', alignItems: 'center' }]}>
        <View style={{ flex: 1, marginRight: 12 }}>
          <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.ink }}>Offer packages</Text>
          <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkFaint, marginTop: 2 }}>
            Show these hour bundles on the top-up screen
          </Text>
        </View>
        <Switch
          value={tierEnabled}
          onValueChange={v => {
            setTierEnabled(v);
            save({ tier_system_enabled: v ? 1 : 0 });
          }}
          trackColor={{ false: COLORS.paperEdge, true: COLORS.oxblood }}
          thumbColor={COLORS.paper}
        />
      </View>

      {tierEnabled && profileLoaded && (
        <View style={{ marginTop: 4 }}>
          {tierDrafts.map(draft => {
            const err = tierErrors[draft.key];
            const hours = validateAmount(draft.hours, { positive: true }).value;
            return (
              <View key={draft.key} style={[ROW_CONTAINER, { borderColor: err ? COLORS.crimson : COLORS.paperEdge }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {/* Heading derives from numeric hours — the amount actually credited. */}
                  <Text style={[FIELD_LABEL, { flex: 1, marginBottom: 0 }]}>
                    {hours ? `${formatHours(hours)} package` : 'New package'}
                  </Text>
                  <TouchableOpacity
                    onPress={() => deleteTier(draft)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={hours ? `Delete ${formatHours(hours)} package` : 'Delete package'}
                    hitSlop={hitSlopFor(24)}
                    style={{ minHeight: MIN_TOUCH, justifyContent: 'center', paddingLeft: 12 }}
                  >
                    <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: COLORS.crimson }}>Delete</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={FIELD_LABEL}>Hours</Text>
                    <TextInput
                      accessibilityLabel="Package hours"
                      value={draft.hours}
                      onChangeText={v => changeTier(draft.key, 'hours', v)}
                      onBlur={() => persistTiers(tierDrafts)}
                      keyboardType="decimal-pad"
                      placeholder="10"
                      placeholderTextColor={COLORS.inkFaint}
                      style={{
                        minHeight: MIN_TOUCH,
                        fontFamily: F.mono,
                        fontSize: 15,
                        color: COLORS.ink,
                        borderBottomWidth: 1,
                        borderBottomColor: err?.hours ? COLORS.crimson : COLORS.paperEdge,
                      }}
                    />
                    <FieldError message={err?.hours} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={FIELD_LABEL}>Price (R)</Text>
                    <TextInput
                      accessibilityLabel="Package price"
                      value={draft.price}
                      onChangeText={v => changeTier(draft.key, 'price', v)}
                      onBlur={() => persistTiers(tierDrafts)}
                      keyboardType="decimal-pad"
                      placeholder="5500"
                      placeholderTextColor={COLORS.inkFaint}
                      style={{
                        minHeight: MIN_TOUCH,
                        fontFamily: F.mono,
                        fontSize: 15,
                        color: COLORS.ink,
                        borderBottomWidth: 1,
                        borderBottomColor: err?.price ? COLORS.crimson : COLORS.paperEdge,
                      }}
                    />
                    <FieldError message={err?.price} />
                  </View>
                </View>
                <View style={{ marginTop: 10 }}>
                  <Text style={FIELD_LABEL}>Promo label (optional)</Text>
                  <TextInput
                    accessibilityLabel="Promo label"
                    value={draft.label}
                    onChangeText={v => changeTier(draft.key, 'label', v)}
                    onBlur={() => persistTiers(tierDrafts)}
                    placeholder="e.g. Best Value"
                    placeholderTextColor={COLORS.inkFaint}
                    style={{
                      minHeight: MIN_TOUCH,
                      fontFamily: F.sans,
                      fontSize: 14,
                      color: COLORS.ink,
                      borderBottomWidth: 1,
                      borderBottomColor: COLORS.paperEdge,
                    }}
                  />
                  <Text style={HELP_TEXT}>Promo text only — the package size always comes from Hours.</Text>
                </View>
                {err && (
                  <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.crimson, marginTop: 8 }}>
                    Package changes aren't saved until every package has hours and a price.
                  </Text>
                )}
              </View>
            );
          })}
          <TouchableOpacity
            onPress={addTier}
            activeOpacity={0.8}
            accessibilityRole="button"
            style={{
              minHeight: MIN_TOUCH,
              borderWidth: 1,
              borderColor: COLORS.paperEdge,
              borderStyle: 'dashed',
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 8,
            }}
          >
            <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: COLORS.inkSoft }}>+ Add package</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Students ──────────────────────────────────────────────────── */}
      <SectionLabel>Students</SectionLabel>
      <SettingsLinkRow
        icon="archive"
        title="Archived students"
        subtitle="View or restore students you've archived"
        onPress={() => router.push('/student/archived')}
      />
      <View style={[ROW_CONTAINER, { flexDirection: 'row', alignItems: 'center' }]}>
        <View style={{ flex: 1, marginRight: 12 }}>
          <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.ink }}>Show all grades (1–12)</Text>
          <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkFaint, marginTop: 2 }}>
            Off: only grades 8–12 (high school)
          </Text>
        </View>
        <Switch
          value={showAllGrades}
          onValueChange={v => {
            setShowAllGrades(v);
            AsyncStorage.setItem(SHOW_ALL_GRADES_KEY, v ? 'true' : 'false').catch(() => {});
          }}
          trackColor={{ false: COLORS.paperEdge, true: COLORS.oxblood }}
          thumbColor={COLORS.paper}
        />
      </View>

      {/* ── Backup & restore ──────────────────────────────────────────── */}
      <SectionLabel>Backup & restore</SectionLabel>
      <View style={[ROW_CONTAINER, { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH }]}>
        <Text style={{ flex: 1, fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft }}>Last backup created</Text>
        <Text
          testID="last-backup"
          style={{ fontFamily: F.mono, fontSize: 13, color: backupAge === 'Never' ? COLORS.crimson : COLORS.ink }}
        >
          {backupAge}
        </Text>
      </View>
      <SettingsLinkRow
        icon="upload-cloud"
        title={backupBusy === 'export' ? 'Preparing backup…' : 'Back up now'}
        subtitle="Save a copy of all your data (incl. proof photos) to Drive, email or WhatsApp"
        onPress={handleBackup}
        busy={backupBusy !== null}
        trailing={backupBusy === 'export' ? <ActivityIndicator color={COLORS.inkSoft} /> : undefined}
      />
      <SettingsLinkRow
        icon="download-cloud"
        title={backupBusy === 'inspect' ? 'Checking backup…' : 'Restore from backup'}
        subtitle="Replace the data on this phone with a backup file"
        onPress={handlePickRestore}
        busy={backupBusy !== null}
        trailing={backupBusy === 'inspect' ? <ActivityIndicator color={COLORS.inkSoft} /> : undefined}
      />

      {/* ── Dev tools ─────────────────────────────────────────────────── */}
      {__DEV__ && (
        <View>
          <SectionLabel>Dev tools</SectionLabel>
          <TouchableOpacity
            onPress={handleSeed}
            activeOpacity={0.8}
            style={{
              minHeight: MIN_TOUCH,
              backgroundColor: COLORS.oxblood,
              borderRadius: 14,
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.paper }}>Load demo data</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setResetConfirmText('');
              setResetConfirmVisible(true);
            }}
            activeOpacity={0.8}
            style={{
              minHeight: MIN_TOUCH,
              borderWidth: 1,
              borderColor: COLORS.crimson,
              borderRadius: 14,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.crimson }}>Reset database</Text>
          </TouchableOpacity>
        </View>
      )}

      <RestoreBackupModal
        summary={restoreSummary}
        busy={backupBusy === 'restore'}
        lessonInProgress={timerStatus !== 'idle'}
        onCancel={cancelRestore}
        onConfirm={confirmRestore}
      />

      <Modal
        visible={resetConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setResetConfirmVisible(false)}
      >
        <View
          style={{ flex: 1, backgroundColor: COLORS.scrim, justifyContent: 'center', alignItems: 'center', padding: 32, paddingBottom: 32 + keyboardOverlap }}
        >
          <View style={{ backgroundColor: COLORS.paper, borderRadius: 16, padding: 24, width: '100%' }}>
            <Text style={{ fontFamily: F.serif, fontSize: 20, color: COLORS.ink, marginBottom: 8 }}>Reset all data?</Text>
            <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.inkSoft, marginBottom: 20 }}>
              This permanently deletes every student, session, and ledger entry. Type RESET to confirm.
            </Text>
            <TextInput
              value={resetConfirmText}
              onChangeText={setResetConfirmText}
              placeholder="RESET"
              placeholderTextColor={COLORS.inkFaint}
              autoCapitalize="characters"
              autoCorrect={false}
              style={{
                minHeight: MIN_TOUCH,
                fontFamily: F.mono,
                fontSize: 16,
                color: COLORS.crimson,
                borderWidth: 1,
                borderColor: COLORS.crimson,
                borderRadius: 8,
                paddingHorizontal: 12,
                marginBottom: 20,
              }}
            />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                onPress={() => setResetConfirmVisible(false)}
                activeOpacity={0.8}
                style={{
                  flex: 1,
                  minHeight: MIN_TOUCH,
                  borderWidth: 1,
                  borderColor: COLORS.paperEdge,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.inkSoft }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmReset}
                disabled={resetConfirmText !== 'RESET'}
                activeOpacity={0.8}
                style={{
                  flex: 1,
                  minHeight: MIN_TOUCH,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: resetConfirmText === 'RESET' ? COLORS.crimson : COLORS.paperEdge,
                }}
              >
                <Text
                  style={{
                    fontFamily: F.sansMed,
                    fontSize: 14,
                    color: resetConfirmText === 'RESET' ? COLORS.paper : COLORS.inkFaint,
                  }}
                >
                  Reset
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </FormScreen>
  );
}
