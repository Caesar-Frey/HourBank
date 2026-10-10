import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { COLORS } from '../../theme/colors';
import { F } from '../../theme/fonts';
import { EVENT_KIND_COLORS, EVENT_KIND_LEGEND } from '../../theme/eventColors';

/** Colour key shared by every calendar view (Day / Week / Month). */
export function EventLegend() {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 14, alignItems: 'center' }}
      style={{ flexGrow: 0, marginBottom: 6 }}
      accessibilityLabel="Colour key"
    >
      {EVENT_KIND_LEGEND.map(key => {
        const s = EVENT_KIND_COLORS[key];
        return (
          <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: s.fill, borderLeftWidth: 3, borderLeftColor: s.fg }} />
            <Text
              style={{
                fontFamily: F.sans,
                fontSize: 11,
                color: COLORS.inkSoft,
                textDecorationLine: s.strike ? 'line-through' : 'none',
              }}
            >
              {s.label}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}
