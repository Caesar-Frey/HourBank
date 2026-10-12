/**
 * One subject's balance on the student page (multi-subject students):
 * name, balance hero in GeistMono with the balance status colour, and quick
 * Top up / Record / Book actions for that subject.
 */
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { F, MIN_TOUCH } from '../../theme/fonts';
import { COLORS } from '../../theme/colors';
import { balanceColour, balanceStatus } from '../../utils/balance';
import { formatHours } from '../../utils/format';
import { subjectStatusTip } from './subjectLogic';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

interface Props {
  subject: string;
  balanceHours: number;
  archived?: boolean;
  onTopUp?: () => void;
  onRecord?: () => void;
  onBook?: () => void;
}

function QuickAction({ label, icon, onPress, subject }: { label: string; icon: FeatherName; onPress: () => void; subject: string }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${subject}`}
      style={{
        flex: 1,
        minHeight: MIN_TOUCH,
        borderWidth: 1,
        borderColor: COLORS.ink,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
      }}
    >
      <Feather name={icon} size={14} color={COLORS.ink} />
      <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: COLORS.ink }}>{label}</Text>
    </TouchableOpacity>
  );
}

export function SubjectBalanceCard({ subject, balanceHours, archived = false, onTopUp, onRecord, onBook }: Props) {
  const owes = Math.round(balanceHours * 60) < 0;
  const colour = balanceColour(balanceStatus(balanceHours));
  const tip = subjectStatusTip(balanceHours);
  return (
    <View
      style={{ borderWidth: 1.5, borderColor: COLORS.ink, borderRadius: 16, padding: 16, backgroundColor: COLORS.paperDeep }}
    >
      <View
        accessible
        accessibilityLabel={`${subject}: ${owes ? 'owes' : 'balance'} ${formatHours(Math.abs(balanceHours))}${archived ? ', archived subject' : ''}`}
        style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}
      >
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={{ fontFamily: F.mono, fontSize: 10, color: owes ? COLORS.oxblood : COLORS.inkFaint, letterSpacing: 0.5 }}>
            {archived ? 'ARCHIVED SUBJECT' : owes ? '★ HOURS OWED' : '★ BALANCE'}
          </Text>
          <Text numberOfLines={1} style={{ fontFamily: F.serif, fontSize: 20, color: COLORS.ink, marginTop: 2 }}>{subject}</Text>
          {tip ? <Text style={{ fontFamily: F.serifItalic, fontSize: 12, color: COLORS.inkSoft, marginTop: 2 }}>{tip}</Text> : null}
        </View>
        <Text style={{ fontFamily: F.monoMed, fontSize: 32, color: colour, lineHeight: 38 }}>
          {formatHours(Math.abs(balanceHours))}
        </Text>
      </View>
      {!archived && (onTopUp || onRecord || onBook) ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          {onTopUp ? <QuickAction label="Top up" icon="plus" onPress={onTopUp} subject={subject} /> : null}
          {onRecord ? <QuickAction label="Record" icon="edit-3" onPress={onRecord} subject={subject} /> : null}
          {onBook ? <QuickAction label="Book" icon="calendar" onPress={onBook} subject={subject} /> : null}
        </View>
      ) : null}
    </View>
  );
}
