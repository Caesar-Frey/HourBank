import React from 'react';
import { View, Text, TouchableOpacity, ViewStyle } from 'react-native';
import { F } from '../theme/fonts';
import { COLORS } from '../theme/colors';
import { formatLedgerDate, formatHours } from '../utils/format';
import { ledgerDeltaColor } from '../theme/eventColors';

interface LedgerSession {
  topics: string;
}

interface LedgerEntry {
  type: 'top_up' | 'session_deduction' | 'adjustment' | 'refund';
  hours_delta: number;
  created_at: string;
  session?: LedgerSession;
}

interface LedgerRowProps {
  entry: LedgerEntry;
  onPress?: () => void;
}

function getDescription(entry: LedgerEntry): string {
  if (entry.type === 'session_deduction' && entry.session) {
    try {
      const topics: string[] = JSON.parse(entry.session.topics);
      const firstTopic = topics[0] ?? 'Session';
      return `Session — ${firstTopic}`;
    } catch {
      return 'Session';
    }
  }
  if (entry.type === 'top_up') {
    return `Top-up — ${formatHours(Math.abs(entry.hours_delta))} added`;
  }
  if (entry.type === 'adjustment') return 'Adjustment';
  if (entry.type === 'refund') return 'Refund';
  return 'Entry';
}

const ROW_STYLE: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'flex-start',
  paddingVertical: 10,
  minHeight: 44,
  borderBottomWidth: 1,
  borderBottomColor: COLORS.paperEdge,
};

export function LedgerRow({ entry, onPress }: LedgerRowProps) {
  const { day, month } = formatLedgerDate(entry.created_at);
  const description = getDescription(entry);
  const isPositive = entry.hours_delta >= 0;
  // U+2212 minus for typographic parity with "+"
  const deltaLabel = `${isPositive ? '+' : '\u2212'}${formatHours(Math.abs(entry.hours_delta))}`;
  const deltaColor = ledgerDeltaColor(entry.type, entry.hours_delta);

  const inner = (
    <>
      {/* Date column */}
      <View style={{ width: 40 }}>
        <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.ink }}>
          {day}
        </Text>
        <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint }}>
          {month}
        </Text>
      </View>

      {/* Description column */}
      <View style={{ flex: 1, paddingHorizontal: 8 }}>
        <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.ink }}>
          {description}
        </Text>
      </View>

      {/* Delta column */}
      <Text
        style={{
          fontFamily: F.monoMed,
          fontSize: 14,
          color: deltaColor,
          textAlign: 'right',
        }}
      >
        {deltaLabel}
      </Text>
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        style={ROW_STYLE}
        accessibilityRole="button"
        accessibilityLabel={`${description}, ${deltaLabel}`}
      >
        {inner}
      </TouchableOpacity>
    );
  }

  return (
    <View style={ROW_STYLE}>
      {inner}
    </View>
  );
}
