import React from 'react';
import { View, Text, SafeAreaView } from 'react-native';
import { F } from '../../src/theme/fonts';

export default function ProfileScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F4EFE6' }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: F.mono, fontSize: 12, color: '#8A7E72', textTransform: 'uppercase' }}>
          Coming soon
        </Text>
      </View>
    </SafeAreaView>
  );
}
