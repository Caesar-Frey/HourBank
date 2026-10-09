import React from 'react';
import { TouchableOpacity, Text, ViewStyle } from 'react-native';
import { F } from '../theme/fonts';
import { COLORS } from '../theme/colors';

interface TopicChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  dark?: boolean;
}

// Visual height 36pt; hitSlop extends the touch target to 44pt.
const CHIP_HEIGHT = 36;
const CHIP_SLOP = { top: 4, bottom: 4, left: 2, right: 2 };

function chipStyle(selected: boolean, dark: boolean): ViewStyle {
  if (dark) {
    return selected
      ? { borderColor: COLORS.paper, backgroundColor: COLORS.paper20 }
      : { borderColor: COLORS.paper30, backgroundColor: COLORS.transparent };
  }
  return selected
    ? { borderColor: COLORS.ink, backgroundColor: COLORS.ink }
    : { borderColor: COLORS.ink, backgroundColor: COLORS.transparent };
}

export function TopicChip({ label, selected, onPress, dark = false }: TopicChipProps) {
  const textColor = dark ? COLORS.paper : selected ? COLORS.paper : COLORS.ink;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      hitSlop={CHIP_SLOP}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={{
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 14,
        minHeight: CHIP_HEIGHT,
        justifyContent: 'center',
        alignItems: 'center',
        ...chipStyle(selected, dark),
      }}
    >
      <Text
        style={{
          fontFamily: selected ? F.sansMed : F.sans,
          fontSize: 13,
          color: textColor,
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
