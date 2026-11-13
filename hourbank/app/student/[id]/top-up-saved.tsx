/**
 * Top-up saved (M5). Shown with router.replace after a top-up, so Back from
 * here returns to the student page, not the form.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { F } from '../../../src/theme/fonts';
import { COLORS } from '../../../src/theme/colors';
import { useToast } from '../../../src/components/Toast';
import { getDb } from '../../../src/db/client';
import { getStudent } from '../../../src/db/students';
import { listTravelSettlementsForPackage } from '../../../src/db/travel';
import type { CreditPackage, PreferredContact, Student } from '../../../src/db/schema';
import { balanceColour, balanceStatus, normaliseHours } from '../../../src/utils/balance';
import { formatDateLong, formatHours, formatRand } from '../../../src/utils/format';
import { getTopUpReceiptText, shareTopUpReceipt } from '../../../src/utils/receipt';
import { openWhatsApp } from '../../../src/utils/whatsapp';
import { resolveRecipient } from '../../../src/utils/recipient';
import { Button, LoadingState, NotFoundState } from '../../../src/components/student/ui';
import { formatBalance } from '../../../src/components/student/flowLogic';

const METHOD_LABEL: Record<CreditPackage['payment_method'], string> = {
  eft: 'EFT', cash: 'Cash', card: 'Card', other: 'Other',
};

type Saved = {
  pkg: CreditPackage;
  subjectName: string | null;
  multiSubject: boolean;
  before: number;
  after: number;
  travel: number;
};

function loadSaved(packageId: string): Saved | null {
  const db = getDb();
  const pkg = db.getFirstSync<CreditPackage>('SELECT * FROM credit_packages WHERE id = ?', [packageId]);
  if (!pkg) return null;
  const entry = db.getFirstSync<{ rowid: number; created_at: string; subject_id: string | null }>(
    `SELECT rowid, created_at, subject_id FROM ledger_entries
      WHERE related_package_id = ? AND type = 'top_up' ORDER BY rowid ASC LIMIT 1`,
    [packageId]
  );
  const subjectId = pkg.subject_id ?? entry?.subject_id ?? null;
  const subj = subjectId
    ? db.getFirstSync<{ subject: string }>('SELECT subject FROM student_subjects WHERE id = ?', [subjectId])
    : null;
  const count = db.getFirstSync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM student_subjects WHERE student_id = ? AND status = 'active'`,
    [pkg.student_id]
  );
  // Credit now in this subject (the top-up is included); before = now − hours added.
  const bal = db.getFirstSync<{ balance_hours: number }>(
    'SELECT balance_hours FROM student_subject_balances WHERE subject_id = ?',
    [subjectId]
  );
  const after = normaliseHours(bal?.balance_hours ?? pkg.hours_added);
  const travel = listTravelSettlementsForPackage(packageId).reduce((s, t) => s + t.amount, 0);
  return {
    pkg,
    subjectName: subj?.subject ?? null,
    multiSubject: (count?.n ?? 0) > 1,
    before: normaliseHours(after - pkg.hours_added),
    after,
    travel,
  };
}

function Row({ label, children, last = false }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        minHeight: last ? 52 : 44,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: COLORS.paperEdge,
      }}
    >
      <Text style={{ fontFamily: F.mono, fontSize: 12, letterSpacing: 1.5, color: COLORS.inkFaint }}>{label}</Text>
      <View style={{ flexShrink: 1, alignItems: 'flex-end' }}>{children}</View>
    </View>
  );
}

export default function TopUpSavedScreen() {
  const { id, packageId, sendTo } = useLocalSearchParams<{ id: string; packageId: string; sendTo?: PreferredContact }>();
  const router = useRouter();
  const toast = useToast();
  const [student, setStudent] = useState<Student | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sharing, setSharing] = useState(false);
  const sharingRef = useRef(false);

  useEffect(() => {
    try {
      setStudent(getStudent(id));
      setSaved(loadSaved(packageId));
    } catch {
      // not-found state below
    } finally {
      setLoaded(true);
    }
  }, [id, packageId]);

  if (!loaded) return <LoadingState />;
  if (!student || !saved) return <NotFoundState title="Top-up not found" onBack={() => router.back()} />;

  const recipient = resolveRecipient(student, sendTo ?? null);
  const { pkg } = saved;

  async function sendWhatsApp() {
    try {
      const text = getTopUpReceiptText(pkg.id, { recipientName: recipient.name, audience: recipient.who });
      if (!text) throw new Error('missing package');
      await openWhatsApp(recipient.phone, text);
    } catch {
      toast.show({ kind: 'error', message: "Couldn't prepare the confirmation" });
    }
  }

  async function sharePdf() {
    if (sharingRef.current) return;
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

  const hoursWord = formatHours(pkg.hours_added);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 40, paddingBottom: 24, gap: 20 }}>
        <View style={{ gap: 10 }}>
          <View
            style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.okFill, alignItems: 'center', justifyContent: 'center' }}
          >
            <Feather name="check" size={24} color={COLORS.moss} />
          </View>
          <Text style={{ fontFamily: F.mono, fontSize: 12, letterSpacing: 1.5, color: COLORS.moss }}>TOP-UP SAVED</Text>
          <Text style={{ fontFamily: F.serif, fontSize: 32, lineHeight: 38, color: COLORS.ink }} accessibilityRole="header">
            <Text style={{ fontFamily: F.mono, fontSize: 30 }}>{hoursWord}</Text>
            {' '}
            <Text style={{ fontFamily: F.serifItalic, color: COLORS.oxblood }}>added.</Text>
          </Text>
        </View>

        <View>
          <Row label="STUDENT">
            <Text style={{ fontFamily: F.serif, fontSize: 16, color: COLORS.ink }}>{student.full_name}</Text>
          </Row>
          {saved.multiSubject && saved.subjectName ? (
            <Row label="SUBJECT">
              <Text style={{ fontFamily: F.sans, fontSize: 15, color: COLORS.ink }}>{saved.subjectName}</Text>
            </Row>
          ) : null}
          <Row label="PAID ON">
            <Text style={{ fontFamily: F.mono, fontSize: 15, color: COLORS.ink }}>{formatDateLong(pkg.created_at)}</Text>
          </Row>
          <Row label="AMOUNT">
            <Text style={{ fontFamily: F.mono, fontSize: 15, color: COLORS.ink }}>
              {`${formatRand(pkg.amount_paid)} · ${METHOD_LABEL[pkg.payment_method]}`}
            </Text>
          </Row>
          {saved.travel > 0 ? (
            <Row label="TRAVEL SETTLED">
              <Text style={{ fontFamily: F.mono, fontSize: 15, color: COLORS.ink }}>{formatRand(saved.travel)}</Text>
            </Row>
          ) : null}
          <Row label="CREDIT" last>
            <Text
              style={{ fontFamily: F.monoMed, fontSize: 18 }}
              accessibilityLabel={`Credit was ${formatBalance(saved.before)}, now ${formatBalance(saved.after)}`}
            >
              <Text style={{ color: balanceColour(balanceStatus(saved.before)) }}>{formatBalance(saved.before)}</Text>
              <Text style={{ color: COLORS.inkSoft }}>{' → '}</Text>
              <Text style={{ color: balanceColour(balanceStatus(saved.after)) }}>{formatBalance(saved.after)}</Text>
            </Text>
          </Row>
        </View>

        <View style={{ marginTop: 'auto', gap: 8 }}>
          <Text style={{ fontFamily: F.mono, fontSize: 12, letterSpacing: 1.5, color: COLORS.inkFaint }}>LET THE PARENT KNOW</Text>
          <Button label="Send confirmation on WhatsApp" icon="message-circle" onPress={sendWhatsApp} testID="top-up-saved-whatsapp" />
          <Button label="Share PDF receipt" icon="file-text" variant="secondary" onPress={sharePdf} busy={sharing} />
          <Button label="Done" variant="quiet" onPress={() => router.back()} testID="top-up-saved-done" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
