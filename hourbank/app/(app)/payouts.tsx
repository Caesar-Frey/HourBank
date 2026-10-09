import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { F } from '../../src/theme/fonts';
import { COLORS } from '../../src/theme/colors';
import {
  getOutstandingPayout,
  listClaims,
  OutstandingPayout,
  ClaimSummary,
} from '../../src/db/claims';
import { formatRand, formatLedgerDate } from '../../src/utils/format';

// Period label for a claim: a date range, or "All" for a whole-pool claim.
function periodLabel(periodStart: string | null, periodEnd: string | null): string {
  if (!periodStart || !periodEnd) return 'All';
  const s = formatLedgerDate(periodStart);
  const e = formatLedgerDate(periodEnd);
  return `${s.day} ${s.month} – ${e.day} ${e.month}`;
}

export default function PayoutsScreen() {
  const router = useRouter();
  const [payout, setPayout] = useState<OutstandingPayout | null>(null);
  const [claims, setClaims] = useState<ClaimSummary[]>([]);

  const loadData = useCallback(() => {
    try {
      setPayout(getOutstandingPayout());
      setClaims(listClaims());
    } catch (e) {
      console.error('Payouts query error', e);
    }
  }, []);

  // useFocusEffect handles both initial load and reload on focus.
  useFocusEffect(loadData);

  const lessonCount = payout?.lessonCount ?? 0;
  const poolEmpty = lessonCount === 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 }}>

        {/* Eyebrow */}
        <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
          Payouts
        </Text>

        {/* Outstanding payout hero */}
        <Text style={{ fontFamily: F.serif, fontSize: 18, color: COLORS.inkSoft, marginBottom: 8 }}>
          Outstanding payout
        </Text>
        <Text style={{ fontFamily: F.mono, fontSize: 44, color: COLORS.ink, marginBottom: 6 }}>
          {formatRand(payout?.grandTotal ?? 0)}
        </Text>
        <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, marginBottom: 4 }}>
          Lesson fees {formatRand(payout?.lessonFeeTotal ?? 0)} · Travel {formatRand(payout?.travelTotal ?? 0)}
        </Text>
        <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, marginBottom: 24 }}>
          {lessonCount} {lessonCount === 1 ? 'lesson' : 'lessons'} in pool
        </Text>

        {/* New Claim CTA */}
        <TouchableOpacity
          onPress={() => router.push('/claim/new')}
          disabled={poolEmpty}
          activeOpacity={0.8}
          style={{
            borderRadius: 12,
            paddingVertical: 16,
            alignItems: 'center',
            backgroundColor: poolEmpty ? COLORS.paperEdge : COLORS.ink,
            marginBottom: poolEmpty ? 8 : 28,
          }}
        >
          <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: poolEmpty ? COLORS.inkFaint : COLORS.paper }}>
            New Claim
          </Text>
        </TouchableOpacity>
        {poolEmpty && (
          <Text style={{ fontFamily: F.serifItalic, fontSize: 13, color: COLORS.inkFaint, textAlign: 'center', marginBottom: 28 }}>
            No claimable lessons yet — complete sessions to build a claim.
          </Text>
        )}

        {/* Claim history */}
        <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Claim history
        </Text>
        {claims.length === 0 ? (
          <Text style={{ fontFamily: F.serifItalic, fontSize: 14, color: COLORS.inkFaint, textAlign: 'center', marginTop: 24 }}>
            No claims yet.
          </Text>
        ) : (
          claims.map(claim => {
            const { day, month } = formatLedgerDate(claim.created_at);
            const isVoid = !!claim.voided_at;
            return (
              <TouchableOpacity
                key={claim.id}
                onPress={() => router.push('/claim/' + claim.id)}
                activeOpacity={0.7}
                style={{ borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ alignItems: 'center', minWidth: 32 }}>
                    <Text style={{ fontFamily: F.mono, fontSize: 16, color: COLORS.ink, lineHeight: 18 }}>{day}</Text>
                    <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint }}>{month}</Text>
                  </View>
                  <View>
                    <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.inkSoft }}>
                      {periodLabel(claim.period_start, claim.period_end)}
                    </Text>
                    <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, marginTop: 2 }}>
                      {claim.line_count} {claim.line_count === 1 ? 'lesson' : 'lessons'}
                    </Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  {isVoid && (
                    <View style={{ borderWidth: 1, borderColor: COLORS.crimson, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.crimson, letterSpacing: 0.5 }}>VOID</Text>
                    </View>
                  )}
                  <Text style={{ fontFamily: F.mono, fontSize: 14, color: isVoid ? COLORS.inkFaint : COLORS.ink, textDecorationLine: isVoid ? 'line-through' : 'none' }}>
                    {formatRand(claim.grand_total)}
                  </Text>
                  <Feather name="chevron-right" size={14} color={COLORS.inkFaint} />
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
