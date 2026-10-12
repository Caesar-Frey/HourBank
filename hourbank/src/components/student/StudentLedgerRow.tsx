import React from 'react';
import { Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { F, MIN_TOUCH } from '../../theme/fonts';
import { COLORS } from '../../theme/colors';
import { ledgerDeltaColor } from '../../theme/eventColors';
import { formatHoursSigned, formatLedgerDate } from '../../utils/format';
import { LedgerEntry } from '../../db/schema';
import { formatBalance, ledgerDescription } from './flowLogic';

interface Props {
  entry: LedgerEntry;
  /** JSON topics of the linked lesson (deductions). */
  sessionTopics?: string | null;
  /** Subject the row is booked to — pass only for multi-subject students. */
  subjectName?: string | null;
  onPress?: () => void;
}

const ROW: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  paddingVertical: 10,
  minHeight: MIN_TOUCH + 8,
  borderBottomWidth: 1,
  borderBottomColor: COLORS.paperEdge,
};

/** Ledger row for the student screens: shows adjustment reasons + running balance. */
export function StudentLedgerRow({ entry, sessionTopics, subjectName, onPress }: Props) {
  const { day, month } = formatLedgerDate(entry.created_at);
  const description = ledgerDescription(entry, sessionTopics);
  const delta = formatHoursSigned(entry.hours_delta);
  const inner = (
    <>
      <View style={{ width: 40 }}>
        <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.ink }}>{day}</Text>
        <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint }}>{month}</Text>
      </View>
      <View style={{ flex: 1, paddingHorizontal: 8 }}>
        <Text numberOfLines={2} style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.ink }}>{description}</Text>
        {subjectName ? (
          <Text numberOfLines={1} style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, marginTop: 2, textTransform: 'uppercase' }}>
            {subjectName}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontFamily: F.monoMed, fontSize: 14, color: ledgerDeltaColor(entry.type, entry.hours_delta) }}>{delta}</Text>
        <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, marginTop: 2 }}>
          {`bal ${formatBalance(entry.balance_after)}`}
        </Text>
      </View>
      {onPress ? <Feather name="chevron-right" size={14} color={COLORS.inkFaint} style={{ marginLeft: 6 }} /> : null}
    </>
  );
  if (!onPress) return <View style={ROW}>{inner}</View>;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={ROW}
      accessibilityRole="button"
      accessibilityLabel={`${subjectName ? `${subjectName}: ` : ''}${description}, ${delta}, balance ${formatBalance(entry.balance_after)}`}
    >
      {inner}
    </TouchableOpacity>
  );
}
