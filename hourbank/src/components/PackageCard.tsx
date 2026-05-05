import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { F } from '../theme/fonts';

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
          <Text
            style={{
              fontFamily: F.serifItalic,
              fontSize: 11,
              color: '#7A2530',
            }}
          >
            {badge}
          </Text>
        ) : (
          <View />
        )}
        {selected && (
          <Feather name="check" size={16} color="#7A2530" />
        )}
      </View>

      {/* Hours display */}
      {isCustom ? (
        <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'baseline' }}>
          <Text style={{ fontFamily: F.serif, fontSize: 28, color: '#1B1714' }}>
            Other
          </Text>
          <Text
            style={{
              fontFamily: F.sans,
              fontSize: 13,
              color: '#4A413A',
              marginLeft: 6,
            }}
          >
            Custom
          </Text>
        </View>
      ) : (
        <>
          <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'baseline' }}>
            <Text style={{ fontFamily: F.serif, fontSize: 28, color: '#1B1714' }}>
              {hours}
            </Text>
            <Text
              style={{
                fontFamily: F.serifItalic,
                fontSize: 14,
                color: '#4A413A',
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
                color: '#1B1714',
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
                color: '#3F5641',
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
