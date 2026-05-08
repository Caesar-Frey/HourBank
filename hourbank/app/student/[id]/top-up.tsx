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
import { ScreenHeader } from '../../../src/components/ScreenHeader';
import { PackageCard } from '../../../src/components/PackageCard';
import { getStudent } from '../../../src/db/students';
import { createPackage } from '../../../src/db/packages';
import { DEFAULT_PACKAGES } from '../../../src/config';
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

export default function TopUpScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [student, setStudent] = useState<Student | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(1); // 10h pre-selected
  const [customHours, setCustomHours] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('eft');
  const [reference, setReference] = useState('');
  const [proofUri, setProofUri] = useState<string | null>(null);

  useEffect(() => {
    try {
      const s = getStudent(id);
      setStudent(s);
    } catch (e) {
      console.error('Failed to load student', e);
    }
  }, [id]);

  const selectedPkg = selectedIndex < 3 ? DEFAULT_PACKAGES[selectedIndex] : null;
  const selectedHours = selectedPkg ? selectedPkg.hours : parseFloat(customHours) || 0;
  const selectedPrice = selectedPkg ? selectedPkg.price : parseFloat(customAmount) || 0;

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
    if (selectedIndex === 3) {
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

      router.back();
      Alert.alert('Credits added', `Balance is now ${formatHours(result.entry.balance_after)}.`);
    } catch (e) {
      console.error('Top-up failed', e);
      Alert.alert('Error', 'Failed to add credits. Please try again.');
    }
  };

  const monoLabel = {
    fontFamily: F.mono,
    fontSize: 10,
    color: '#8A7E72' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 4,
  };

  const firstName = student?.full_name?.split(' ')[0] ?? 'BACK';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F4EFE6' }} edges={['top']}>
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
              color: '#7A2530',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 8,
            }}
          >
            ★ ADD CREDITS
          </Text>
          <Text
            style={{ fontFamily: F.serif, fontSize: 28, color: '#1B1714', lineHeight: 32 }}
          >
            How many
          </Text>
          <Text
            style={{ fontFamily: F.serifItalic, fontSize: 28, color: '#7A2530', lineHeight: 34 }}
          >
            hours?
          </Text>
        </View>

        {/* Package grid 2×2 */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {DEFAULT_PACKAGES.map((pkg, i) => (
            <View key={i} style={{ width: '48%' }}>
              <PackageCard
                hours={pkg.hours}
                price={pkg.price}
                badge={pkg.badge}
                save={pkg.save}
                selected={selectedIndex === i}
                onPress={() => setSelectedIndex(i)}
              />
            </View>
          ))}
          {/* Custom / Other tile */}
          <View style={{ width: '48%' }}>
            <PackageCard
              hours={0}
              price={null}
              badge={null}
              save={null}
              selected={selectedIndex === 3}
              onPress={() => setSelectedIndex(3)}
              isCustom={true}
            />
          </View>
        </View>

        {/* Custom inputs — only when "Other" selected */}
        {selectedIndex === 3 && (
          <View style={{ marginTop: 12 }}>
            <Text style={monoLabel}>CUSTOM HOURS</Text>
            <TextInput
              value={customHours}
              onChangeText={setCustomHours}
              placeholder="e.g. 8"
              keyboardType="numeric"
              placeholderTextColor="#8A7E72"
              style={{
                fontFamily: F.mono,
                fontSize: 16,
                color: '#1B1714',
                borderBottomWidth: 1,
                borderBottomColor: '#D9CFBF',
                paddingVertical: 12,
              }}
            />
            <Text style={monoLabel}>CUSTOM AMOUNT (R)</Text>
            <TextInput
              value={customAmount}
              onChangeText={setCustomAmount}
              placeholder="e.g. 4500"
              keyboardType="numeric"
              placeholderTextColor="#8A7E72"
              style={{
                fontFamily: F.mono,
                fontSize: 16,
                color: '#1B1714',
                borderBottomWidth: 1,
                borderBottomColor: '#D9CFBF',
                paddingVertical: 12,
              }}
            />
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
                  backgroundColor: active ? '#1B1714' : 'transparent',
                  borderWidth: 1,
                  borderColor: active ? '#1B1714' : '#D9CFBF',
                  borderRadius: 20,
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                }}
              >
                <Text
                  style={{
                    fontFamily: F.mono,
                    fontSize: 12,
                    color: active ? '#F4EFE6' : '#1B1714',
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
          placeholderTextColor="#8A7E72"
          autoCapitalize="characters"
          style={{
            fontFamily: F.mono,
            fontSize: 16,
            color: '#1B1714',
            borderBottomWidth: 1,
            borderBottomColor: '#D9CFBF',
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
            borderColor: '#D9CFBF',
            borderRadius: 12,
            paddingHorizontal: 16,
            paddingVertical: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginTop: 4,
          }}
        >
          <Text style={{ fontFamily: F.mono, fontSize: 13, color: '#8A7E72' }}>
            {proofUri ? '✓ Image attached' : '📎 Attach image (optional)'}
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
          activeOpacity={0.85}
          style={{
            backgroundColor: '#7A2530',
            borderRadius: 16,
            paddingVertical: 16,
            alignItems: 'center',
            marginTop: 28,
          }}
        >
          <Text
            style={{
              fontFamily: F.sansMed,
              fontSize: 15,
              color: '#F4EFE6',
            }}
          >
            {`Confirm top-up · ${formatRand(selectedPrice)} ▸`}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
