import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { F } from '../theme/fonts';
import { COLORS } from '../theme/colors';
import { formatScheduledTime } from '../utils/format';
import { BalanceBadge } from './BalanceBadge';

interface NextSession {
  scheduled_for: string;
  mode: 'in_person' | 'online';
}

interface Student {
  id: string;
  full_name: string;
  grade: number;
  subject: string;
  curriculum: string;
  current_balance: number;
  next_session: NextSession | null;
}

interface StudentCardProps {
  student: Student;
  onPress: () => void;
}

export function StudentCard({ student, onPress }: StudentCardProps) {
  const showStripe = student.current_balance < 1;
  const stripeColor = student.current_balance < 0 ? COLORS.oxblood : COLORS.crimson;
  const modeLabel = student.next_session?.mode === 'in_person' ? 'In-person' : 'Online';

  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        borderWidth: 1,
        borderColor: COLORS.paperEdge,
        borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.4)',
        padding: 16,
        flexDirection: 'row',
      }}
      activeOpacity={0.75}
    >
      <View
        style={{
          width: 3,
          alignSelf: 'stretch',
          borderRadius: 2,
          marginRight: 12,
          backgroundColor: showStripe ? stripeColor : 'transparent',
        }}
      />

      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.serif, fontSize: 16, color: COLORS.ink }}>
          {student.full_name}
        </Text>
        <Text style={{ fontFamily: F.sans, fontSize: 11, color: COLORS.inkSoft, marginTop: 2 }}>
          {`Gr ${student.grade} · ${student.subject} · ${student.curriculum}`}
        </Text>
        {student.next_session && (
          <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, marginTop: 3 }}>
            {`Next: ${formatScheduledTime(student.next_session.scheduled_for)} · ${modeLabel}`}
          </Text>
        )}
      </View>

      <View
        style={{
          borderLeftWidth: 1,
          borderLeftColor: COLORS.paperEdge,
          paddingLeft: 12,
          justifyContent: 'center',
        }}
      >
        <BalanceBadge hours={student.current_balance} size="lg" />
      </View>
    </TouchableOpacity>
  );
}
