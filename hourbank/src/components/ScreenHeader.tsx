import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { F } from '../theme/fonts';

interface ScreenHeaderProps {
  backLabel?: string;
  onBack?: () => void;
  title?: string;
  rightElement?: React.ReactNode;
}

export function ScreenHeader({ backLabel, onBack, title, rightElement }: ScreenHeaderProps) {
  return (
    <View className="flex-row items-center justify-between px-6 pt-4 pb-2">
      {/* Left: back button */}
      {onBack ? (
        <TouchableOpacity onPress={onBack} activeOpacity={0.7}>
          <Text
            style={{
              fontFamily: F.mono,
              fontSize: 13,
              color: '#4A413A',
            }}
          >
            {`← ${backLabel ?? ''}`}
          </Text>
        </TouchableOpacity>
      ) : (
        <View />
      )}

      {/* Centre: title */}
      {title ? (
        <Text
          style={{
            fontFamily: F.sans,
            fontSize: 13,
            color: '#1B1714',
          }}
        >
          {title}
        </Text>
      ) : (
        <View />
      )}

      {/* Right: slot */}
      {rightElement ? rightElement : <View />}
    </View>
  );
}
