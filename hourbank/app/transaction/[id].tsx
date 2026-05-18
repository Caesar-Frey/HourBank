import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { F } from '../../src/theme/fonts';
import { COLORS } from '../../src/theme/colors';
import { getLedgerEntryById, LedgerEntryDetail } from '../../src/db/ledger';
import { formatHours, formatRand } from '../../src/utils/format';

function formatFullDate(isoStr: string): string {
  const d = new Date(isoStr);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${days[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()} · ${hh}:${mm}`;
}

function entryTypeLabel(type: LedgerEntryDetail['type']): string {
  switch (type) {
    case 'top_up':           return 'TOP UP';
    case 'session_deduction': return 'SESSION DEDUCTION';
    case 'adjustment':       return 'ADJUSTMENT';
    case 'refund':           return 'REFUND';
  }
}

function paymentMethodLabel(method: string): string {
  switch (method) {
    case 'eft':   return 'EFT';
    case 'cash':  return 'Cash';
    case 'card':  return 'Card';
    default:      return 'Other';
  }
}

const DIVIDER = (
  <View style={{ height: 1, backgroundColor: COLORS.paperEdge, marginVertical: 16 }} />
);

export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<LedgerEntryDetail | null | undefined>(undefined);

  useEffect(() => {
    if (id) {
      setDetail(getLedgerEntryById(id));
    }
  }, [id]);

  if (detail === undefined) return null;

  if (detail === null) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint }}>
            Transaction not found.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const isTopUp = detail.type === 'top_up';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40, flexGrow: 1 }}
      >
        {/* Back button */}
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.7}
          style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}
        >
          <Feather name="arrow-left" size={16} color={COLORS.inkSoft} />
          <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkSoft, marginLeft: 6, textTransform: 'uppercase' }}>
            Back
          </Text>
        </TouchableOpacity>

        {/* Screen title */}
        <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>
          Transaction
        </Text>

        {/* Entry type badge */}
        <View style={{ alignSelf: 'flex-start', borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 20 }}>
          <Text style={{ fontFamily: F.sansMed, fontSize: 11, color: COLORS.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {entryTypeLabel(detail.type)}
          </Text>
        </View>

        {/* Student name — tappable */}
        {detail.studentName && (
          <TouchableOpacity
            onPress={() => router.push(`/student/${detail.student_id}`)}
            activeOpacity={0.7}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}
          >
            <Text style={{ fontFamily: F.serif, fontSize: 26, color: COLORS.ink }}>
              {detail.studentName}
            </Text>
            <Feather name="chevron-right" size={16} color={COLORS.inkFaint} />
          </TouchableOpacity>
        )}

        {/* Date */}
        <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, marginBottom: 24 }}>
          {formatFullDate(detail.created_at)}
        </Text>

        {/* ── TOP UP details ── */}
        {isTopUp && (
          <>
            {/* Hours + amount stat tiles */}
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 20 }}>
              <View style={{ flex: 1, borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 14, padding: 14 }}>
                <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>
                  Hours Added
                </Text>
                <Text style={{ fontFamily: F.monoMed, fontSize: 18, color: COLORS.moss }}>
                  +{formatHours(detail.hours_delta)}
                </Text>
              </View>
              {detail.package && (
                <View style={{ flex: 1, borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 14, padding: 14 }}>
                  <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>
                    Amount Paid
                  </Text>
                  <Text style={{ fontFamily: F.monoMed, fontSize: 18, color: COLORS.ink }}>
                    {formatRand(detail.package.amount_paid)}
                  </Text>
                </View>
              )}
            </View>

            {/* Balance after */}
            <View style={{ borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 14, padding: 14, marginBottom: 20 }}>
              <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>
                Balance After
              </Text>
              <Text style={{ fontFamily: F.monoMed, fontSize: 18, color: COLORS.ink }}>
                {formatHours(detail.balance_after)}
              </Text>
            </View>

            {/* Package details */}
            {detail.package && (
              <>
                {DIVIDER}
                <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 12 }}>
                  Package Details
                </Text>

                <View style={{ gap: 10 }}>
                  {/* Payment method */}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft }}>
                      Payment method
                    </Text>
                    <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: COLORS.ink }}>
                      {paymentMethodLabel(detail.package.payment_method)}
                    </Text>
                  </View>

                  {/* Payment ref */}
                  {detail.package.payment_ref && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft }}>
                        Reference
                      </Text>
                      <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.ink }}>
                        {detail.package.payment_ref}
                      </Text>
                    </View>
                  )}

                  {/* Notes */}
                  {detail.package.notes && (
                    <View style={{ marginTop: 4 }}>
                      <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>
                        Notes
                      </Text>
                      <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.ink }}>
                        {detail.package.notes}
                      </Text>
                    </View>
                  )}
                </View>
              </>
            )}

            {/* Reason (if set on ledger entry) */}
            {detail.reason && (
              <>
                {DIVIDER}
                <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>
                  Reason
                </Text>
                <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.ink }}>
                  {detail.reason}
                </Text>
              </>
            )}
          </>
        )}

        {/* ── NON-TOP-UP details ── */}
        {!isTopUp && (
          <>
            {/* Hours delta + balance after */}
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 20 }}>
              <View style={{ flex: 1, borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 14, padding: 14 }}>
                <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>
                  Hours
                </Text>
                <Text style={{ fontFamily: F.monoMed, fontSize: 18, color: detail.hours_delta < 0 ? COLORS.crimson : COLORS.moss }}>
                  {detail.hours_delta > 0 ? '+' : ''}{formatHours(detail.hours_delta)}
                </Text>
              </View>
              <View style={{ flex: 1, borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 14, padding: 14 }}>
                <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>
                  Balance After
                </Text>
                <Text style={{ fontFamily: F.monoMed, fontSize: 18, color: COLORS.ink }}>
                  {formatHours(detail.balance_after)}
                </Text>
              </View>
            </View>

            {/* Reason */}
            {detail.reason && (
              <>
                {DIVIDER}
                <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>
                  Reason
                </Text>
                <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.ink }}>
                  {detail.reason}
                </Text>
              </>
            )}

            {/* Link to related session */}
            {detail.related_session_id && detail.student_id && (
              <>
                {DIVIDER}
                <TouchableOpacity
                  onPress={() => router.push(`/student/${detail.student_id}/lesson/${detail.related_session_id}`)}
                  activeOpacity={0.7}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.ink }}>
                    View session details
                  </Text>
                  <Feather name="chevron-right" size={16} color={COLORS.inkFaint} />
                </TouchableOpacity>
              </>
            )}
          </>
        )}

        {/* Entry ID — bottom, very small */}
        <View style={{ marginTop: 'auto', paddingTop: 40 }}>
          <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint }}>
            {detail.id}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
