import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { F, MIN_TOUCH } from '../../src/theme/fonts';
import { COLORS } from '../../src/theme/colors';
import { ledgerDeltaColor } from '../../src/theme/eventColors';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { useToast } from '../../src/components/Toast';
import { getLedgerEntryById, LedgerEntryDetail } from '../../src/db/ledger';
import { getStudent } from '../../src/db/students';
import { formatDateLong, formatHours, formatHoursSigned, formatRand, formatTime } from '../../src/utils/format';
import { getTopUpReceiptText, shareTopUpReceipt } from '../../src/utils/receipt';
import { openWhatsApp } from '../../src/utils/whatsapp';
import { resolveRecipient } from '../../src/utils/recipient';
import { RecipientChooser } from '../../src/components/student/RecipientChooser';
import type { PreferredContact } from '../../src/db/schema';
import { Button, LoadingState, NotFoundState, SectionLabel } from '../../src/components/student/ui';
import { shortRef } from '../../src/components/student/flowLogic';

function balanceDisplay(h: number): { text: string; colour: string } {
  if (Math.round(h * 60) < 0) return { text: `OWES ${formatHours(-h)}`, colour: COLORS.oxblood };
  return { text: formatHours(Math.abs(h)), colour: COLORS.ink };
}

function entryTypeLabel(type: LedgerEntryDetail['type'], reason: string | null): string {
  switch (type) {
    case 'top_up': return 'TOP-UP';
    case 'session_deduction': return reason === 'No-show' ? 'NO-SHOW CHARGE' : 'LESSON';
    case 'adjustment': return 'CORRECTION';
    case 'refund': return 'REFUND';
    default: return 'ENTRY';
  }
}

function paymentMethodLabel(method: string): string {
  switch (method) {
    case 'eft': return 'EFT';
    case 'cash': return 'Cash';
    case 'card': return 'Card';
    default: return 'Other';
  }
}

function Tile({ label, value, colour }: { label: string; value: string; colour: string }) {
  return (
    <View style={{ flex: 1, borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 14, padding: 14 }}>
      <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>{label}</Text>
      <Text style={{ fontFamily: F.monoMed, fontSize: 17, color: colour }}>{value}</Text>
    </View>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft }}>{label}</Text>
      <Text style={{ fontFamily: mono ? F.mono : F.sansMed, fontSize: 13, color: COLORS.ink, flexShrink: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

const DIVIDER = <View style={{ height: 1, backgroundColor: COLORS.paperEdge, marginVertical: 16 }} />;

export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [detail, setDetail] = useState<LedgerEntryDetail | null | undefined>(undefined);
  const [proofExists, setProofExists] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [sendTo, setSendTo] = useState<PreferredContact | null>(null);
  const sharingRef = useRef(false);

  useEffect(() => {
    try {
      setDetail(id ? getLedgerEntryById(id) : null);
    } catch {
      setDetail(null);
    }
  }, [id]);

  const studentId = detail?.student_id ?? null;
  const student = useMemo(() => {
    if (!studentId) return null;
    try {
      return getStudent(studentId);
    } catch {
      return null;
    }
  }, [studentId]);

  const proofUri = detail?.package?.proof_image_uri ?? null;
  useEffect(() => {
    let cancelled = false;
    setProofExists(false);
    if (!proofUri) return;
    FileSystem.getInfoAsync(proofUri)
      .then(info => { if (!cancelled) setProofExists(info.exists); })
      .catch(() => { if (!cancelled) setProofExists(false); });
    return () => { cancelled = true; };
  }, [proofUri]);

  if (detail === undefined) return <LoadingState />;
  if (detail === null) return <NotFoundState title="Transaction not found" onBack={() => router.back()} />;

  const entry = detail;
  const isTopUp = entry.type === 'top_up';
  const balanceBefore = entry.balance_after - entry.hours_delta;
  const before = balanceDisplay(balanceBefore);
  const after = balanceDisplay(entry.balance_after);
  const pkg = entry.package;

  const recipient = student
    ? resolveRecipient(student, sendTo)
    : { phone: null, name: null, who: 'parent' as const };

  async function shareWhatsApp() {
    if (!pkg) return;
    try {
      const text = getTopUpReceiptText(pkg.id, { recipientName: recipient.name, audience: recipient.who });
      if (!text) throw new Error('missing');
      await openWhatsApp(recipient.phone, text);
    } catch {
      toast.show({ kind: 'error', message: "Couldn't prepare the confirmation" });
    }
  }

  async function sharePdf() {
    if (!pkg || sharingRef.current) return;
    sharingRef.current = true;
    setSharing(true);
    try {
      await shareTopUpReceipt(pkg.id);
    } catch {
      toast.show({ kind: 'error', message: "Couldn't create the PDF receipt" });
    } finally {
      sharingRef.current = false;
      setSharing(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top', 'bottom']}>
      <ScreenHeader backLabel="BACK" onBack={() => router.back()} title="Transaction" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48 }}>
        <View style={{ alignSelf: 'flex-start', borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 16 }}>
          <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkSoft, letterSpacing: 0.5 }}>
            {entryTypeLabel(entry.type, entry.reason)}
          </Text>
        </View>

        {entry.studentName ? (
          <TouchableOpacity
            onPress={() => router.push(`/student/${entry.student_id}`)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Open ${entry.studentName}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: MIN_TOUCH }}
          >
            <Text style={{ fontFamily: F.serif, fontSize: 26, color: COLORS.ink }}>{entry.studentName}</Text>
            <Feather name="chevron-right" size={16} color={COLORS.inkFaint} />
          </TouchableOpacity>
        ) : null}

        <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, marginBottom: 20 }}>
          {`${formatDateLong(entry.created_at)} · ${formatTime(entry.created_at)}`}
        </Text>

        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
          <Tile
            label={isTopUp ? 'Hours added' : 'Hours'}
            value={formatHoursSigned(entry.hours_delta)}
            colour={ledgerDeltaColor(entry.type, entry.hours_delta)}
          />
          {pkg ? <Tile label="Amount paid" value={formatRand(pkg.amount_paid)} colour={COLORS.ink} /> : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 8 }}>
          <Tile label="Balance before" value={before.text} colour={before.colour} />
          <Tile label="Balance after" value={after.text} colour={after.colour} />
        </View>

        {pkg ? (
          <>
            {DIVIDER}
            <SectionLabel>PAYMENT</SectionLabel>
            <View style={{ gap: 10 }}>
              <Row label="Method" value={paymentMethodLabel(pkg.payment_method)} />
              {pkg.payment_ref ? <Row label="Reference" value={pkg.payment_ref} mono /> : null}
              {pkg.amount_paid > 0 && pkg.hours_added > 0 ? (
                <Row label="Per hour" value={formatRand(pkg.amount_paid / pkg.hours_added)} mono />
              ) : null}
            </View>
            {pkg.notes ? (
              <View style={{ marginTop: 12 }}>
                <SectionLabel>NOTES</SectionLabel>
                <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.ink }}>{pkg.notes}</Text>
              </View>
            ) : null}

            {pkg.proof_image_uri ? (
              <View style={{ marginTop: 16 }}>
                <SectionLabel>PROOF OF PAYMENT</SectionLabel>
                {proofExists ? (
                  <Image
                    source={{ uri: pkg.proof_image_uri }}
                    style={{ width: '100%', height: 220, borderRadius: 12, backgroundColor: COLORS.paperDeep }}
                    resizeMode="contain"
                    accessibilityLabel="Proof of payment image"
                  />
                ) : (
                  <Text style={{ fontFamily: F.serifItalic, fontSize: 13, color: COLORS.inkFaint }}>
                    The photo is no longer on this device.
                  </Text>
                )}
              </View>
            ) : null}

            {DIVIDER}
            <SectionLabel>SEND CONFIRMATION</SectionLabel>
            <RecipientChooser student={student} value={recipient.who} onChange={setSendTo} style={{ marginBottom: 10 }} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button label="WhatsApp" icon="message-circle" variant="secondary" style={{ flex: 1 }} onPress={shareWhatsApp} />
              <Button label="PDF" icon="file-text" variant="secondary" style={{ flex: 1 }} onPress={sharePdf} busy={sharing} />
            </View>
          </>
        ) : null}

        {entry.reason && entry.reason !== 'No-show' ? (
          <>
            {DIVIDER}
            <SectionLabel>REASON</SectionLabel>
            <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.ink }}>{entry.reason}</Text>
          </>
        ) : null}

        {entry.related_session_id ? (
          <>
            {DIVIDER}
            <TouchableOpacity
              onPress={() => router.push(`/lesson/${entry.related_session_id}`)}
              activeOpacity={0.7}
              accessibilityRole="button"
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: MIN_TOUCH }}
            >
              <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.ink }}>View lesson</Text>
              <Feather name="chevron-right" size={16} color={COLORS.inkFaint} />
            </TouchableOpacity>
          </>
        ) : null}

        <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, marginTop: 32 }}>
          {`Ref ${shortRef(entry.id)}`}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
