import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { F, MIN_TOUCH } from '../../theme/fonts';
import { COLORS } from '../../theme/colors';
import { balanceColour, balanceStatus } from '../../utils/balance';
import { formatHours, formatScheduledTime } from '../../utils/format';
import { rosterBalanceLine, rosterStatusWord, rosterSubjectBalances, type RosterStudent } from './homeLogic';

interface Props {
  student: RosterStudent;
  onPress: () => void;
  /** Paused (on hiatus) students render muted with a PAUSED tag. */
  paused?: boolean;
}

/**
 * Roster row for Home — one card for active AND paused students so they read
 * consistently. Balance uses formatHours; the OWES label lives inside the card
 * (no separate line underneath).
 */
export function RosterStudentCard({ student, onPress, paused = false }: Props) {
  // Each subject has its own balance: the card's status is the WORST subject.
  const subjects = rosterSubjectBalances(student);
  const multi = subjects.length > 1;
  const worst = subjects.reduce((w, b) => (b.balance_hours < w.balance_hours ? b : w), subjects[0]);
  const shown = multi ? worst.balance_hours : student.current_balance;
  const status = balanceStatus(shown);
  const owes = status === 'owes';
  const colour = paused ? COLORS.inkFaint : balanceColour(status);
  const showStripe = !paused && shown < 1;
  const balanceLine = rosterBalanceLine(student);
  const subjectLabel = multi ? subjects.map(b => b.subject).join(', ') : student.subject;
  const next = student.next_session?.scheduled_for ?? null;
  const modeLabel = student.next_session?.mode === 'in_person' ? 'In-person' : 'Online';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`${student.full_name}, ${balanceLine ?? `${owes ? 'owes' : 'balance'} ${formatHours(Math.abs(shown))}`}${paused ? ', paused' : ''}`}
      style={{
        minHeight: MIN_TOUCH,
        borderWidth: 1,
        borderColor: COLORS.paperEdge,
        borderRadius: 16,
        backgroundColor: paused ? COLORS.cardFillSoft : COLORS.cardFill,
        padding: 16,
        flexDirection: 'row',
      }}
    >
      <View
        style={{
          width: 3,
          alignSelf: 'stretch',
          borderRadius: 2,
          marginRight: 12,
          backgroundColor: showStripe ? colour : COLORS.transparent,
        }}
      />
      <View style={{ flex: 1 }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: paused ? F.serifItalic : F.serif, fontSize: 16, color: paused ? COLORS.inkSoft : COLORS.ink }}
        >
          {student.full_name}
        </Text>
        <Text numberOfLines={1} style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkSoft, marginTop: 2 }}>
          {multi ? `Gr ${student.grade} · ${student.curriculum}` : `Gr ${student.grade} · ${subjectLabel} · ${student.curriculum}`}
        </Text>
        {balanceLine ? (
          <Text numberOfLines={2} style={{ fontFamily: F.mono, fontSize: 12, color: paused ? COLORS.inkFaint : COLORS.inkSoft, marginTop: 3 }}>
            {balanceLine}
          </Text>
        ) : null}
        {paused ? (
          <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, marginTop: 3, letterSpacing: 0.4 }}>
            PAUSED
          </Text>
        ) : next ? (
          <Text numberOfLines={1} style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, marginTop: 3 }}>
            {`Next: ${formatScheduledTime(next)} · ${modeLabel}`}
          </Text>
        ) : null}
      </View>
      <View
        style={{
          borderLeftWidth: 1,
          borderLeftColor: COLORS.paperEdge,
          paddingLeft: 12,
          justifyContent: 'center',
          alignItems: 'flex-end',
          minWidth: 76,
        }}
      >
        {/* Status word, never truncated (C2); the subject detail lives in the balance line. */}
        <Text
          style={{
            fontFamily: F.mono,
            fontSize: 12,
            color: paused || status === 'ok' || status === 'warn' ? COLORS.inkFaint : colour,
            letterSpacing: 1,
          }}
        >
          {rosterStatusWord(status)}
        </Text>
        <Text style={{ fontFamily: F.mono, fontSize: 20, color: colour }}>
          {formatHours(Math.abs(shown))}
        </Text>
      </View>
    </TouchableOpacity>
  );
}
