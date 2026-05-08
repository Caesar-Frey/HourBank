import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { F } from '../theme/fonts';
import { COLORS } from '../theme/colors';
import { formatLedgerDate } from '../utils/format';
import { VerificationBadge } from './VerificationBadge';

interface LedgerSession {
  topics: string;
  status: 'pending_verification' | 'verified' | 'disputed' | string;
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
    const h = Math.abs(entry.hours_delta).toFixed(1);
    return `Top-up — ${h}h added`;
  }
  if (entry.type === 'adjustment') return 'Adjustment';
  if (entry.type === 'refund') return 'Refund';
  return 'Entry';
}

function isVerificationStatus(
  s: string
): s is 'pending_verification' | 'verified' | 'disputed' {
  return s === 'pending_verification' || s === 'verified' || s === 'disputed';
}

export function LedgerRow({ entry, onPress }: LedgerRowProps) {
  const { day, month } = formatLedgerDate(entry.created_at);
  const description = getDescription(entry);
  const isPositive = entry.hours_delta >= 0;
  const deltaLabel = `${isPositive ? '+' : ''}${entry.hours_delta.toFixed(1)}h`;
  const deltaColor = isPositive ? COLORS.moss : COLORS.ink;

  const sessionStatus =
    entry.session && isVerificationStatus(entry.session.status)
      ? entry.session.status
      : null;

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
        {sessionStatus && (
          <VerificationBadge status={sessionStatus} />
        )}
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
        className="border-b border-paperEdge py-2.5 flex-row items-start"
      >
        {inner}
      </TouchableOpacity>
    );
  }

  return (
    <View className="border-b border-paperEdge py-2.5 flex-row items-start">
      {inner}
    </View>
  );
}
