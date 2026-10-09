import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { F } from '../theme/fonts';
import { COLORS } from '../theme/colors';
import { formatRand } from '../utils/format';

interface PackageCardProps {
  /** Authoritative package size — rendered as the big mono number. */
  hours: number;
  price: number | null;
  /** OPTIONAL promo pill only (e.g. "Best Value"). Never the hour count. */
  badge: string | null;
  save: number | null;
  selected: boolean;
  onPress: () => void;
  isCustom?: boolean;
}

// Border + padding always sum to 17pt so selecting a card never shifts layout.
const SELECTED_BORDER = 2;
const UNSELECTED_BORDER = 1;
const BOX = 17;

export function PackageCard({
  hours,
  price,
  badge,
  save,
  selected,
  onPress,
  isCustom = false,
}: PackageCardProps) {
  const border = selected ? SELECTED_BORDER : UNSELECTED_BORDER;
  const a11yLabel = isCustom
    ? 'Other amount, custom'
    : `${hours} hours${price !== null ? `, ${formatRand(price)}` : ''}${badge ? `, ${badge}` : ''}`;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={a11yLabel}
      style={{
        borderWidth: border,
        borderColor: selected ? COLORS.ink : COLORS.paperEdge,
        borderRadius: 16,
        padding: BOX - border,
        backgroundColor: selected ? COLORS.paperDeep : COLORS.cardFill,
        minHeight: 44,
      }}
    >
      {/* Top row: badge (left) + check (right, inside the card) */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: 20 }}>
        {badge ? (
          <View style={{ backgroundColor: COLORS.oxblood, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, flexShrink: 1, marginRight: 6 }}>
            <Text
              numberOfLines={1}
              style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.paper, textTransform: 'uppercase', letterSpacing: 0.5 }}
            >
              {badge}
            </Text>
          </View>
        ) : (
          <View />
        )}
        {selected ? (
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              backgroundColor: COLORS.ink,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather name="check" size={13} color={COLORS.paper} />
          </View>
        ) : (
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: COLORS.paperEdge,
            }}
          />
        )}
      </View>

      {/* Hours display */}
      {isCustom ? (
        <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'baseline' }}>
          <Text style={{ fontFamily: F.serif, fontSize: 28, color: COLORS.ink }}>
            Other
          </Text>
          <Text
            style={{
              fontFamily: F.sans,
              fontSize: 13,
              color: COLORS.inkSoft,
              marginLeft: 6,
            }}
          >
            Custom
          </Text>
        </View>
      ) : (
        <>
          <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'baseline' }}>
            <Text style={{ fontFamily: F.mono, fontSize: 28, color: COLORS.ink }}>
              {hours}
            </Text>
            <Text
              style={{
                fontFamily: F.serifItalic,
                fontSize: 14,
                color: COLORS.inkSoft,
                marginLeft: 2,
              }}
            >
              hrs
            </Text>
          </View>

          {price !== null && (
            <Text
              style={{
                fontFamily: F.mono,
                fontSize: 14,
                color: COLORS.ink,
                marginTop: 4,
              }}
            >
              {formatRand(price)}
            </Text>
          )}

          {save !== null && save > 0 && (
            <Text
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                color: COLORS.moss,
                marginTop: 2,
              }}
            >
              {`save ${formatRand(save)}`}
            </Text>
          )}
        </>
      )}
    </TouchableOpacity>
  );
}
