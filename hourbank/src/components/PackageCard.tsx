import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { F } from '../theme/fonts';
import { COLORS } from '../theme/colors';

interface PackageCardProps {
  hours: number;
  price: number | null;
  badge: string | null;
  save: number | null;
  selected: boolean;
  onPress: () => void;
  isCustom?: boolean;
}

export function PackageCard({
  hours,
  price,
  badge,
  save,
  selected,
  onPress,
  isCustom = false,
}: PackageCardProps) {
  const containerClass = selected
    ? 'border-[1.5px] border-ink rounded-2xl p-4 bg-paperDeep'
    : 'border border-paperEdge rounded-2xl p-4 bg-white/40';

  return (
    <TouchableOpacity className={containerClass} onPress={onPress} activeOpacity={0.75}>
      {/* Top row: badge + checkmark */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: 18 }}>
        {badge ? (
          <View style={{ backgroundColor: COLORS.oxblood, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.paper, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {badge}
            </Text>
          </View>
        ) : (
          <View />
        )}
        {selected && (
          <Feather name="check" size={16} color={COLORS.oxblood} />
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
              {`R ${price.toLocaleString('en-ZA')}`}
            </Text>
          )}

          {save !== null && save > 0 && (
            <Text
              style={{
                fontFamily: F.serifItalic,
                fontSize: 12,
                color: COLORS.moss,
                marginTop: 2,
              }}
            >
              {`— save R${save.toLocaleString('en-ZA')}`}
            </Text>
          )}
        </>
      )}
    </TouchableOpacity>
  );
}
