import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Alert, ScrollView, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { F } from '../../src/theme/fonts';
import { seedDemoData, resetDb } from '../../src/db/seed';

export const SHOW_ALL_GRADES_KEY = '@hourbank/show_all_grades';

export default function ProfileScreen() {
  const [showAllGrades, setShowAllGrades] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(SHOW_ALL_GRADES_KEY).then(v => {
      if (v === 'true') setShowAllGrades(true);
    });
  }, []);

  function handleGradesToggle(val: boolean) {
    setShowAllGrades(val);
    AsyncStorage.setItem(SHOW_ALL_GRADES_KEY, val ? 'true' : 'false');
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
    Alert.alert(
      'Reset all data?',
      'This permanently deletes every student, session, and ledger entry.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            try {
              resetDb();
              Alert.alert('Done', 'Database cleared.');
            } catch (e) {
              Alert.alert('Error', String(e));
            }
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F4EFE6' }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text style={{ fontFamily: F.serif, fontSize: 28, color: '#1B1714', marginBottom: 4 }}>Profile</Text>
        <Text style={{ fontFamily: F.serifItalic, fontSize: 15, color: '#8A7E72', marginBottom: 40 }}>
          Settings and tutor info.
        </Text>

        {/* Settings */}
        <Text style={{ fontFamily: F.mono, fontSize: 10, color: '#8A7E72', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 16 }}>
          Settings
        </Text>

        <View
          style={{
            borderWidth: 1,
            borderColor: '#D9CFBF',
            borderRadius: 14,
            backgroundColor: 'rgba(255,255,255,0.4)',
            paddingHorizontal: 16,
            paddingVertical: 14,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: '#1B1714' }}>
              Show all grades (1–12)
            </Text>
            <Text style={{ fontFamily: F.sans, fontSize: 12, color: '#8A7E72', marginTop: 2 }}>
              Off: only grades 8–12 (high school)
            </Text>
          </View>
          <Switch
            value={showAllGrades}
            onValueChange={handleGradesToggle}
            trackColor={{ false: '#D9CFBF', true: '#7A2530' }}
            thumbColor={'#F4EFE6'}
          />
        </View>

        <View style={{ height: 40 }} />

        {__DEV__ && (
          <View>
            <Text style={{ fontFamily: F.mono, fontSize: 10, color: '#8A7E72', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 16 }}>
              ⚙ Dev tools
            </Text>

            <TouchableOpacity
              onPress={handleSeed}
              activeOpacity={0.8}
              style={{
                backgroundColor: '#7A2530',
                borderRadius: 14,
                paddingVertical: 14,
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: '#F4EFE6' }}>
                Load demo data
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleReset}
              activeOpacity={0.8}
              style={{
                borderWidth: 1,
                borderColor: '#9A2A2A',
                borderRadius: 14,
                paddingVertical: 14,
                alignItems: 'center',
              }}
            >
              <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: '#9A2A2A' }}>
                Reset database
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
