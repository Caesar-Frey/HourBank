import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
  Switch,
  TextInput,
  Modal,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { F } from '../../src/theme/fonts';
import { COLORS } from '../../src/theme/colors';
import { seedDemoData, resetDb } from '../../src/db/seed';
import { getOrCreateTutorProfile, upsertTutorProfile, PackageTier } from '../../src/db/tutorProfile';
import { exportDatabase } from '../../src/utils/backup';

export const SHOW_ALL_GRADES_KEY = '@hourbank/show_all_grades';

const SECTION_LABEL = {
  fontFamily: F.mono,
  fontSize: 10,
  color: COLORS.inkFaint,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  marginBottom: 12,
  marginTop: 24,
};

const ROW_CONTAINER = {
  borderWidth: 1,
  borderColor: COLORS.paperEdge,
  borderRadius: 14,
  backgroundColor: 'rgba(255,255,255,0.4)',
  paddingHorizontal: 16,
  paddingVertical: 14,
  marginBottom: 8,
};

const FIELD_LABEL = {
  fontFamily: F.mono,
  fontSize: 10,
  color: COLORS.inkFaint,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.3,
  marginBottom: 4,
};

const TEXT_INPUT_STYLE = {
  fontFamily: F.sans,
  fontSize: 15,
  color: COLORS.ink,
  borderBottomWidth: 1,
  borderBottomColor: COLORS.paperEdge,
  paddingVertical: 8,
};

const MONO_INPUT_STYLE = {
  fontFamily: F.mono,
  fontSize: 15,
  color: COLORS.ink,
  borderBottomWidth: 1,
  borderBottomColor: COLORS.paperEdge,
  paddingVertical: 8,
};

export default function ProfileScreen() {
  const [showAllGrades, setShowAllGrades] = useState(false);
  const [resetConfirmVisible, setResetConfirmVisible] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');

  // Tutor profile fields
  const [fullName, setFullName] = useState('');
  const [hourlyRate, setHourlyRate] = useState('600');
  const [currency, setCurrency] = useState('ZAR');
  const [maxOweHours, setMaxOweHours] = useState('0');
  const [tierEnabled, setTierEnabled] = useState(true);
  const [tiers, setTiers] = useState<PackageTier[]>([]);
  const [travelMode, setTravelMode] = useState<'flat' | 'distance'>('flat');
  const [perKmRate, setPerKmRate] = useState('0');
  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(SHOW_ALL_GRADES_KEY).then(v => {
      if (v === 'true') setShowAllGrades(true);
    });

    try {
      const profile = getOrCreateTutorProfile();
      setFullName(profile.full_name);
      setHourlyRate(String(profile.hourly_rate));
      setCurrency(profile.currency);
      setMaxOweHours(String(profile.max_owe_hours));
      setTierEnabled(profile.tier_system_enabled === 1);
      setTravelMode(profile.travel_mode === 'distance' ? 'distance' : 'flat');
      setPerKmRate(String(profile.per_km_rate));
      try {
        const parsed: PackageTier[] = JSON.parse(profile.package_tiers);
        setTiers(Array.isArray(parsed) ? parsed : []);
      } catch {
        setTiers([]);
      }
      setProfileLoaded(true);
    } catch (e) {
      console.error('Failed to load tutor profile', e);
    }
  }, []);

  function handleGradesToggle(val: boolean) {
    setShowAllGrades(val);
    AsyncStorage.setItem(SHOW_ALL_GRADES_KEY, val ? 'true' : 'false');
  }

  const saveProfile = useCallback(() => {
    try {
      upsertTutorProfile({
        full_name: fullName.trim(),
        hourly_rate: parseFloat(hourlyRate) || 0,
        currency: currency.trim().toUpperCase().slice(0, 3) || 'ZAR',
        max_owe_hours: parseFloat(maxOweHours) || 0,
        tier_system_enabled: tierEnabled ? 1 : 0,
        package_tiers: JSON.stringify(tiers),
        travel_mode: travelMode,
        per_km_rate: parseFloat(perKmRate) || 0,
      });
      return true;
    } catch (e) {
      Alert.alert('Error', 'Could not save settings. Please try again.');
      return false;
    }
  }, [fullName, hourlyRate, currency, maxOweHours, tierEnabled, tiers, travelMode, perKmRate]);

  function handleAddTier() {
    // Derive sort_order from max(existing)+1 so it can't collide after a delete.
    const nextSortOrder =
      tiers.length > 0 ? Math.max(...tiers.map(t => t.sort_order)) + 1 : 0;
    const newTier: PackageTier = {
      hours: 0,
      price: 0,
      label: '',
      sort_order: nextSortOrder,
    };
    const updated = [...tiers, newTier];
    setTiers(updated);
  }

  // Integrity guard: a tier's displayed size derives from `hours`, which is also
  // what gets credited. Block save of nonsensical tiers (hours must be > 0,
  // price >= 0) so an unusable tier can never be persisted.
  function tiersValid(list: PackageTier[]): boolean {
    return list.every(t => t.hours > 0 && t.price >= 0);
  }

  function handleDeleteTier(index: number) {
    const updated = tiers.filter((_, i) => i !== index);
    setTiers(updated);
  }

  function handleTierChange(index: number, field: keyof PackageTier, value: string) {
    setTiers(prev => {
      const updated = [...prev];
      if (field === 'hours' || field === 'price' || field === 'sort_order') {
        updated[index] = { ...updated[index], [field]: parseFloat(value) || 0 };
      } else {
        updated[index] = { ...updated[index], [field]: value };
      }
      return updated;
    });
  }

  async function handleExport() {
    try {
      await exportDatabase();
      Alert.alert('Export', 'Database export complete.');
    } catch (e) {
      Alert.alert('Error', 'Could not export database. ' + String(e));
    }
  }

  function handleSeed() {
    try {
      seedDemoData();
      Alert.alert('Done', '6 demo students loaded. Tap Home to see them.');
    } catch (e) {
      Alert.alert('Error', String(e));
    }
  }

  function handleReset() {
    setResetConfirmText('');
    setResetConfirmVisible(true);
  }

  function confirmReset() {
    try {
      resetDb();
      setResetConfirmVisible(false);
      Alert.alert('Done', 'Database cleared.');
    } catch (e) {
      Alert.alert('Error', String(e));
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 24, paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={{ fontFamily: F.serif, fontSize: 28, color: COLORS.ink, marginBottom: 4 }}>
          Settings
        </Text>
        <Text style={{ fontFamily: F.serifItalic, fontSize: 15, color: COLORS.inkFaint, marginBottom: 8 }}>
          Tutor profile and preferences.
        </Text>

        {/* ── TUTOR section ─────────────────────────────────────────────── */}
        <Text style={SECTION_LABEL}>Tutor</Text>

        <View style={ROW_CONTAINER}>
          <Text style={FIELD_LABEL}>Name</Text>
          <TextInput
            value={fullName}
            onChangeText={setFullName}
            onBlur={saveProfile}
            placeholder="Your full name"
            placeholderTextColor={COLORS.inkFaint}
            style={TEXT_INPUT_STYLE}
            autoCorrect={false}
          />
        </View>

        <View style={ROW_CONTAINER}>
          <Text style={FIELD_LABEL}>Currency</Text>
          <TextInput
            value={currency}
            onChangeText={v => setCurrency(v.toUpperCase().slice(0, 3))}
            onBlur={saveProfile}
            placeholder="ZAR"
            placeholderTextColor={COLORS.inkFaint}
            autoCapitalize="characters"
            maxLength={3}
            style={MONO_INPUT_STYLE}
          />
        </View>

        {/* ── PAYOUT section ────────────────────────────────────────────── */}
        <Text style={SECTION_LABEL}>Payout</Text>

        <View style={ROW_CONTAINER}>
          <Text style={FIELD_LABEL}>Payout rate (per hour)</Text>
          <TextInput
            value={hourlyRate}
            onChangeText={setHourlyRate}
            onBlur={saveProfile}
            keyboardType="numeric"
            placeholder="600"
            placeholderTextColor={COLORS.inkFaint}
            style={MONO_INPUT_STYLE}
          />
          <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkFaint, marginTop: 6 }}>
            What you pay yourself per delivered hour
          </Text>
        </View>

        <View style={ROW_CONTAINER}>
          <Text style={FIELD_LABEL}>Travel mode</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            {(['flat', 'distance'] as const).map(m => (
              <TouchableOpacity
                key={m}
                onPress={() => {
                  setTravelMode(m);
                  // Save immediately — pass new value directly to avoid stale closure.
                  // upsert merges with existing, so other fields are preserved.
                  try {
                    upsertTutorProfile({ travel_mode: m, per_km_rate: parseFloat(perKmRate) || 0 });
                  } catch (e) {
                    console.error('Failed to save tutor profile', e);
                  }
                }}
                activeOpacity={0.7}
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderColor: travelMode === m ? COLORS.oxblood : COLORS.paperEdge,
                  borderRadius: 8,
                  paddingVertical: 10,
                  alignItems: 'center',
                  backgroundColor: travelMode === m ? COLORS.oxblood : 'rgba(255,255,255,0.4)',
                }}
              >
                <Text
                  style={{
                    fontFamily: F.sansMed,
                    fontSize: 13,
                    color: travelMode === m ? COLORS.paper : COLORS.inkSoft,
                  }}
                >
                  {m === 'flat' ? 'Flat' : 'Distance'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkFaint, marginTop: 8 }}>
            Flat: a set travel fee per student. Distance: charged per km travelled.
          </Text>
        </View>

        {travelMode === 'distance' && (
          <View style={ROW_CONTAINER}>
            <Text style={FIELD_LABEL}>Per-km rate</Text>
            <TextInput
              value={perKmRate}
              onChangeText={setPerKmRate}
              onBlur={saveProfile}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={COLORS.inkFaint}
              style={MONO_INPUT_STYLE}
            />
          </View>
        )}

        {/* ── CREDIT LIMITS section ─────────────────────────────────────── */}
        <Text style={SECTION_LABEL}>Credit Limits</Text>

        <View style={ROW_CONTAINER}>
          <Text style={FIELD_LABEL}>Max hours owed</Text>
          <TextInput
            value={maxOweHours}
            onChangeText={setMaxOweHours}
            onBlur={saveProfile}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={COLORS.inkFaint}
            style={MONO_INPUT_STYLE}
          />
          <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkFaint, marginTop: 6 }}>
            Max hours owed before blocking new sessions (0 = no grace)
          </Text>
        </View>

        {/* ── PACKAGE TIERS section ─────────────────────────────────────── */}
        <Text style={SECTION_LABEL}>Package Tiers</Text>

        <View
          style={{
            ...ROW_CONTAINER,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.ink }}>
              Enable tier system
            </Text>
            <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkFaint, marginTop: 2 }}>
              Show predefined packages on the top-up screen
            </Text>
          </View>
          <Switch
            value={tierEnabled}
            onValueChange={v => {
              setTierEnabled(v);
              // save immediately on toggle — pass new value directly to avoid stale closure
              try {
                upsertTutorProfile({
                  full_name: fullName.trim(),
                  hourly_rate: parseFloat(hourlyRate) || 0,
                  currency: currency.trim().toUpperCase().slice(0, 3) || 'ZAR',
                  max_owe_hours: parseFloat(maxOweHours) || 0,
                  tier_system_enabled: v ? 1 : 0,
                  package_tiers: JSON.stringify(tiers),
                });
              } catch (e) {
                console.error('Failed to save tutor profile', e);
              }
            }}
            trackColor={{ false: COLORS.paperEdge, true: COLORS.oxblood }}
            thumbColor={COLORS.paper}
          />
        </View>

        {tierEnabled && profileLoaded && (
          <View style={{ marginTop: 4 }}>
            {tiers
              .slice()
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((tier, i) => {
                const realIndex = tiers.indexOf(tier);
                return (
                  <View
                    key={i}
                    style={{
                      borderWidth: 1,
                      borderColor: COLORS.paperEdge,
                      borderRadius: 12,
                      backgroundColor: 'rgba(255,255,255,0.4)',
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      marginBottom: 8,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                      {/* Heading auto-derives from the numeric hours field — the
                          single source of truth — so it can never disagree with
                          what actually gets credited. */}
                      <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, flex: 1, textTransform: 'uppercase' }}>
                        {tier.hours > 0 ? `${tier.hours} HOURS` : 'NEW TIER'}
                      </Text>
                      <TouchableOpacity
                        onPress={() => {
                          const updated = tiers.filter((_, i) => i !== realIndex);
                          setTiers(updated);
                          // save immediately with new tiers — avoid stale closure
                          try {
                            upsertTutorProfile({
                              full_name: fullName.trim(),
                              hourly_rate: parseFloat(hourlyRate) || 0,
                              currency: currency.trim().toUpperCase().slice(0, 3) || 'ZAR',
                              max_owe_hours: parseFloat(maxOweHours) || 0,
                              tier_system_enabled: tierEnabled ? 1 : 0,
                              package_tiers: JSON.stringify(updated),
                            });
                          } catch (e) {
                            console.error('Failed to save tutor profile', e);
                          }
                        }}
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.crimson }}>
                          Delete
                        </Text>
                      </TouchableOpacity>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={FIELD_LABEL}>Hours</Text>
                        <TextInput
                          value={String(tier.hours || '')}
                          onChangeText={v => handleTierChange(realIndex, 'hours', v)}
                          onBlur={saveProfile}
                          keyboardType="numeric"
                          placeholder="10"
                          placeholderTextColor={COLORS.inkFaint}
                          style={{ fontFamily: F.mono, fontSize: 14, color: COLORS.ink, borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge, paddingVertical: 6 }}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={FIELD_LABEL}>Price</Text>
                        <TextInput
                          value={String(tier.price || '')}
                          onChangeText={v => handleTierChange(realIndex, 'price', v)}
                          onBlur={saveProfile}
                          keyboardType="numeric"
                          placeholder="5500"
                          placeholderTextColor={COLORS.inkFaint}
                          style={{ fontFamily: F.mono, fontSize: 14, color: COLORS.ink, borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge, paddingVertical: 6 }}
                        />
                      </View>
                    </View>

                    <View style={{ marginTop: 10 }}>
                      <Text style={FIELD_LABEL}>Promo label (optional)</Text>
                      <TextInput
                        value={tier.label}
                        onChangeText={v => handleTierChange(realIndex, 'label', v)}
                        onBlur={saveProfile}
                        placeholder="e.g. Best Value"
                        placeholderTextColor={COLORS.inkFaint}
                        style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.ink, borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge, paddingVertical: 6 }}
                      />
                      <Text style={{ fontFamily: F.sans, fontSize: 11, color: COLORS.inkFaint, marginTop: 6 }}>
                        Promo copy only (e.g. "Best Value"). The package size comes from Hours above — don't restate it here.
                      </Text>
                    </View>
                  </View>
                );
              })}

            <TouchableOpacity
              onPress={handleAddTier}
              activeOpacity={0.8}
              style={{
                borderWidth: 1,
                borderColor: COLORS.paperEdge,
                borderRadius: 12,
                paddingVertical: 12,
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkSoft }}>
                + Add Tier
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── APP SETTINGS section ──────────────────────────────────────── */}
        <Text style={SECTION_LABEL}>App Settings</Text>

        <View
          style={{
            ...ROW_CONTAINER,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.ink }}>
              Show all grades (1–12)
            </Text>
            <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkFaint, marginTop: 2 }}>
              Off: only grades 8–12 (high school)
            </Text>
          </View>
          <Switch
            value={showAllGrades}
            onValueChange={handleGradesToggle}
            trackColor={{ false: COLORS.paperEdge, true: COLORS.oxblood }}
            thumbColor={COLORS.paper}
          />
        </View>

        {/* Save button */}
        <TouchableOpacity
          onPress={() => {
            if (tierEnabled && !tiersValid(tiers)) {
              Alert.alert('Check package tiers', 'Every tier needs hours greater than 0 and a price of 0 or more.');
              return;
            }
            if (saveProfile()) {
              Alert.alert('Saved', 'Settings saved.');
            }
          }}
          activeOpacity={0.85}
          style={{
            backgroundColor: COLORS.ink,
            borderRadius: 14,
            paddingVertical: 14,
            alignItems: 'center',
            marginTop: 16,
            marginBottom: 8,
          }}
        >
          <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.paper }}>
            Save settings
          </Text>
        </TouchableOpacity>

        {/* ── BACKUP section ───────────────────────────────────────────── */}
        <Text style={SECTION_LABEL}>Backup</Text>

        <TouchableOpacity
          onPress={handleExport}
          activeOpacity={0.8}
          style={{
            borderWidth: 1,
            borderColor: COLORS.paperEdge,
            borderRadius: 14,
            paddingVertical: 14,
            paddingHorizontal: 16,
            marginBottom: 8,
            backgroundColor: 'rgba(255,255,255,0.4)',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View>
            <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.ink }}>
              Export database
            </Text>
            <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkFaint, marginTop: 2 }}>
              Share a copy of your database file
            </Text>
          </View>
          <Feather name="download" size={18} color={COLORS.inkSoft} />
        </TouchableOpacity>

        <View style={{ height: 16 }} />

        {/* ── DEV TOOLS section ─────────────────────────────────────────── */}
        {__DEV__ && (
          <View>
            <Text style={SECTION_LABEL}>Dev tools</Text>

            <TouchableOpacity
              onPress={handleSeed}
              activeOpacity={0.8}
              style={{
                backgroundColor: COLORS.oxblood,
                borderRadius: 14,
                paddingVertical: 14,
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.paper }}>
                Load demo data
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleReset}
              activeOpacity={0.8}
              style={{
                borderWidth: 1,
                borderColor: COLORS.crimson,
                borderRadius: 14,
                paddingVertical: 14,
                alignItems: 'center',
              }}
            >
              <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.crimson }}>
                Reset database
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Reset confirmation modal */}
      <Modal visible={resetConfirmVisible} transparent animationType="fade" onRequestClose={() => setResetConfirmVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <View style={{ backgroundColor: COLORS.paper, borderRadius: 16, padding: 24, width: '100%' }}>
            <Text style={{ fontFamily: F.serif, fontSize: 20, color: COLORS.ink, marginBottom: 8 }}>
              Reset all data?
            </Text>
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
                fontFamily: F.mono,
                fontSize: 16,
                color: COLORS.crimson,
                borderWidth: 1,
                borderColor: COLORS.crimson,
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 10,
                marginBottom: 20,
              }}
            />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                onPress={() => setResetConfirmVisible(false)}
                activeOpacity={0.8}
                style={{ flex: 1, borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
              >
                <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.inkSoft }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmReset}
                disabled={resetConfirmText !== 'RESET'}
                activeOpacity={0.8}
                style={{ flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center', backgroundColor: resetConfirmText === 'RESET' ? COLORS.crimson : COLORS.paperEdge }}
              >
                <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: resetConfirmText === 'RESET' ? COLORS.paper : COLORS.inkFaint }}>Reset</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
