import React from 'react';
import { View, Text, TextInput, TouchableOpacity, KeyboardTypeOptions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { F, MIN_TOUCH } from '../../theme/fonts';
import { COLORS } from '../../theme/colors';

export const SECTION_LABEL = {
  fontFamily: F.mono,
  fontSize: 12,
  color: COLORS.inkFaint,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 12,
  marginTop: 24,
} as const;

export const ROW_CONTAINER = {
  borderWidth: 1,
  borderColor: COLORS.paperEdge,
  borderRadius: 14,
  backgroundColor: COLORS.cardFill,
  paddingHorizontal: 16,
  paddingVertical: 14,
  marginBottom: 8,
} as const;

export const FIELD_LABEL = {
  fontFamily: F.mono,
  fontSize: 12,
  color: COLORS.inkFaint,
  textTransform: 'uppercase',
  letterSpacing: 0.3,
  marginBottom: 4,
} as const;

export const HELP_TEXT = { fontFamily: F.sans, fontSize: 12, color: COLORS.inkFaint, marginTop: 6 } as const;

export function SectionLabel({ children }: { children: string }) {
  return <Text style={SECTION_LABEL}>{children}</Text>;
}

export function FieldError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <Text accessibilityLiveRegion="polite" style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.crimson, marginTop: 6 }}>
      {message}
    </Text>
  );
}

/**
 * Labelled input row. `mono` for numbers (GeistMono), `preview` shows the
 * parsed value live (e.g. "= R 450.00") so SA-style input like "1,5" is never a surprise.
 */
export function SettingsField({
  label,
  value,
  onChangeText,
  onBlur,
  help,
  error,
  preview,
  placeholder,
  mono = false,
  multiline = false,
  keyboardType,
  testID,
  inputRef,
}: {
  inputRef?: React.Ref<TextInput>;
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  onBlur: () => void;
  help?: string;
  error?: string | null;
  preview?: string | null;
  placeholder?: string;
  mono?: boolean;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  testID?: string;
}) {
  return (
    <View style={ROW_CONTAINER}>
      <Text style={FIELD_LABEL}>{label}</Text>
      <TextInput
        ref={inputRef}
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        placeholder={placeholder}
        placeholderTextColor={COLORS.inkFaint}
        keyboardType={keyboardType}
        multiline={multiline}
        autoCorrect={!mono}
        style={{
          fontFamily: mono ? F.mono : F.sans,
          fontSize: 15,
          color: COLORS.ink,
          borderBottomWidth: 1,
          borderBottomColor: error ? COLORS.crimson : COLORS.paperEdge,
          paddingVertical: 8,
          minHeight: multiline ? 88 : MIN_TOUCH,
          textAlignVertical: multiline ? 'top' : 'center',
        }}
      />
      {error ? (
        <FieldError message={error} />
      ) : preview ? (
        <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkSoft, marginTop: 6 }}>{preview}</Text>
      ) : null}
      {help ? <Text style={HELP_TEXT}>{help}</Text> : null}
    </View>
  );
}

/** Tappable settings row with chevron (navigation / actions). */
export function SettingsLinkRow({
  icon,
  title,
  subtitle,
  onPress,
  disabled = false,
  busy = false,
  trailing,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  subtitle?: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || busy}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      style={{
        ...ROW_CONTAINER,
        minHeight: MIN_TOUCH + 12,
        flexDirection: 'row',
        alignItems: 'center',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Feather name={icon} size={18} color={COLORS.inkSoft} style={{ marginRight: 12 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.ink }}>{title}</Text>
        {subtitle ? (
          <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkFaint, marginTop: 2 }}>{subtitle}</Text>
        ) : null}
      </View>
      {trailing ?? <Feather name="chevron-right" size={16} color={COLORS.inkFaint} />}
    </TouchableOpacity>
  );
}

/** Row of selectable chips (≥44pt). */
export function ChipRow<T extends string | number>({
  options,
  value,
  onChange,
  format,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format: (v: T) => string;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
      {options.map(o => {
        const selected = o === value;
        return (
          <TouchableOpacity
            key={String(o)}
            onPress={() => onChange(o)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={{
              flex: 1,
              minHeight: MIN_TOUCH,
              borderWidth: 1,
              borderColor: selected ? COLORS.oxblood : COLORS.paperEdge,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: selected ? COLORS.oxblood : COLORS.cardFill,
            }}
          >
            <Text style={{ fontFamily: typeof o === 'number' ? F.mono : F.sansMed, fontSize: 13, color: selected ? COLORS.paper : COLORS.inkSoft }}>
              {format(o)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
