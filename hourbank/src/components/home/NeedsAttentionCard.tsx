import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { F, MIN_TOUCH } from '../../theme/fonts';
import { COLORS } from '../../theme/colors';
import type { AttentionItem, AttentionKind } from './homeLogic';

const KIND_STYLE: Record<AttentionKind, { icon: React.ComponentProps<typeof Feather>['name']; color: string; tag: string }> = {
  overdue: { icon: 'alert-circle', color: COLORS.oxblood, tag: 'OVERDUE' },
  owing: { icon: 'arrow-down-circle', color: COLORS.oxblood, tag: 'OWES' },
  low: { icon: 'battery', color: COLORS.crimson, tag: 'LOW' },
};

/** Renders nothing when there is nothing to act on. */
export function NeedsAttentionCard({
  items,
  maxItems = 6,
  onPress,
}: {
  items: AttentionItem[];
  maxItems?: number;
  onPress: (item: AttentionItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();
  if (items.length === 0) return null;
  const shown = expanded ? items : items.slice(0, maxItems);
  const hidden = items.length - shown.length;

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: COLORS.oxblood,
        borderRadius: 16,
        backgroundColor: COLORS.oxbloodFill,
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 6,
        marginBottom: 16,
      }}
    >
      <Text
        style={{
          fontFamily: F.mono,
          fontSize: 12,
          color: COLORS.oxblood,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginBottom: 4,
        }}
      >
        {`Needs attention · ${items.length}`}
      </Text>
      {shown.map((item, i) => {
        const k = KIND_STYLE[item.kind];
        return (
          <TouchableOpacity
            key={item.key}
            onPress={() => onPress(item)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}: ${item.detail}`}
            style={{
              minHeight: MIN_TOUCH,
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 8,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: COLORS.inkHairline,
            }}
          >
            <Feather name={k.icon} size={16} color={k.color} style={{ marginRight: 10 }} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: F.serif, fontSize: 15, color: COLORS.ink }}>
                {item.title}
              </Text>
              <Text numberOfLines={1} style={{ fontFamily: F.mono, fontSize: 12, color: k.color, marginTop: 1 }}>
                {item.detail}
              </Text>
            </View>
            {item.recordHref ? (
              <TouchableOpacity
                onPress={() => router.push(item.recordHref as Href)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={`Record lesson with ${item.title}`}
                style={{
                  minHeight: MIN_TOUCH,
                  paddingHorizontal: 12,
                  marginLeft: 8,
                  borderRadius: 10,
                  backgroundColor: COLORS.oxblood,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Feather name="check" size={13} color={COLORS.paper} />
                <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: COLORS.paper }}>Record</Text>
              </TouchableOpacity>
            ) : (
              <Feather name="chevron-right" size={16} color={COLORS.inkSoft} />
            )}
          </TouchableOpacity>
        );
      })}
      {(hidden > 0 || expanded) && items.length > maxItems && (
        <TouchableOpacity
          onPress={() => setExpanded(v => !v)}
          activeOpacity={0.7}
          accessibilityRole="button"
          style={{ minHeight: MIN_TOUCH, justifyContent: 'center', borderTopWidth: 1, borderTopColor: COLORS.inkHairline }}
        >
          <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.oxblood }}>{expanded ? 'Show fewer' : `Show ${hidden} more`}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
