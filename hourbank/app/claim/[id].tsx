import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { F } from '../../src/theme/fonts';
import { COLORS } from '../../src/theme/colors';
import { getClaim, getClaimLines, voidClaim } from '../../src/db/claims';
import { getSessionWithStudent } from '../../src/db/sessions';
import { shareClaimReport } from '../../src/utils/claimReport';
import { Claim, ClaimLine } from '../../src/db/schema';
import { formatRand, formatHours, formatLedgerDate } from '../../src/utils/format';

type DetailLine = ClaimLine & { studentName: string; endedAt: string | null };

function periodLabel(periodStart: string | null, periodEnd: string | null): string {
  if (!periodStart || !periodEnd) return 'All';
  const s = formatLedgerDate(periodStart);
  const e = formatLedgerDate(periodEnd);
  return `${s.day} ${s.month} – ${e.day} ${e.month}`;
}

function formatFullDate(isoStr: string): string {
  const d = new Date(isoStr);
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()} · ${hh}:${mm}`;
}

function modeLabel(mode: 'in_person' | 'online'): string {
  return mode === 'online' ? 'ONLINE' : 'IN-PERSON';
}

const DIVIDER = (
  <View style={{ height: 1, backgroundColor: COLORS.paperEdge, marginVertical: 16 }} />
);

export default function ClaimDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [claim, setClaim] = useState<Claim | null | undefined>(undefined);
  const [lines, setLines] = useState<DetailLine[]>([]);
  const [voidModalVisible, setVoidModalVisible] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    try {
      setClaim(getClaim(id));
      const rawLines = getClaimLines(id);
      const enriched: DetailLine[] = rawLines.map(line => {
        const session = getSessionWithStudent(line.session_id);
        return {
          ...line,
          studentName: session?.student_name ?? 'Unknown student',
          endedAt: session?.ended_at ?? null,
        };
      });
      setLines(enriched);
    } catch (e) {
      console.error('Claim detail query error', e);
      setClaim(null);
    }
  }, [id]);

  useFocusEffect(load);

  async function onDownloadReport() {
    if (!claim || downloading) return;
    setDownloading(true);
    try {
      await shareClaimReport(claim.id);
      load();
    } catch (e) {
      console.error('Claim report error', e);
      Alert.alert('Could not generate report', 'Something went wrong while creating the PDF. Please try again.');
    } finally {
      setDownloading(false);
    }
  }

  function onConfirmVoid() {
    if (!id) return;
    try {
      const reason = voidReason.trim();
      voidClaim({ claimId: id, reason: reason.length > 0 ? reason : null });
      setVoidModalVisible(false);
      setVoidReason('');
      load();
    } catch (e) {
      Alert.alert('Could not void', 'This claim is already voided or no longer exists.');
      setVoidModalVisible(false);
      load();
    }
  }

  // ── Early returns AFTER all hooks ──
  if (claim === undefined) return null;

  if (claim === null) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint }}>
            Claim not found.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const isVoid = !!claim.voided_at;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40, flexGrow: 1 }}>

        {/* Back */}
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

        <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>
          Claim · {periodLabel(claim.period_start, claim.period_end)}
        </Text>

        {/* Grand total hero */}
        <Text style={{ fontFamily: F.mono, fontSize: 40, color: isVoid ? COLORS.inkFaint : COLORS.ink, textDecorationLine: isVoid ? 'line-through' : 'none', marginBottom: 6 }}>
          {formatRand(claim.grand_total)}
        </Text>
        <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, marginBottom: 20 }}>
          {formatFullDate(claim.created_at)}
        </Text>

        {/* VOID banner */}
        {isVoid && (
          <View style={{ borderWidth: 1, borderColor: COLORS.crimson, borderRadius: 10, padding: 12, marginBottom: 20, backgroundColor: COLORS.badFill }}>
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.crimson, letterSpacing: 0.5, marginBottom: claim.void_reason ? 4 : 0 }}>
              VOIDED{claim.voided_at ? ` · ${formatLedgerDate(claim.voided_at).day} ${formatLedgerDate(claim.voided_at).month}` : ''}
            </Text>
            {claim.void_reason ? (
              <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft }}>
                {claim.void_reason}
              </Text>
            ) : null}
          </View>
        )}

        {DIVIDER}

        {/* Itemised lines */}
        <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
          Lessons ({lines.length})
        </Text>
        {lines.map(line => {
          const dateLabel = line.endedAt ? formatLedgerDate(line.endedAt) : null;
          const lineTotal = line.lesson_fee + line.travel_fee;
          return (
            <View key={line.id} style={{ borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge, paddingVertical: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ alignItems: 'center', minWidth: 32 }}>
                  <Text style={{ fontFamily: F.mono, fontSize: 16, color: COLORS.ink, lineHeight: 18 }}>{dateLabel ? dateLabel.day : '—'}</Text>
                  <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint }}>{dateLabel ? dateLabel.month : ''}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: F.serif, fontSize: 15, color: COLORS.ink }}>{line.studentName}</Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                    <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint }}>{modeLabel(line.mode)}</Text>
                    <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint }}>·</Text>
                    <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint }}>{formatHours(line.billed_hours)}</Text>
                  </View>
                </View>
                <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.ink }}>{formatRand(lineTotal)}</Text>
              </View>
              {/* Fee split */}
              <View style={{ flexDirection: 'row', gap: 14, marginTop: 6, marginLeft: 44 }}>
                <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint }}>Lesson {formatRand(line.lesson_fee)}</Text>
                <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint }}>Travel {formatRand(line.travel_fee)}</Text>
              </View>
            </View>
          );
        })}

        {/* Totals footer */}
        <View style={{ marginTop: 20, gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft }}>Lesson fees</Text>
            <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.ink }}>{formatRand(claim.lesson_fee_total)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft }}>Travel</Text>
            <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.ink }}>{formatRand(claim.travel_total)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: COLORS.paperEdge, paddingTop: 8 }}>
            <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.ink }}>Grand total</Text>
            <Text style={{ fontFamily: F.monoMed, fontSize: 16, color: COLORS.ink }}>{formatRand(claim.grand_total)}</Text>
          </View>
        </View>

        {DIVIDER}

        {/* Actions */}
        <TouchableOpacity
          onPress={onDownloadReport}
          disabled={downloading}
          activeOpacity={0.8}
          style={{ borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 12, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 12, opacity: downloading ? 0.5 : 1 }}
        >
          <Feather name="download" size={16} color={COLORS.inkSoft} />
          <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.inkSoft }}>
            {downloading ? 'Generating…' : 'Download report'}
          </Text>
        </TouchableOpacity>

        {!isVoid && (
          <TouchableOpacity
            onPress={() => setVoidModalVisible(true)}
            activeOpacity={0.8}
            style={{ borderWidth: 1, borderColor: COLORS.crimson, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
          >
            <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.crimson }}>Void claim</Text>
          </TouchableOpacity>
        )}

        {/* Claim id footer */}
        <View style={{ marginTop: 'auto', paddingTop: 40 }}>
          <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint }}>{claim.id}</Text>
        </View>
      </ScrollView>

      {/* Void confirmation modal */}
      <Modal visible={voidModalVisible} transparent animationType="fade" onRequestClose={() => setVoidModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <View style={{ backgroundColor: COLORS.paper, borderRadius: 16, padding: 24, width: '100%' }}>
            <Text style={{ fontFamily: F.serif, fontSize: 20, color: COLORS.ink, marginBottom: 8 }}>
              Void this claim?
            </Text>
            <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.inkSoft, marginBottom: 16 }}>
              The lessons return to the claimable pool. The claim stays on record, flagged as void. You can add a reason (optional).
            </Text>
            <TextInput
              value={voidReason}
              onChangeText={setVoidReason}
              placeholder="Reason (optional)"
              placeholderTextColor={COLORS.inkFaint}
              multiline
              style={{
                fontFamily: F.sans,
                fontSize: 14,
                color: COLORS.ink,
                borderWidth: 1,
                borderColor: COLORS.paperEdge,
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 10,
                minHeight: 56,
                marginBottom: 20,
              }}
            />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                onPress={() => { setVoidModalVisible(false); setVoidReason(''); }}
                activeOpacity={0.8}
                style={{ flex: 1, borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
              >
                <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.inkSoft }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onConfirmVoid}
                activeOpacity={0.8}
                style={{ flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center', backgroundColor: COLORS.crimson }}
              >
                <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.paper }}>Void</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
