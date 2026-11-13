/**
 * Settings › Invoice details (F2, mockup M9). What goes on invoices and the
 * other documents. Nothing here is ever committed to the repo: the tutor
 * enters it on the device. Each field saves when it loses focus.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Image, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { F, MIN_TOUCH } from '../../src/theme/fonts';
import { COLORS } from '../../src/theme/colors';
import { FormScreen } from '../../src/components/FormScreen';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { useToast } from '../../src/components/Toast';
import {
  getInvoiceSettings, highestInvoiceNumber, invoiceNumberLabel, isInvoiceError, updateInvoiceSettings, InvoiceSettings,
} from '../../src/db/invoices';
import { shareSampleInvoicePdf } from '../../src/utils/invoicePdf';
import { Button, FieldError, FieldHint, LoadingState, PageHeading, SectionLabel, Stepper } from '../../src/components/student/ui';

/** Logos are stored in the database (so backups carry them); keep them small. */
const MAX_LOGO_BASE64 = 1_500_000;

type TextKey =
  | 'business_name' | 'business_reg_no' | 'business_phone' | 'business_email' | 'business_address'
  | 'bank_account_holder' | 'bank_name' | 'bank_account_no' | 'bank_branch_code' | 'bank_swift';

const INPUT = {
  minHeight: 48,
  borderWidth: 1,
  borderColor: COLORS.paperEdge,
  borderRadius: 10,
  backgroundColor: COLORS.cardFill,
  paddingHorizontal: 14,
  fontSize: 16,
  color: COLORS.ink,
} as const;

export default function InvoiceSettingsScreen() {
  const router = useRouter();
  const toast = useToast();
  const [s, setS] = useState<InvoiceSettings | null>(null);
  const [draft, setDraft] = useState<Record<TextKey, string>>({} as Record<TextKey, string>);
  const [nextNumber, setNextNumber] = useState('');
  const [numberError, setNumberError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewRef = useRef(false);

  useEffect(() => {
    try {
      const v = getInvoiceSettings();
      setS(v);
      const d = {} as Record<TextKey, string>;
      (Object.keys(v) as Array<keyof InvoiceSettings>).forEach(k => {
        if (k !== 'logo_data_uri' && k !== 'invoice_next_number' && k !== 'invoice_due_days') d[k as TextKey] = (v[k] as string | null) ?? '';
      });
      setDraft(d);
      setNextNumber(String(v.invoice_next_number));
    } catch {
      toast.show({ kind: 'error', message: "Couldn't load your invoice details" });
    }
    // Load once: re-running would overwrite what the tutor is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!s) return <LoadingState />;

  function saveText(key: TextKey) {
    try {
      setS(updateInvoiceSettings({ [key]: draft[key] }));
    } catch {
      toast.show({ kind: 'error', message: "Couldn't save that" });
    }
  }

  function field(key: TextKey, placeholder: string, opts: { mono?: boolean; numeric?: boolean; flex?: number; label?: string; email?: boolean; multiline?: boolean } = {}) {
    return (
      <TextInput
        value={draft[key] ?? ''}
        onChangeText={t => setDraft(d => ({ ...d, [key]: t }))}
        onBlur={() => saveText(key)}
        placeholder={placeholder}
        placeholderTextColor={COLORS.inkFaint}
        accessibilityLabel={opts.label ?? placeholder}
        keyboardType={opts.numeric ? 'number-pad' : opts.email ? 'email-address' : 'default'}
        autoCapitalize={opts.email ? 'none' : 'sentences'}
        multiline={opts.multiline}
        style={{
          ...INPUT,
          fontFamily: opts.mono ? F.mono : F.sans,
          fontSize: opts.mono ? 15 : 16,
          ...(opts.flex ? { flex: opts.flex, minWidth: 0 } : null),
          ...(opts.multiline ? { paddingVertical: 12, textAlignVertical: 'top' as const } : null),
        }}
      />
    );
  }

  async function pickLogo() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6, base64: true });
      const a = result.canceled ? null : result.assets[0];
      if (!a?.base64) return;
      if (a.base64.length > MAX_LOGO_BASE64) {
        toast.show({ kind: 'error', message: 'That image is too large. Pick a smaller logo.' });
        return;
      }
      const mime = a.mimeType && /^image\/(png|jpe?g|webp)$/.test(a.mimeType) ? a.mimeType : 'image/jpeg';
      setS(updateInvoiceSettings({ logo_data_uri: `data:${mime};base64,${a.base64}` }));
    } catch {
      toast.show({ kind: 'error', message: "Couldn't open your photos" });
    }
  }

  function saveNumber() {
    const n = Number(nextNumber.trim());
    if (!Number.isInteger(n) || n < 1) {
      setNumberError('Enter a whole number, 1 or more.');
      return;
    }
    if (n === s!.invoice_next_number) { setNumberError(null); return; }
    try {
      setS(updateInvoiceSettings({ invoice_next_number: n }));
      setNumberError(null);
    } catch (e) {
      const highest = highestInvoiceNumber();
      setNumberError(isInvoiceError(e) && e.code === 'NUMBER_TAKEN'
        ? `Invoice ${invoiceNumberLabel(highest)} is already used. Pick ${highest + 1} or higher.`
        : "Couldn't save the number.");
    }
  }

  function setDueDays(d: number) {
    try {
      setS(updateInvoiceSettings({ invoice_due_days: d }));
    } catch {
      toast.show({ kind: 'error', message: "Couldn't save that" });
    }
  }

  async function preview() {
    if (previewRef.current) return;
    previewRef.current = true;
    setPreviewing(true);
    try {
      await shareSampleInvoicePdf();
    } catch {
      toast.show({ kind: 'error', message: "Couldn't create the sample invoice" });
    } finally {
      previewRef.current = false;
      setPreviewing(false);
    }
  }

  const days = s.invoice_due_days;

  return (
    <FormScreen
      edges={['top', 'bottom']}
      header={<ScreenHeader backLabel="SETTINGS" onBack={() => router.back()} />}
      footer={<Button label="Preview a sample invoice" icon="file-text" variant="secondary" onPress={preview} busy={previewing} />}
    >
      <PageHeading eyebrow="INVOICE DETAILS" line1="What goes on" line2="your invoices." />

      <View
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: COLORS.paperEdge,
          borderRadius: 14, backgroundColor: COLORS.cardFill, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 20,
        }}
      >
        <View
          style={{
            width: 96, height: 48, borderRadius: 6, borderWidth: s.logo_data_uri ? 0 : 1, borderStyle: 'dashed',
            borderColor: COLORS.inkFaint, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          }}
        >
          {s.logo_data_uri ? (
            <Image source={{ uri: s.logo_data_uri }} style={{ width: 96, height: 48 }} resizeMode="contain" accessibilityLabel="Your logo" />
          ) : (
            <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkSoft }}>Logo</Text>
          )}
        </View>
        <Text style={{ flex: 1, fontFamily: F.sans, fontSize: 14, color: COLORS.inkSoft }}>Shown top left on every document</Text>
        <View>
          <TouchableOpacity onPress={pickLogo} accessibilityRole="button" style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.oxblood }}>{s.logo_data_uri ? 'Change' : 'Choose'}</Text>
          </TouchableOpacity>
          {s.logo_data_uri ? (
            <TouchableOpacity
              onPress={() => setS(updateInvoiceSettings({ logo_data_uri: null }))}
              accessibilityRole="button"
              accessibilityLabel="Remove logo"
              style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft }}>Remove</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View style={{ gap: 8, marginBottom: 20 }}>
        <SectionLabel style={{ marginBottom: 0 }}>BUSINESS NAME</SectionLabel>
        {field('business_name', 'As registered, or your own name', { label: 'Business name' })}
        {field('business_reg_no', 'Registration number (optional)')}
      </View>

      <View style={{ gap: 8, marginBottom: 20 }}>
        <SectionLabel style={{ marginBottom: 0 }}>PHONE · EMAIL · ADDRESS</SectionLabel>
        {field('business_phone', 'Phone', { numeric: true })}
        {field('business_email', 'Email', { email: true })}
        {field('business_address', 'Address', { multiline: true })}
      </View>

      <View style={{ gap: 8, marginBottom: 20 }}>
        <SectionLabel style={{ marginBottom: 0 }}>PAYMENT TO</SectionLabel>
        {field('bank_account_holder', 'Account holder')}
        {field('bank_name', 'Bank', { label: 'Bank name' })}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {field('bank_account_no', 'Account no.', { mono: true, numeric: true, flex: 3, label: 'Account number' })}
          {field('bank_branch_code', 'Branch', { mono: true, numeric: true, flex: 2, label: 'Branch code' })}
        </View>
        {field('bank_swift', 'BIC/SWIFT (optional)', { mono: true })}
        <FieldHint>When filled in, these also go on WhatsApp top-up reminders.</FieldHint>
      </View>

      <View style={{ borderTopWidth: 1, borderTopColor: COLORS.paperEdge, paddingVertical: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 52 }}>
          <Text style={{ fontFamily: F.sans, fontSize: 15, color: COLORS.ink }}>Next invoice number</Text>
          <TextInput
            value={nextNumber}
            onChangeText={t => { setNextNumber(t.replace(/[^0-9]/g, '')); setNumberError(null); }}
            onBlur={saveNumber}
            keyboardType="number-pad"
            accessibilityLabel="Next invoice number"
            style={{ ...INPUT, minWidth: 96, textAlign: 'right', fontFamily: F.monoMed }}
          />
        </View>
        <FieldError message={numberError} />
        <FieldHint>Continue your existing numbering. A number can never be used twice.</FieldHint>
      </View>
      <View
        style={{
          flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 52,
          borderTopWidth: 1, borderBottomWidth: 1, borderColor: COLORS.paperEdge, paddingVertical: 8, marginBottom: 12,
        }}
      >
        <Text style={{ fontFamily: F.sans, fontSize: 15, color: COLORS.ink }}>Payment due after</Text>
        <Stepper
          value={`${days} ${days === 1 ? 'day' : 'days'}`}
          onDecrement={() => setDueDays(Math.max(0, days - 1))}
          onIncrement={() => setDueDays(Math.min(365, days + 1))}
          canDecrement={days > 0}
          accessibilityLabel="days until payment is due"
        />
      </View>
    </FormScreen>
  );
}
