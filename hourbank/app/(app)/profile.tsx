import React from 'react';
import { View, Text } from 'react-native';
import { F } from '../../src/theme/fonts';

export default function ProfileScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: '#F4EFE6', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: F.serif, fontSize: 24, color: '#1B1714' }}>Profile</Text>
      <Text style={{ fontFamily: F.serifItalic, fontSize: 16, color: '#8A7E72', marginTop: 8 }}>Coming in Phase 2.</Text>
    </View>
  );
}
