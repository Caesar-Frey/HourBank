import React from 'react';
import { View, Text } from 'react-native';
import { F } from '../theme/fonts';
import { balanceStatus, balanceColour } from '../utils/balance';

interface BalanceBadgeProps {
  hours: number;
  size?: 'sm' | 'lg';
}

export function BalanceBadge({ hours, size = 'sm' }: BalanceBadgeProps) {
  const status = balanceStatus(hours);
  const colour = balanceColour(status);
  const valueFontSize = size === 'lg' ? 24 : 20;

  return (
    <View>
      <Text
        style={{
          fontFamily: F.mono,
          fontSize: 9,
          color: '#8A7E72',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        BALANCE
      </Text>
      <Text
        style={{
          fontFamily: F.mono,
          fontSize: valueFontSize,
          color: colour,
        }}
      >
        {hours.toFixed(1)}h
      </Text>
    </View>
  );
}
