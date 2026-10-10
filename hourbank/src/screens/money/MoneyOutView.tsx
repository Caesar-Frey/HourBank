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
import { formatClaimPeriod, formatLedgerDate, formatRand, pluralize } from '../../utils/format';
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
  const [error, setError] = useState(false);
  const navigating = useRef(false);

  const load = useCallback(() => {
    navigating.current = false;
    try {
      setPayout(getOutstandingPayout());
      setClaims(listClaims());
      setHints(payoutHints(getDefaultPayoutRate(), listClaimablePool()));
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
    <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
      {error ? (
        <View style={{ alignItems: 'center', paddingVertical: 24, gap: 8 }}>
          <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.crimson }}>Couldn’t load your payouts.</Text>
          <TouchableOpacity onPress={load} accessibilityRole="button" style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.oxblood }}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Text style={{ fontFamily: F.serif, fontSize: 18, color: COLORS.inkSoft, marginBottom: 6 }}>Not yet claimed</Text>
      <Text style={{ fontFamily: F.mono, fontSize: 40, color: COLORS.ink, marginBottom: 6 }} numberOfLines={1} adjustsFontSizeToFit>
        {formatRand(payout?.grandTotal ?? 0)}
      </Text>
      <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkSoft, marginBottom: 2 }}>
        Lesson fees {formatRand(payout?.lessonFeeTotal ?? 0)} · Travel {formatRand(payout?.travelTotal ?? 0)}
      </Text>
      <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkSoft, marginBottom: 16 }}>
        {lessonCount} {pluralize(lessonCount, 'lesson')} taught but not yet claimed
      </Text>

      {hints?.zeroRate ? (
        <Hint icon="alert-circle" action="Set payout rate" onAction={() => go('/profile')}>
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
        style={{
          borderRadius: 12,
          minHeight: 52,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: poolEmpty ? COLORS.paperEdge : COLORS.ink,
          marginTop: 6,
          marginBottom: poolEmpty ? 8 : 28,
        }}
      >
        <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: poolEmpty ? COLORS.inkSoft : COLORS.paper }}>New claim</Text>
      </TouchableOpacity>
      {poolEmpty ? (
        <Text style={{ fontFamily: F.serifItalic, fontSize: 13, color: COLORS.inkFaint, textAlign: 'center', marginBottom: 28 }}>
          Nothing to claim yet — finished lessons land here.
        </Text>
      ) : null}

      <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        Claim history
      </Text>
      {claims.length === 0 ? (
        <Text style={{ fontFamily: F.serifItalic, fontSize: 14, color: COLORS.inkFaint, textAlign: 'center', marginTop: 20 }}>
          No claims yet.
        </Text>
      ) : (
        claims.map(claim => {
          const { day, month } = formatLedgerDate(claim.created_at);
          const isVoid = isClaimVoided(claim);
          return (
            <TouchableOpacity
              key={claim.id}
              onPress={() => go(`/claim/${claim.id}`)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Claim ${formatClaimPeriod(claim.period_start, claim.period_end)}, ${formatRand(claim.grand_total)}${isVoid ? ', void' : ''}`}
              style={{ borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge, paddingVertical: 12, minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: 12 }}
            >
              <View style={{ alignItems: 'center', minWidth: 32 }}>
                <Text style={{ fontFamily: F.mono, fontSize: 16, color: COLORS.ink, lineHeight: 18 }}>{day}</Text>
                <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint }}>{month}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.inkSoft }} numberOfLines={1}>
                  {formatClaimPeriod(claim.period_start, claim.period_end)}
                </Text>
                <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, marginTop: 2 }}>
                  {claim.line_count} {pluralize(claim.line_count, 'lesson')}
                </Text>
              </View>
              {isVoid ? (
                <View style={{ borderWidth: 1, borderColor: COLORS.crimson, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.crimson, letterSpacing: 0.5 }}>VOID</Text>
                </View>
              ) : null}
              <Text
                style={{
                  fontFamily: F.mono,
                  fontSize: 14,
                  color: isVoid ? COLORS.inkFaint : COLORS.ink,
                  textDecorationLine: isVoid ? 'line-through' : 'none',
                }}
              >
                {formatRand(claim.grand_total)}
              </Text>
              <Feather name="chevron-right" size={14} color={COLORS.inkFaint} />
            </TouchableOpacity>
          );
        })
      )}
    </ScrollView>
  );
}
