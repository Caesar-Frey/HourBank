import React from 'react';
import { Text } from 'react-native';
import { F } from '../theme/fonts';

interface VerificationBadgeProps {
  status: 'verified' | 'pending_verification' | 'disputed';
}

export function VerificationBadge({ status }: VerificationBadgeProps) {
  const config = {
    verified: { label: 'verified by parent', color: '#3F5641' },
    pending_verification: { label: 'pending verification', color: '#B8743F' },
    disputed: { label: 'disputed', color: '#9A2A2A' },
  } as const;

  const { label, color } = config[status];

  return (
    <Text
      style={{
        fontFamily: F.serifItalic,
        fontSize: 12,
        color,
      }}
    >
      {label}
    </Text>
  );
}
