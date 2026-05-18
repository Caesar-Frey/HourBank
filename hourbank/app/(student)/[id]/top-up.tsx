import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { F } from '../../../src/theme/fonts';
import { COLORS } from '../../../src/theme/colors';
import { ScreenHeader } from '../../../src/components/ScreenHeader';
import { PackageCard } from '../../../src/components/PackageCard';
import { getStudent } from '../../../src/db/students';
import { createPackage } from '../../../src/db/packages';
import { getOrCreateTutorProfile, TutorProfile, PackageTier } from '../../../src/db/tutorProfile';
import { formatRand, formatHours } from '../../../src/utils/format';
import { sendTopUpConfirmation } from '../../../src/utils/notifications';
import { Student } from '../../../src/db/schema';

type PaymentMethod = 'eft' | 'cash' | 'card' | 'other';

const PAYMENT_METHODS: { key: PaymentMethod; label: string }[] = [
  { key: 'eft', label: 'EFT' },
  { key: 'cash', label: 'Cash' },
  { key: 'card', label: 'Card' },
  { key: 'other', label: 'Other' },
];

// sentinel index meaning "Other / custom"
const CUSTOM_INDEX = -1;

function computeSavingsPct(hours: number, price: number, hourlyRate: number): number | null {
  if (hourlyRate <= 0 || hours <= 0 || price <= 0) return null;
  const fullPrice = hourlyRate * hours;
  const saving = fullPrice - price;
  if (saving <= 0) return null;
  return Math.round((saving / fullPrice) * 100);
}

export default function TopUpScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [student, setStudent] = useState<Student | null>(null);
  const [profile, setProfile] = useState<TutorProfile | null>(null);
  const [tiers, setTiers] = useState<PackageTier[]>([]);
  const [tierEnabled, setTierEnabled] = useState(false);

  // selectedTierIndex = index in sorted tiers array, or CUSTOM_INDEX
  const [selectedTierIndex, setSelectedTierIndex] = useState<number>(0);
  const [customHours, setCustomHours] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('eft');
  const [reference, setReference] = useState('');
  const [proofUri, setProofUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    try {
      const s = getStudent(id);
      setStudent(s);
    } catch (e) {
      console.error('Failed to load student', e);
    }
    try {
      const p = getOrCreateTutorProfile();
      setProfile(p);
      const enabled = p.tier_system_enabled === 1;
      setTierEnabled(enabled);
      if (enabled) {
        try {
          const parsed: PackageTier[] = JSON.parse(p.package_tiers);
          const sorted = Array.isArray(parsed)
            ? [...parsed].sort((a, b) => a.sort_order - b.sort_order)
            : [];
          setTiers(sorted);
          setSelectedTierIndex(sorted.length > 0 ? 0 : CUSTOM_INDEX);
        } catch {
          setTiers([]);
          setSelectedTierIndex(CUSTOM_INDEX);
        }
      }
    } catch (e) {
      console.error('Failed to load tutor profile', e);
    }
  }, [id]);

  const hourlyRate = profile?.hourly_rate ?? 0;

  // Compute selected hours/price from tier or custom inputs
  let selectedHours = 0;
  let selectedPrice = 0;

  if (tierEnabled) {
    if (selectedTierIndex === CUSTOM_INDEX) {
      selectedHours = parseFloat(customHours) || 0;
      selectedPrice = parseFloat(customAmount) || 0;
    } else {
      const tier = tiers[selectedTierIndex];
      if (tier) {
        selectedHours = tier.hours;
        selectedPrice = tier.price;
      }
    }
  } else {
    selectedHours = parseFloat(customHours) || 0;
    selectedPrice = parseFloat(customAmount) || 0;
  }

  const savingsPct = computeSavingsPct(selectedHours, selectedPrice, hourlyRate);

  const pickProof = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsEditing: false,
      quality: 0.8,
    });
    if (!result.canceled) {
      setProofUri(result.assets[0].uri);
    }
  };

  const handleConfirm = async () => {
    if (selectedHours <= 0) {
      Alert.alert('Invalid hours', 'Please select or enter a valid number of hours.');
      return;
    }
    if (selectedPrice < 0) {
      Alert.alert('Invalid amount', 'Amount paid cannot be negative.');
      return;
    }
    if (!tierEnabled || selectedTierIndex === CUSTOM_INDEX) {
      const h = parseFloat(customHours);
      const a = parseFloat(customAmount);
      if (!customHours || isNaN(h) || h <= 0) {
        Alert.alert('Invalid hours', 'Please enter a valid number of hours.');
        return;
      }
      if (!customAmount || isNaN(a) || a < 0) {
        Alert.alert('Invalid amount', 'Please enter a valid amount.');
        return;
      }
    }

    if (submitting) return;
    setSubmitting(true);
    try {
      const result = createPackage({
        studentId: id,
        hoursAdded: selectedHours,
        amountPaid: selectedPrice,
        paymentMethod,
        paymentRef: reference.trim() || undefined,
        proofImageUri: proofUri || undefined,
      });

      await sendTopUpConfirmation({
        studentName: student?.full_name ?? '',
        hoursAdded: selectedHours,
        amountPaid: selectedPrice,
        newBalance: result.entry.balance_after,
      });

      Alert.alert('Credits added', `Balance is now ${formatHours(result.entry.balance_after)}.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e) {
      console.error('Top-up failed', e);
      Alert.alert('Error', 'Failed to add credits. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const monoLabel = {
    fontFamily: F.mono,
    fontSize: 10,
    color: COLORS.inkFaint,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 4,
  };

  const firstName = student?.full_name?.split(' ')[0] ?? 'BACK';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
      <ScreenHeader
        backLabel={firstName.toUpperCase()}
        onBack={() => router.back()}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Page heading */}
        <View style={{ marginBottom: 24 }}>
          <Text
            style={{
              fontFamily: F.mono,
              fontSize: 10,
              color: COLORS.oxblood,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 8,
            }}
          >
            ★ ADD CREDITS
          </Text>
          <Text style={{ fontFamily: F.serif, fontSize: 28, color: COLORS.ink, lineHeight: 32 }}>
            How many
          </Text>
          <Text style={{ fontFamily: F.serifItalic, fontSize: 28, color: COLORS.oxblood, lineHeight: 34 }}>
            hours?
          </Text>
        </View>

        {/* ── TIER SYSTEM ─────────────────────────────────────────────────── */}
        {tierEnabled && tiers.length > 0 ? (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {tiers.map((tier, i) => {
                const savPct = computeSavingsPct(tier.hours, tier.price, hourlyRate);
                return (
                  <View key={i} style={{ width: '48%' }}>
                    <PackageCard
                      hours={tier.hours}
                      price={tier.price}
                      badge={tier.label || null}
                      save={savPct !== null ? Math.round(hourlyRate * tier.hours - tier.price) : null}
                      selected={selectedTierIndex === i}
                      onPress={() => setSelectedTierIndex(i)}
                    />
                  </View>
                );
              })}
              {/* Other tile */}
              <View style={{ width: '48%' }}>
                <PackageCard
                  hours={0}
                  price={null}
                  badge={null}
                  save={null}
                  selected={selectedTierIndex === CUSTOM_INDEX}
                  onPress={() => setSelectedTierIndex(CUSTOM_INDEX)}
                  isCustom={true}
                />
              </View>
            </View>

            {/* Custom inputs — only when "Other" selected */}
            {selectedTierIndex === CUSTOM_INDEX && (
              <View style={{ marginTop: 12 }}>
                <Text style={monoLabel}>CUSTOM HOURS</Text>
                <TextInput
                  value={customHours}
                  onChangeText={setCustomHours}
                  placeholder="e.g. 8"
                  keyboardType="numeric"
                  placeholderTextColor={COLORS.inkFaint}
                  style={{
                    fontFamily: F.mono,
                    fontSize: 16,
                    color: COLORS.ink,
                    borderBottomWidth: 1,
                    borderBottomColor: COLORS.paperEdge,
                    paddingVertical: 12,
                  }}
                />
                <Text style={monoLabel}>CUSTOM AMOUNT ({profile?.currency ?? 'ZAR'})</Text>
                <TextInput
                  value={customAmount}
                  onChangeText={setCustomAmount}
                  placeholder="e.g. 4500"
                  keyboardType="numeric"
                  placeholderTextColor={COLORS.inkFaint}
                  style={{
                    fontFamily: F.mono,
                    fontSize: 16,
                    color: COLORS.ink,
                    borderBottomWidth: 1,
                    borderBottomColor: COLORS.paperEdge,
                    paddingVertical: 12,
                  }}
                />
              </View>
            )}
          </>
        ) : (
          /* Free entry mode — tier system disabled */
          <View>
            <Text style={monoLabel}>HOURS</Text>
            <TextInput
              value={customHours}
              onChangeText={setCustomHours}
              placeholder="e.g. 10"
              keyboardType="numeric"
              placeholderTextColor={COLORS.inkFaint}
              style={{
                fontFamily: F.mono,
                fontSize: 16,
                color: COLORS.ink,
                borderBottomWidth: 1,
                borderBottomColor: COLORS.paperEdge,
                paddingVertical: 12,
              }}
            />
            <Text style={monoLabel}>AMOUNT ({profile?.currency ?? 'ZAR'})</Text>
            <TextInput
              value={customAmount}
              onChangeText={setCustomAmount}
              placeholder="e.g. 6000"
              keyboardType="numeric"
              placeholderTextColor={COLORS.inkFaint}
              style={{
                fontFamily: F.mono,
                fontSize: 16,
                color: COLORS.ink,
                borderBottomWidth: 1,
                borderBottomColor: COLORS.paperEdge,
                paddingVertical: 12,
              }}
            />
          </View>
        )}

        {/* Savings label */}
        {savingsPct !== null && selectedHours > 0 && (
          <View
            style={{
              backgroundColor: COLORS.okFill,
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 6,
              marginTop: 10,
              alignSelf: 'flex-start',
            }}
          >
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.moss }}>
              Save {savingsPct}% vs. hourly rate
            </Text>
          </View>
        )}

        {/* Payment method */}
        <Text style={monoLabel}>PAYMENT METHOD</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          {PAYMENT_METHODS.map(({ key, label }) => {
            const active = paymentMethod === key;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setPaymentMethod(key)}
                activeOpacity={0.75}
                style={{
                  backgroundColor: active ? COLORS.ink : 'transparent',
                  borderWidth: 1,
                  borderColor: active ? COLORS.ink : COLORS.paperEdge,
                  borderRadius: 20,
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                }}
              >
                <Text
                  style={{
                    fontFamily: F.mono,
                    fontSize: 12,
                    color: active ? COLORS.paper : COLORS.ink,
                  }}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Reference */}
        <Text style={monoLabel}>REFERENCE</Text>
        <TextInput
          value={reference}
          onChangeText={setReference}
          placeholder="e.g. AN0504"
          placeholderTextColor={COLORS.inkFaint}
          autoCapitalize="characters"
          style={{
            fontFamily: F.mono,
            fontSize: 16,
            color: COLORS.ink,
            borderBottomWidth: 1,
            borderBottomColor: COLORS.paperEdge,
            paddingVertical: 12,
          }}
        />

        {/* Proof of payment */}
        <Text style={monoLabel}>PROOF OF PAYMENT</Text>
        <TouchableOpacity
          onPress={pickProof}
          activeOpacity={0.75}
          style={{
            borderWidth: 1,
            borderColor: COLORS.paperEdge,
            borderRadius: 12,
            paddingHorizontal: 16,
            paddingVertical: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginTop: 4,
          }}
        >
          <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.inkFaint }}>
            {proofUri ? 'Image attached' : 'Attach image (optional)'}
          </Text>
        </TouchableOpacity>

        {proofUri && (
          <Image
            source={{ uri: proofUri }}
            style={{
              width: '100%',
              height: 160,
              borderRadius: 12,
              marginTop: 8,
              resizeMode: 'cover',
            } as any}
          />
        )}

        {/* CTA */}
        <TouchableOpacity
          onPress={handleConfirm}
          disabled={submitting}
          activeOpacity={0.85}
          style={{
            backgroundColor: COLORS.oxblood,
            borderRadius: 16,
            paddingVertical: 16,
            alignItems: 'center',
            marginTop: 28,
            opacity: submitting ? 0.5 : 1,
          }}
        >
          <Text
            style={{
              fontFamily: F.sansMed,
              fontSize: 15,
              color: COLORS.paper,
            }}
          >
            {`Confirm top-up · ${formatRand(selectedPrice)} ▸`}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
