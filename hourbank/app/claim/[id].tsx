import React, { useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { F } from '../../src/theme/fonts';
import { COLORS } from '../../src/theme/colors';
import { getClaim, getClaimLines, voidClaim, isClaimVoided, listEditedClaimLines, EditedClaimLine } from '../../src/db/claims';
import { getSessionWithStudent } from '../../src/db/sessions';
import { shareClaimReport } from '../../src/utils/claimReport';
import { Claim, ClaimLine } from '../../src/db/schema';
import { formatRand, formatHours, formatLedgerDate, formatClaimPeriod, formatDateLong, formatTime } from '../../src/utils/format';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { useToast } from '../../src/components/Toast';
import { useKeyboardOverlap } from '../../src/components/FormScreen';
import { modeLabel } from '../../src/screens/schedule/labels';
import { LoadingState } from '../../src/components/student/ui';

// Finalised claim: lines show the frozen travel fee only — a lesson's live km may
// since have been edited and would disagree with the snapshot.
type DetailLine = ClaimLine & { studentName: string; endedAt: string | null };

function formatFullDate(isoStr: string): string {
  return `${formatDateLong(isoStr)} · ${formatTime(isoStr)}`;
}

const DIVIDER = (
  <View style={{ height: 1, backgroundColor: COLORS.paperEdge, marginVertical: 16 }} />
);

export default function ClaimDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [claim, setClaim] = useState<Claim | null | undefined>(undefined);
  const [lines, setLines] = useState<DetailLine[]>([]);
  const [edited, setEdited] = useState<EditedClaimLine[]>([]);
  const voidingRef = useRef(false);
  const [voidModalVisible, setVoidModalVisible] = useState(false);
  const keyboardOverlap = useKeyboardOverlap();
  const [voidReason, setVoidReason] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const toast = useToast();

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
          // Same fallback as billableSessionDateSql: charged no-shows have no ended_at.
          endedAt: session?.ended_at ?? session?.started_at ?? session?.scheduled_for ?? null,
        };
      });
      setLines(enriched);
      try {
        setEdited(listEditedClaimLines(id));
      } catch {
        setEdited([]);
      }
      setLoadError(false);
    } catch {
      setLoadError(true);
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
    } catch {
      Alert.alert('Couldn’t create the PDF', 'The claim is saved — only the report failed. Try again; if it keeps failing, restart the app.');
    } finally {
      setDownloading(false);
    }
  }

  function onConfirmVoid() {
    if (!id || voidingRef.current) return;
    voidingRef.current = true;
    try {
      const reason = voidReason.trim();
      voidClaim({ claimId: id, reason: reason.length > 0 ? reason : null });
      setVoidModalVisible(false);
      setVoidReason('');
      toast.show({ kind: 'success', message: 'Claim voided — its lessons are claimable again' });
      load();
    } catch {
      Alert.alert('Couldn’t void this claim', 'It was already voided, or it no longer exists. The screen has been refreshed.');
      setVoidModalVisible(false);
      load();
    } finally {
      voidingRef.current = false;
    }
  }

  // ── Early returns AFTER all hooks ──
  if (claim === undefined) return <LoadingState />;

  if (claim === null) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top', 'bottom']}>
        <ScreenHeader backLabel="MONEY" onBack={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <Text style={{ fontFamily: F.serif, fontSize: 22, color: COLORS.ink, textAlign: 'center' }}>
            {loadError ? 'Couldn’t load this claim' : 'Claim not found'}
          </Text>
          <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.inkSoft, textAlign: 'center', marginTop: 8 }}>
            {loadError ? 'Go back and try again.' : 'It may have been removed by a backup restore.'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const isVoid = isClaimVoided(claim);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top', 'bottom']}>
      <ScreenHeader backLabel="MONEY" onBack={() => router.back()} title="Claim" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40, flexGrow: 1 }}>

        <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>
          Claim · {formatClaimPeriod(claim.period_start, claim.period_end)}
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
            <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.crimson, letterSpacing: 0.5, marginBottom: claim.void_reason ? 4 : 0 }}>
              VOIDED{claim.voided_at ? ` · ${formatLedgerDate(claim.voided_at).day} ${formatLedgerDate(claim.voided_at).month}` : ''}
            </Text>
            {claim.void_reason ? (
              <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft }}>
                {claim.void_reason}
              </Text>
            ) : null}
          </View>
        )}

        {/* Lessons edited after the claim was made (B4): the claim stays frozen. */}
        {!isVoid && edited.length > 0 ? (
          <View
            style={{ borderWidth: 1, borderColor: COLORS.amber, borderRadius: 10, padding: 12, marginBottom: 20, backgroundColor: COLORS.warnFill, gap: 6 }}
            testID="claim-edited-lessons"
          >
            <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.ink }}>
              <Text style={{ fontFamily: F.mono }}>{edited.length}</Text>
              {` ${edited.length === 1 ? 'lesson' : 'lessons'} edited since this claim`}
            </Text>
            <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft }}>
              The claim keeps what it was made with. Void and re-claim to pay the new amounts.
            </Text>
            {edited.map(e => (
              <TouchableOpacity
                key={e.session_id}
                onPress={() => router.push(`/lesson/${e.session_id}`)}
                accessibilityRole="link"
                accessibilityLabel={`Open ${e.student_full_name}'s edited lesson`}
                style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}
              >
                <Text style={{ flex: 1, fontFamily: F.serif, fontSize: 15, color: COLORS.ink }}>{e.student_full_name}</Text>
                <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkSoft }}>
                  {`${formatHours(e.claimed_hours)} → ${formatHours(e.current_hours)}${e.difference !== 0 ? ` · ${e.difference > 0 ? '+' : '−'}${formatRand(Math.abs(e.difference))}` : ''}`}
                </Text>
                <Feather name="chevron-right" size={16} color={COLORS.inkFaint} />
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {DIVIDER}

        {/* Itemised lines */}
        <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
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
                  <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint }}>{dateLabel ? dateLabel.month : ''}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: F.serif, fontSize: 15, color: COLORS.ink }}>{line.studentName}</Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                    <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint }}>{modeLabel(line.mode)}</Text>
                    <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint }}>·</Text>
                    <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint }}>{formatHours(line.billed_hours)}</Text>
                  </View>
                </View>
                <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.ink }}>{formatRand(lineTotal)}</Text>
              </View>
              {/* Fee split */}
              <View style={{ flexDirection: 'row', gap: 14, marginTop: 6, marginLeft: 44 }}>
                <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint }}>Lesson {formatRand(line.lesson_fee)}</Text>
                <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint }}>Travel {formatRand(line.travel_fee)}</Text>
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
          accessibilityRole="button"
          style={{ borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 12, minHeight: 48, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 12, opacity: downloading ? 0.5 : 1 }}
        >
          <Feather name="download" size={16} color={COLORS.inkSoft} />
          <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.inkSoft }}>
            {downloading ? 'Generating…' : 'Share report'}
          </Text>
        </TouchableOpacity>

        {!isVoid && (
          <TouchableOpacity
            onPress={() => setVoidModalVisible(true)}
            activeOpacity={0.8}
            accessibilityRole="button"
            style={{ borderWidth: 1, borderColor: COLORS.crimson, borderRadius: 12, minHeight: 48, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.crimson }}>Void claim</Text>
          </TouchableOpacity>
        )}

        {/* Claim id footer */}
        <View style={{ marginTop: 'auto', paddingTop: 40 }}>
          <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint }}>{claim.id}</Text>
        </View>
      </ScrollView>

      {/* Void confirmation modal */}
      <Modal visible={voidModalVisible} transparent animationType="fade" onRequestClose={() => setVoidModalVisible(false)}>
        <View
          style={{ flex: 1, backgroundColor: COLORS.scrim, justifyContent: 'center', alignItems: 'center', padding: 32, paddingBottom: 32 + keyboardOverlap }}
        >
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
