/**
 * Small shared building blocks for the student & money screens.
 * Inline styles + tokens only (no className, no literal colours).
 */
import React from 'react';
import { ActivityIndicator, Text, TextStyle, TouchableOpacity, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { F, MIN_TOUCH, hitSlopFor } from '../../theme/fonts';
import { COLORS } from '../../theme/colors';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

export const LABEL: TextStyle = {
  fontFamily: F.mono,
  fontSize: 11,
  color: COLORS.inkFaint,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 6,
};

export function SectionLabel({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[LABEL, style]}>{children}</Text>;
}

export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <Text accessibilityLiveRegion="polite" style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.crimson, marginTop: 4 }}>
      {message}
    </Text>
  );
}

export function FieldHint({ children, tone = 'soft' }: { children: React.ReactNode; tone?: 'soft' | 'good' | 'bad' }) {
  const color = tone === 'good' ? COLORS.moss : tone === 'bad' ? COLORS.crimson : COLORS.inkFaint;
  return <Text style={{ fontFamily: F.mono, fontSize: 12, color, marginTop: 4 }}>{children}</Text>;
}

/** Eyebrow + two-line serif heading used at the top of every form. */
export function PageHeading({ eyebrow, line1, line2 }: { eyebrow: string; line1: string; line2: string }) {
  return (
    <View style={{ marginBottom: 24 }}>
      <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.oxblood, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        {eyebrow}
      </Text>
      <Text style={{ fontFamily: F.serif, fontSize: 28, color: COLORS.ink, lineHeight: 32 }}>{line1}</Text>
      <Text style={{ fontFamily: F.serifItalic, fontSize: 28, color: COLORS.oxblood, lineHeight: 34 }}>{line2}</Text>
    </View>
  );
}

interface ButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  icon?: FeatherName;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  style?: ViewStyle;
  accessibilityHint?: string;
  testID?: string;
}

export function Button({
  label, onPress, disabled = false, busy = false, icon, variant = 'primary', style, accessibilityHint, testID,
}: ButtonProps) {
  const inactive = disabled || busy;
  const palette = {
    primary:   { bg: COLORS.oxblood, fg: COLORS.paper, border: COLORS.oxblood },
    secondary: { bg: COLORS.transparent, fg: COLORS.ink, border: COLORS.ink },
    quiet:     { bg: COLORS.cardFill, fg: COLORS.ink, border: COLORS.paperEdge },
    danger:    { bg: COLORS.transparent, fg: COLORS.crimson, border: COLORS.crimson },
  }[variant];
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={inactive}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      testID={testID}
      style={[
        {
          minHeight: 48,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: inactive && variant === 'primary' ? COLORS.paperEdge : palette.border,
          backgroundColor: inactive && variant === 'primary' ? COLORS.paperEdge : palette.bg,
          paddingHorizontal: 16,
          paddingVertical: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: inactive && variant !== 'primary' ? 0.5 : 1,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={variant === 'primary' ? COLORS.inkSoft : palette.fg} />
      ) : icon ? (
        <Feather name={icon} size={16} color={inactive && variant === 'primary' ? COLORS.inkSoft : palette.fg} />
      ) : null}
      <Text
        numberOfLines={1}
        style={{ fontFamily: F.sansMed, fontSize: 15, color: inactive && variant === 'primary' ? COLORS.inkSoft : palette.fg }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/** Pill-style single choice (mode, type, add/remove…). */
export function ChoicePills<T extends string>({
  options, value, onChange, icons,
}: {
  options: Array<{ value: T; label: string }>;
  value: T | null;
  onChange: (v: T) => void;
  icons?: Partial<Record<T, FeatherName>>;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
      {options.map(o => {
        const active = o.value === value;
        const icon = icons?.[o.value];
        return (
          <TouchableOpacity
            key={o.value}
            onPress={() => onChange(o.value)}
            activeOpacity={0.75}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, checked: active }}
            accessibilityLabel={o.label}
            hitSlop={hitSlopFor(36)}
            style={{
              minHeight: 36,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: active ? COLORS.ink : COLORS.transparent,
              borderWidth: 1,
              borderColor: active ? COLORS.ink : COLORS.paperEdge,
              borderRadius: 999,
              paddingHorizontal: 16,
            }}
          >
            {icon ? <Feather name={icon} size={14} color={active ? COLORS.paper : COLORS.inkSoft} /> : null}
            <Text style={{ fontFamily: F.sans, fontSize: 13, color: active ? COLORS.paper : COLORS.ink }}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** − value + stepper with ≥44pt targets; value rendered in mono. */
export function Stepper({
  value, label, onDecrement, onIncrement, canDecrement = true, canIncrement = true, accessibilityLabel,
}: {
  value: string;
  label?: string;
  onDecrement: () => void;
  onIncrement: () => void;
  canDecrement?: boolean;
  canIncrement?: boolean;
  accessibilityLabel: string;
}) {
  const btn = (icon: FeatherName, onPress: () => void, enabled: boolean, a11y: string) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={!enabled}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={{
        width: MIN_TOUCH,
        height: MIN_TOUCH,
        borderRadius: MIN_TOUCH / 2,
        borderWidth: 1,
        borderColor: COLORS.paperEdge,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: enabled ? 1 : 0.35,
      }}
    >
      <Feather name={icon} size={18} color={COLORS.ink} />
    </TouchableOpacity>
  );
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}
      accessible={false}
    >
      {btn('minus', onDecrement, canDecrement, `Decrease ${accessibilityLabel}`)}
      <View style={{ minWidth: 88, alignItems: 'center' }} accessibilityLabel={`${accessibilityLabel} ${value}`}>
        <Text style={{ fontFamily: F.monoMed, fontSize: 22, color: COLORS.ink }}>{value}</Text>
        {label ? <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, marginTop: 2 }}>{label}</Text> : null}
      </View>
      {btn('plus', onIncrement, canIncrement, `Increase ${accessibilityLabel}`)}
    </View>
  );
}

/** Centered message with a back action — for "not found" states. */
export function NotFoundState({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.paper, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 16 }}>
      <Text style={{ fontFamily: F.serif, fontSize: 24, color: COLORS.ink, textAlign: 'center' }}>{title}</Text>
      <Button label="Go back" icon="arrow-left" variant="secondary" onPress={onBack} />
    </View>
  );
}

export function LoadingState() {
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.paper, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.inkFaint }}>Loading…</Text>
    </View>
  );
}

/** Tinted banner (warning / danger / info). */
export function Banner({
  tone, children, icon, action,
}: {
  tone: 'warn' | 'bad' | 'info' | 'good';
  children: React.ReactNode;
  icon?: FeatherName;
  action?: { label: string; onPress: () => void };
}) {
  const p = {
    warn: { bg: COLORS.warnFill, fg: COLORS.amber },
    bad:  { bg: COLORS.badFill, fg: COLORS.crimson },
    info: { bg: COLORS.paperDeep, fg: COLORS.inkSoft },
    good: { bg: COLORS.okFill, fg: COLORS.moss },
  }[tone];
  return (
    <View
      accessibilityRole="alert"
      style={{ backgroundColor: p.bg, borderRadius: 12, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}
    >
      {icon ? <Feather name={icon} size={16} color={p.fg} style={{ marginTop: 1 }} /> : null}
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: COLORS.ink, lineHeight: 18 }}>{children}</Text>
        {action ? (
          <TouchableOpacity
            onPress={action.onPress}
            accessibilityRole="button"
            hitSlop={hitSlopFor(20)}
            style={{ alignSelf: 'flex-start', minHeight: 24, justifyContent: 'center' }}
          >
            <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: COLORS.oxblood, textDecorationLine: 'underline' }}>
              {action.label}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}
