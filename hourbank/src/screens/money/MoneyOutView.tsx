/**
 * Money → Out: what the tutor can still claim (payout pool) and claim history.
 */
import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { COLORS } from '../../theme/colors';
import { F, MIN_TOUCH } from '../../theme/fonts';
import {
  ClaimSummary,
  OutstandingPayout,
  getDefaultPayoutRate,
  getOutstandingPayout,
  isClaimVoided,
  listClaimablePool,
  listClaims,
} from '../../db/claims';
import { formatClaimPeriod, formatDayShort, formatHours, formatRand, pluralize } from '../../utils/format';
import { PayoutHints, payoutHints } from './moneyModel';

function Hint({ icon, children, action, onAction }: { icon: React.ComponentProps<typeof Feather>['name']; children: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, backgroundColor: COLORS.paperDeep, borderRadius: 10, padding: 12, marginBottom: 10 }}>
      <Feather name={icon} size={15} color={COLORS.oxblood} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft, lineHeight: 18 }}>{children}</Text>
        {action && onAction ? (
          <TouchableOpacity onPress={onAction} accessibilityRole="button" style={{ minHeight: 32, justifyContent: 'center', alignSelf: 'flex-start' }}>
            <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: COLORS.oxblood }}>{action} →</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

export function MoneyOutView() {
  const router = useRouter();
  const [payout, setPayout] = useState<OutstandingPayout | null>(null);
  const [claims, setClaims] = useState<ClaimSummary[]>([]);
  const [hints, setHints] = useState<PayoutHints | null>(null);
  const [poolStats, setPoolStats] = useState<{ hours: number; trips: number }>({ hours: 0, trips: 0 });
  const [error, setError] = useState(false);
  const navigating = useRef(false);

  const load = useCallback(() => {
    navigating.current = false;
    try {
      setPayout(getOutstandingPayout());
      setClaims(listClaims());
      const pool = listClaimablePool();
      setHints(payoutHints(getDefaultPayoutRate(), pool));
      setPoolStats({
        hours: pool.reduce((sum, l) => sum + l.billed_hours, 0),
        trips: pool.filter(l => l.travel_fee > 0).length,
      });
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useFocusEffect(load);

  function go(href: string) {
    if (navigating.current) return;
    navigating.current = true;
    router.push(href as Href);
  }

  const lessonCount = payout?.lessonCount ?? 0;
  const poolEmpty = lessonCount === 0;

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
      {error ? (
        <View style={{ alignItems: 'center', paddingVertical: 24, gap: 8 }}>
          <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.crimson }}>Couldn’t load your payouts.</Text>
          <TouchableOpacity onPress={load} accessibilityRole="button" style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.oxblood }}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* My claims hero (M6) */}
      <View style={{ borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 16, backgroundColor: COLORS.cardFill, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 16, gap: 6, marginBottom: 24 }}>
        <Text style={{ fontFamily: F.mono, fontSize: 12, letterSpacing: 1.5, color: COLORS.oxblood }}>NOT YET CLAIMED</Text>
        <Text style={{ fontFamily: F.monoMed, fontSize: 38, lineHeight: 46, color: COLORS.ink }} numberOfLines={1} adjustsFontSizeToFit testID="money-unclaimed">
          {formatRand(payout?.grandTotal ?? 0)}
        </Text>
        <Text style={{ fontFamily: F.sans, fontSize: 14, lineHeight: 20, color: COLORS.inkSoft }}>
          {poolEmpty ? 'Nothing to claim yet. Finished lessons land here.' : (
            <>
              <Text style={{ fontFamily: F.mono, fontSize: 13 }}>{lessonCount}</Text>
              {` ${pluralize(lessonCount, 'lesson')} you have taught and not paid yourself for.`}
            </>
          )}
        </Text>
        {poolEmpty ? null : (
          <View style={{ marginTop: 6, borderTopWidth: 1, borderTopColor: COLORS.paperEdge }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 36 }}>
              <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.inkSoft }}>
                {'Lesson fees · '}
                <Text style={{ fontFamily: F.mono, fontSize: 13 }}>{formatHours(poolStats.hours)}</Text>
              </Text>
              <Text style={{ fontFamily: F.mono, fontSize: 14, color: COLORS.ink }}>{formatRand(payout?.lessonFeeTotal ?? 0)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 36 }}>
              <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.inkSoft }}>
                {'Travel allowance · '}
                <Text style={{ fontFamily: F.mono, fontSize: 13 }}>{poolStats.trips}</Text>
                {` ${pluralize(poolStats.trips, 'trip')}`}
              </Text>
              <Text style={{ fontFamily: F.mono, fontSize: 14, color: COLORS.ink }}>{formatRand(payout?.travelTotal ?? 0)}</Text>
            </View>
          </View>
        )}

        {hints?.zeroRate ? (
          <Hint icon="alert-circle" action="Set payout rate" onAction={() => go('/profile?focus=rates')}>
            Your payout rate is R 0, so every lesson is priced at R 0.00. Set it in Settings.
          </Hint>
        ) : null}
        {hints && hints.inPersonWithoutTravel > 0 ? (
          <Hint icon="map-pin">
            {`${hints.inPersonWithoutTravel} in-person ${pluralize(hints.inPersonWithoutTravel, 'lesson')} ${hints.inPersonWithoutTravel === 1 ? 'has' : 'have'} no travel fee. If you charge travel, add it on the student’s edit page.`}
          </Hint>
        ) : null}

        <TouchableOpacity
          onPress={() => go('/claim/new')}
          disabled={poolEmpty}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ disabled: poolEmpty }}
          testID="money-start-claim"
          style={{
            borderRadius: 14,
            minHeight: 52,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: poolEmpty ? COLORS.paperEdge : COLORS.oxblood,
            marginTop: 6,
          }}
        >
          <Text style={{ fontFamily: F.sansMed, fontSize: 16, color: poolEmpty ? COLORS.inkSoft : COLORS.paper }}>Start a claim</Text>
        </TouchableOpacity>
        <Text style={{ fontFamily: F.sans, fontSize: 13, lineHeight: 18, color: COLORS.inkFaint }}>
          A claim records what you pay yourself and makes a report. HourBank does not move money; do the transfer in your banking app.
        </Text>
      </View>

      <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, letterSpacing: 1.5, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge }}>
        PAST CLAIMS
      </Text>
      {claims.length === 0 ? (
        <Text style={{ fontFamily: F.serifItalic, fontSize: 14, color: COLORS.inkFaint, textAlign: 'center', marginTop: 20 }}>
          No claims yet.
        </Text>
      ) : (
        claims.map(claim => {
          const isVoid = isClaimVoided(claim);
          const period = formatClaimPeriod(claim.period_start, claim.period_end);
          return (
            <TouchableOpacity
              key={claim.id}
              onPress={() => go(`/claim/${claim.id}`)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Claim ${period}, ${formatRand(claim.grand_total)}${isVoid ? ', voided' : ''}`}
              style={{ borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge, paddingVertical: 10, minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12 }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text
                  style={{ fontFamily: F.mono, fontSize: 14, color: isVoid ? COLORS.inkFaint : COLORS.ink, textDecorationLine: isVoid ? 'line-through' : 'none' }}
                  numberOfLines={1}
                >
                  {period}
                </Text>
                {isVoid ? (
                  <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkFaint }}>Voided · lessons returned to the pool</Text>
                ) : (
                  <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft }}>
                    <Text style={{ fontFamily: F.mono, fontSize: 12 }}>{claim.line_count}</Text>
                    {` ${pluralize(claim.line_count, 'lesson')} · claimed `}
                    <Text style={{ fontFamily: F.mono, fontSize: 12 }}>{formatDayShort(claim.created_at)}</Text>
                  </Text>
                )}
              </View>
              <Text
                style={{
                  fontFamily: F.mono,
                  fontSize: 15,
                  color: isVoid ? COLORS.inkFaint : COLORS.ink,
                  textDecorationLine: isVoid ? 'line-through' : 'none',
                }}
              >
                {formatRand(claim.grand_total)}
              </Text>
              <Feather name="chevron-right" size={16} color={COLORS.inkFaint} />
            </TouchableOpacity>
          );
        })
      )}
    </ScrollView>
  );
}
