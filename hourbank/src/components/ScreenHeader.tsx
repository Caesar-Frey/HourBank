import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { F } from '../theme/fonts';
import { COLORS } from '../theme/colors';

interface ScreenHeaderProps {
  backLabel?: string;
  onBack?: () => void;
  title?: string;
  rightElement?: React.ReactNode;
}

export function ScreenHeader({ backLabel, onBack, title, rightElement }: ScreenHeaderProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 }}>
      {onBack ? (
        <TouchableOpacity onPress={onBack} activeOpacity={0.7}>
          <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.inkSoft }}>
            {`← ${backLabel ?? ''}`}
          </Text>
        </TouchableOpacity>
      ) : (
        <View />
      )}

      {title ? (
        <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.ink }}>
          {title}
        </Text>
      ) : (
        <View />
      )}

      {rightElement ? rightElement : <View />}
    </View>
  );
}
