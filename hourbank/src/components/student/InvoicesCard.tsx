/**
 * INVOICES block on the student page (F2). Hidden until the student has one.
 * Tapping an unpaid invoice offers Record payment (the top-up screen, prefilled
 * and linked), Share again and Cancel invoice.
 */
import React, { useCallback, useRef, useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { F, MIN_TOUCH } from '../../theme/fonts';
import { COLORS } from '../../theme/colors';
import { ActionSheet, ActionSheetItem } from '../ActionSheet';
import { useToast } from '../Toast';
import {
  cancelInvoice, invoiceNumberLabel, invoiceStatusLabel, listInvoicesForStudent, type Invoice,
} from '../../db/invoices';
import { shareInvoicePdf } from '../../utils/invoicePdf';
import { formatDayShort, formatRand } from '../../utils/format';
import { SectionLabel } from './ui';

const TONE: Record<string, { fg: string; bg: string }> = {
  UNPAID: { fg: COLORS.amberText, bg: COLORS.warnFill },
  OVERDUE: { fg: COLORS.crimson, bg: COLORS.badFill },
  PAID: { fg: COLORS.moss, bg: COLORS.okFill },
  CANCELLED: { fg: COLORS.inkFaint, bg: COLORS.paperDeep },
};

export function InvoicesCard({ studentId, readOnly = false }: { studentId: string; readOnly?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [picked, setPicked] = useState<Invoice | null>(null);
  const sharingRef = useRef(false);

  const load = useCallback(() => {
    try {
      setInvoices(listInvoicesForStudent(studentId));
    } catch {
      setInvoices([]);
    }
  }, [studentId]);
  useFocusEffect(load);

  if (invoices.length === 0) return null;

  async function share(inv: Invoice) {
    if (sharingRef.current) return;
    sharingRef.current = true;
    try {
      await shareInvoicePdf(inv.id);
    } catch {
      toast.show({ kind: 'error', message: "Couldn't create the invoice PDF" });
    } finally {
      sharingRef.current = false;
    }
  }

  function confirmCancel(inv: Invoice) {
    const n = invoiceNumberLabel(inv.number);
    Alert.alert(`Cancel invoice ${n}?`, 'It stays on record as cancelled. Its number is not used again.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel invoice',
        style: 'destructive',
        onPress: () => {
          try {
            cancelInvoice(inv.id);
            toast.show({ kind: 'success', message: `Invoice ${n} cancelled` });
          } catch {
            toast.show({ kind: 'error', message: "Couldn't cancel the invoice" });
          }
          load();
        },
      },
    ]);
  }

  const items: ActionSheetItem[] = picked
    ? [
        ...(picked.status === 'unpaid' && !readOnly
          ? [{
              label: 'Record payment', icon: 'check-circle' as const,
              onPress: () => {
                const inv = picked;
                setPicked(null);
                router.push({ pathname: '/student/[id]/top-up', params: { id: studentId, invoiceId: inv.id } });
              },
            }]
          : []),
        { label: 'Share again', icon: 'share' as const, onPress: () => { const inv = picked; setPicked(null); void share(inv); } },
        ...(picked.status === 'unpaid' && !readOnly
          ? [{ label: 'Cancel invoice', icon: 'x-circle' as const, destructive: true, onPress: () => { const inv = picked; setPicked(null); confirmCancel(inv); } }]
          : []),
      ]
    : [];

  return (
    <View style={{ marginTop: 28 }}>
      <SectionLabel>INVOICES</SectionLabel>
      {invoices.map(inv => {
        const status = invoiceStatusLabel(inv);
        const tone = TONE[status];
        const n = invoiceNumberLabel(inv.number);
        return (
          <TouchableOpacity
            key={inv.id}
            onPress={() => setPicked(inv)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Invoice ${n}, ${formatRand(inv.total_rand)}, due ${formatDayShort(inv.due_at)}, ${status.toLowerCase()}`}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: MIN_TOUCH + 8,
              borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.mono, fontSize: 14, color: COLORS.ink }}>{`No. ${n}`}</Text>
              <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, marginTop: 2 }}>
                {`due ${formatDayShort(inv.due_at)}`}
              </Text>
            </View>
            <Text style={{ fontFamily: F.monoMed, fontSize: 14, color: COLORS.ink }}>{formatRand(inv.total_rand)}</Text>
            <View style={{ backgroundColor: tone.bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, minWidth: 84, alignItems: 'center' }}>
              <Text style={{ fontFamily: F.mono, fontSize: 12, letterSpacing: 0.5, color: tone.fg }}>{status}</Text>
            </View>
            <Feather name="chevron-right" size={14} color={COLORS.inkFaint} />
          </TouchableOpacity>
        );
      })}
      <ActionSheet visible={!!picked} onDismiss={() => setPicked(null)} items={items} />
    </View>
  );
}
