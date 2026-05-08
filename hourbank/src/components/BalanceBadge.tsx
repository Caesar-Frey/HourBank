import React from 'react';
import { View, Text } from 'react-native';
import { F } from '../theme/fonts';
import { COLORS } from '../theme/colors';
import { balanceStatus, balanceColour } from '../utils/balance';

interface BalanceBadgeProps {
  hours: number;
  size?: 'sm' | 'lg';
}

export function BalanceBadge({ hours, size = 'sm' }: BalanceBadgeProps) {
  const status = balanceStatus(hours);
  const colour = balanceColour(status);
  const valueFontSize = size === 'lg' ? 24 : 20;
  const isOwes = status === 'owes';
  const displayHours = Math.abs(hours);

  return (
    <View>
      <Text
        style={{
          fontFamily: F.mono,
          fontSize: 9,
          color: isOwes ? COLORS.oxblood : COLORS.inkFaint,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {isOwes ? 'OWES' : 'BALANCE'}
      </Text>
      <Text
        style={{
          fontFamily: F.mono,
          fontSize: valueFontSize,
          color: colour,
        }}
      >
        {displayHours.toFixed(1)}h
      </Text>
    </View>
  );
}
