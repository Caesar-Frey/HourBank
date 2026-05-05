import React from 'react';
import { TouchableOpacity, Text } from 'react-native';
import { F } from '../theme/fonts';

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
    : 'border border-paperEdge rounded-full px-3 py-1.5 bg-white/40';

  const textColor = dark ? '#F4EFE6' : selected ? '#F4EFE6' : '#1B1714';

  return (
    <TouchableOpacity className={containerStyle} onPress={onPress} activeOpacity={0.75}>
      <Text
        style={{
          fontFamily: F.sans,
          fontSize: 13,
          color: textColor,
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
