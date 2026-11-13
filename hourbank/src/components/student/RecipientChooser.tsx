/**
 * "Send to: Parent (Thandi) / Student (Amahle)" — shown above a send action
 * only when the student has both numbers. Renders nothing otherwise.
 */
import React from 'react';
import { Text, View, StyleProp, ViewStyle } from 'react-native';
import { F } from '../../theme/fonts';
import { COLORS } from '../../theme/colors';
import { SegmentedControl } from '../calendar/SegmentedControl';
import { recipientOptions, RecipientStudent } from '../../utils/recipient';
import type { PreferredContact } from '../../db/schema';

interface Props {
  student: RecipientStudent | null | undefined;
  value: PreferredContact;
  onChange: (who: PreferredContact) => void;
  style?: StyleProp<ViewStyle>;
}

export function RecipientChooser({ student, value, onChange, style }: Props) {
  const options = student ? recipientOptions(student) : [];
  if (options.length === 0) return null;
  return (
    <View style={[{ gap: 6 }, style]}>
      <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, letterSpacing: 0.5 }}>SEND TO</Text>
      <SegmentedControl options={options} value={value} onChange={onChange} accessibilityLabel="Send to" />
    </View>
  );
}
