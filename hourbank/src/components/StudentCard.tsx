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
  const modeLabel = student.next_session?.mode === 'in_person' ? 'In-person' : 'Online';

  return (
    <TouchableOpacity
      onPress={onPress}
      className="border border-paperEdge rounded-2xl bg-white/40 p-4 flex-row"
      style={{ overflow: 'hidden' }}
      activeOpacity={0.75}
    >
      {/* Left-edge red stripe for low balance */}
      {showStripe && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 14,
            bottom: 14,
            width: 2,
            backgroundColor: '#9A2A2A',
            borderRadius: 1,
          }}
        />
      )}

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
