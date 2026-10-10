import React from 'react';
import { Text, TouchableOpacity, View, StyleProp, ViewStyle } from 'react-native';
import { COLORS } from '../../theme/colors';
import { F, MIN_TOUCH } from '../../theme/fonts';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/** Pill segmented control used by the Schedule and Money tabs. */
export function SegmentedControl<T extends string>({ options, value, onChange, style, accessibilityLabel }: Props<T>) {
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          flexDirection: 'row',
          backgroundColor: COLORS.paperDeep,
          borderRadius: 12,
          padding: 3,
          gap: 2,
        },
        style,
      ]}
    >
      {options.map(opt => {
        const selected = opt.value === value;
        return (
          <TouchableOpacity
            key={opt.value}
            onPress={() => onChange(opt.value)}
            activeOpacity={0.75}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={opt.label}
            hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
            style={{
              flex: 1,
              minHeight: MIN_TOUCH - 8,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 10,
              backgroundColor: selected ? COLORS.ink : COLORS.transparent,
            }}
          >
            <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: selected ? COLORS.paper : COLORS.inkSoft }}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
