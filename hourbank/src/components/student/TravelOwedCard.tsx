/**
 * TravelOwedCard — parent travel owed (rand, in arrears) on the student page.
 * Hidden when nothing is owed and there is no travel history. Tap → travel screen.
 */
import React, { useCallback, useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { F, MIN_TOUCH } from '../../theme/fonts';
import { COLORS } from '../../theme/colors';
import { getTravelOwed, listTravelSettlements } from '../../db/travel';
import { travelOwedSummary } from '../../utils/travelBilling';

type CardState = { amount: number; lessonCount: number; since: string | null; hasHistory: boolean };

export function TravelOwedCard({ studentId, onChanged }: { studentId: string; onChanged?: () => void }) {
  const router = useRouter();
  const [state, setState] = useState<CardState | null>(null);
  const lastAmount = useRef<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      try {
        const owed = getTravelOwed(studentId);
        const hasHistory = owed.charged > 0 || listTravelSettlements(studentId).length > 0;
        setState({ amount: owed.amount, lessonCount: owed.lessonCount, since: owed.since, hasHistory });
        // Owed changed since we last looked (e.g. paid on the travel screen) → let the page refresh.
        if (lastAmount.current !== null && lastAmount.current !== owed.amount) onChanged?.();
        lastAmount.current = owed.amount;
      } catch {
        setState(null);
      }
    }, [studentId, onChanged])
  );

  if (!state || (state.amount <= 0 && !state.hasHistory)) return null;

  const owing = state.amount > 0;
  const summary = travelOwedSummary(state);

  return (
    <TouchableOpacity
      onPress={() => router.push(`/student/${studentId}/travel` as Href)}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={owing ? `Travel owed ${summary ?? ''}` : 'Travel paid up'}
      testID="travel-owed-card"
      style={{
        minHeight: MIN_TOUCH,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderWidth: 1,
        borderColor: owing ? COLORS.amber : COLORS.paperEdge,
        backgroundColor: owing ? COLORS.warnFill : COLORS.cardFill,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
    >
      <Feather name="map-pin" size={16} color={owing ? COLORS.amber : COLORS.inkSoft} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: COLORS.ink }}>
          {owing ? 'Travel owed' : 'Travel'}
        </Text>
        <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkSoft, marginTop: 2 }}>
          {owing ? summary : 'All paid up'}
        </Text>
      </View>
      <Feather name="chevron-right" size={16} color={COLORS.inkFaint} />
    </TouchableOpacity>
  );
}

export default TravelOwedCard;
