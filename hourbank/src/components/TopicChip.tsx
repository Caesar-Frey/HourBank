import React from 'react';
import { TouchableOpacity, Text } from 'react-native';
import { F } from '../theme/fonts';
import { COLORS } from '../theme/colors';

interface TopicChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  dark?: boolean;
}

export function TopicChip({ label, selected, onPress, dark = false }: TopicChipProps) {
  const containerStyle = dark
    ? selected
      ? 'border border-paper rounded-full px-3 py-1.5 bg-paper/10'
      : 'border border-paper/30 rounded-full px-3 py-1.5'
    : selected
    ? 'border border-ink rounded-full px-3 py-1.5 bg-ink'
    : 'border border-ink rounded-full px-3 py-1.5';

  const textColor = dark ? COLORS.paper : selected ? COLORS.paper : COLORS.ink;

  return (
    <TouchableOpacity className={containerStyle} onPress={onPress} activeOpacity={0.75}>
      <Text
        style={{
          fontFamily: selected && !dark ? F.sansMed : F.sans,
          fontSize: 13,
          color: textColor,
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
