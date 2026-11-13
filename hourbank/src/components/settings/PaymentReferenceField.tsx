/**
 * Payment reference template editor: mono input, tap-to-insert token chips,
 * live preview against a real (or sample) student, and a 20-char bank warning.
 */
import React, { useRef } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { F, MIN_TOUCH } from '../../theme/fonts';
import { COLORS } from '../../theme/colors';
import { FIELD_LABEL, HELP_TEXT, ROW_CONTAINER } from './SettingsParts';
import {
  PAYMENT_REFERENCE_MAX,
  PAYMENT_REFERENCE_TOKENS,
  insertReferenceToken,
  previewPaymentReference,
} from '../../utils/paymentReference';

interface Props {
  value: string;
  onChangeText: (v: string) => void;
  /** Persist the template (blur or chip insert). */
  onCommit: (v: string) => void;
  sampleStudent: { id: string; full_name: string };
}

export function PaymentReferenceField({ value, onChangeText, onCommit, sampleStudent }: Props) {
  const selection = useRef<{ start: number; end: number } | null>(null);
  const preview = previewPaymentReference(value, sampleStudent);

  function insert(token: string) {
    const next = insertReferenceToken(value, token, selection.current);
    selection.current = { start: next.cursor, end: next.cursor };
    onChangeText(next.value);
    onCommit(next.value);
  }

  return (
    <View style={ROW_CONTAINER}>
      <Text style={FIELD_LABEL}>Payment reference</Text>
      <TextInput
        testID="payment-reference-template"
        accessibilityLabel="Payment reference template"
        value={value}
        onChangeText={onChangeText}
        onSelectionChange={e => { selection.current = e.nativeEvent.selection; }}
        onBlur={() => onCommit(value)}
        autoCorrect={false}
        autoCapitalize="none"
        placeholder="{first} {surname}"
        placeholderTextColor={COLORS.inkFaint}
        style={{
          fontFamily: F.mono,
          fontSize: 15,
          color: COLORS.ink,
          borderBottomWidth: 1,
          borderBottomColor: preview.tooLong ? COLORS.amber : COLORS.paperEdge,
          paddingVertical: 8,
          minHeight: MIN_TOUCH,
        }}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {PAYMENT_REFERENCE_TOKENS.map(t => (
          <TouchableOpacity
            key={t.token}
            onPress={() => insert(t.token)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Insert ${t.label}`}
            style={{
              borderWidth: 1,
              borderColor: COLORS.paperEdge,
              borderRadius: 8,
              backgroundColor: COLORS.cardFill,
              paddingHorizontal: 10,
              minHeight: 36,
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkSoft }}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkSoft, marginTop: 10 }}>
        {`Preview: ${preview.reference}`}
      </Text>
      {preview.tooLong ? (
        <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.amberText, marginTop: 4 }}>
          {'Most banks allow '}
          <Text style={{ fontFamily: F.mono }}>{PAYMENT_REFERENCE_MAX}</Text>
          {' characters — this is '}
          <Text style={{ fontFamily: F.mono }}>{preview.full.length}</Text>
          {', so it will be cut short.'}
        </Text>
      ) : null}
      <Text style={HELP_TEXT}>
        {`Added to reminders after your payment details. Preview uses ${sampleStudent.full_name}.`}
      </Text>
    </View>
  );
}
