import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { F } from '../theme/fonts';
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
  const stripeColor = student.current_balance < 0 ? '#7A2530' : '#9A2A2A';
  const modeLabel = student.next_session?.mode === 'in_person' ? 'In-person' : 'Online';

  return (
    <TouchableOpacity
      onPress={onPress}
      className="border border-paperEdge rounded-2xl bg-white/40 p-4 flex-row"
      activeOpacity={0.75}
    >
      {/* Inline left rail — colored when low balance, transparent otherwise */}
      <View
        style={{
          width: 3,
          alignSelf: 'stretch',
          borderRadius: 2,
          marginRight: 12,
          backgroundColor: showStripe ? stripeColor : 'transparent',
        }}
      />

      {/* Left content */}
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: F.serif,
            fontSize: 16,
            color: '#1B1714',
          }}
        >
          {student.full_name}
        </Text>
        <Text
          style={{
            fontFamily: F.sans,
            fontSize: 11,
            color: '#4A413A',
            marginTop: 2,
          }}
        >
          {`Gr ${student.grade} · ${student.subject} · ${student.curriculum}`}
        </Text>
        {student.next_session && (
          <Text
            style={{
              fontFamily: F.mono,
              fontSize: 10,
              color: '#8A7E72',
              marginTop: 3,
            }}
          >
            {`Next: ${formatScheduledTime(student.next_session.scheduled_for)} · ${modeLabel}`}
          </Text>
        )}
      </View>

      {/* Right: balance badge separated by a vertical line */}
      <View
        className="border-l border-paperEdge pl-3"
        style={{ justifyContent: 'center' }}
      >
        <BalanceBadge hours={student.current_balance} size="lg" />
      </View>
    </TouchableOpacity>
  );
}
