import React from 'react';
import { View, Text, TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { F, MIN_TOUCH } from '../theme/fonts';
import { COLORS } from '../theme/colors';

const SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

// ─── HeaderIconButton ────────────────────────────────────────────────────────

export interface HeaderIconButtonProps {
  icon: React.ComponentProps<typeof Feather>['name'];
  onPress: () => void;
  /** Required: icon-only buttons need a spoken label. */
  accessibilityLabel: string;
  /** Optional text shown next to the icon. */
  label?: string;
  color?: string;
  disabled?: boolean;
}

/** 44×44pt header action (icon, optionally with a short label). */
export function HeaderIconButton({
  icon,
  onPress,
  accessibilityLabel,
  label,
  color = COLORS.ink,
  disabled = false,
}: HeaderIconButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      hitSlop={SLOP}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={{
        minWidth: MIN_TOUCH,
        minHeight: MIN_TOUCH,
        paddingHorizontal: label ? 8 : 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Feather name={icon} size={20} color={color} />
      {label ? (
        <Text style={{ fontFamily: F.sansMed, fontSize: 14, color }}>{label}</Text>
      ) : null}
    </TouchableOpacity>
  );
}

// ─── ScreenHeader (stack screens) ────────────────────────────────────────────

interface ScreenHeaderProps {
  backLabel?: string;
  onBack?: () => void;
  title?: string;
  /** Right-side action slot (preferred name). Use HeaderIconButton for icons. */
  right?: React.ReactNode;
  /** @deprecated alias of `right`, kept for existing call sites. */
  rightElement?: React.ReactNode;
  /** Hairline under the header (default true). */
  divider?: boolean;
  /** Dark variant for the Live Session screen. */
  dark?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Header for pushed stack screens. Render it OUTSIDE the ScrollView so content
 * scrolls beneath an opaque paper bar with a hairline divider.
 * Back + right actions have ≥44pt touch targets.
 */
export function ScreenHeader({
  backLabel,
  onBack,
  title,
  right,
  rightElement,
  divider = true,
  dark = false,
  style,
}: ScreenHeaderProps) {
  const rightNode = right ?? rightElement;
  const bg = dark ? COLORS.sessionBg : COLORS.paper;
  const fg = dark ? COLORS.paper : COLORS.ink;
  const fgSoft = dark ? COLORS.paper60 : COLORS.inkSoft;
  const rule = dark ? COLORS.paper12 : COLORS.paperEdge;

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingTop: 4,
          paddingBottom: 4,
          minHeight: MIN_TOUCH + 8,
          backgroundColor: bg,
          borderBottomWidth: divider ? 1 : 0,
          borderBottomColor: rule,
          zIndex: 1,
        },
        style,
      ]}
    >
      {/* Left: back */}
      <View style={{ flex: 1, alignItems: 'flex-start' }}>
        {onBack ? (
          <TouchableOpacity
            onPress={onBack}
            activeOpacity={0.7}
            hitSlop={SLOP}
            accessibilityRole="button"
            accessibilityLabel={backLabel ? `Back to ${backLabel.toLowerCase()}` : 'Back'}
            style={{
              minHeight: MIN_TOUCH,
              minWidth: MIN_TOUCH,
              paddingHorizontal: 8,
              justifyContent: 'center',
            }}
          >
            <Text numberOfLines={1} style={{ fontFamily: F.mono, fontSize: 13, color: fgSoft }}>
              {`← ${backLabel ?? ''}`}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Centre: title */}
      {title ? (
        <Text
          numberOfLines={1}
          accessibilityRole="header"
          style={{ fontFamily: F.sansMed, fontSize: 14, color: fg, flexShrink: 1, textAlign: 'center' }}
        >
          {title}
        </Text>
      ) : null}

      {/* Right: action slot */}
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', minHeight: MIN_TOUCH }}>
        {rightNode ?? null}
      </View>
    </View>
  );
}

// ─── TabHeader (tab root screens) ────────────────────────────────────────────

interface TabHeaderProps {
  /** Serif title, e.g. "Schedule". */
  title: string;
  /** Optional italic oxblood word appended to the title (e.g. Hour<Bank>). */
  titleAccent?: string;
  /** Small mono eyebrow under the title, e.g. "THU 9 OCT". */
  subtitle?: string;
  /** Right-side action(s). Use HeaderIconButton. */
  right?: React.ReactNode;
  /** Hairline under the header (default true). */
  divider?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Header for tab root screens (Home / Schedule / Money / Settings).
 * Render it OUTSIDE the ScrollView.
 */
export function TabHeader({
  title,
  titleAccent,
  subtitle,
  right,
  divider = true,
  style,
}: TabHeaderProps) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 24,
          paddingRight: 12,
          paddingTop: 12,
          paddingBottom: 10,
          backgroundColor: COLORS.paper,
          borderBottomWidth: divider ? 1 : 0,
          borderBottomColor: COLORS.paperEdge,
          zIndex: 1,
        },
        style,
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text accessibilityRole="header" numberOfLines={1}>
          <Text style={{ fontFamily: F.serif, fontSize: 26, color: COLORS.ink }}>{title}</Text>
          {titleAccent ? (
            <Text style={{ fontFamily: F.serifItalic, fontSize: 26, color: COLORS.oxblood }}>{titleAccent}</Text>
          ) : null}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={1}
            style={{
              fontFamily: F.mono,
              fontSize: 12,
              color: COLORS.inkFaint,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              marginTop: 2,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH }}>{right}</View>
      ) : null}
    </View>
  );
}
