import React from 'react';
import { Linking, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { F, MIN_TOUCH } from '../../theme/fonts';
import { COLORS } from '../../theme/colors';
import { normaliseSaPhone, openWhatsApp } from '../../utils/whatsapp';
import { formatPhoneDisplay, telUri } from './flowLogic';

interface Props {
  parentName?: string | null;
  parentPhone?: string | null;
  /** Navigate to the edit screen to add missing contact details. */
  onAddContact: () => void;
  onError: (message: string) => void;
}

function greeting(parentName?: string | null): string {
  const first = parentName?.trim().split(/\s+/)[0];
  return first ? `Hi ${first}, ` : '';
}

function ActionButton({ icon, label, onPress }: { icon: React.ComponentProps<typeof Feather>['name']; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        minHeight: MIN_TOUCH,
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        borderWidth: 1,
        borderColor: COLORS.paperEdge,
        borderRadius: 12,
        backgroundColor: COLORS.cardFill,
      }}
    >
      <Feather name={icon} size={15} color={COLORS.ink} />
      <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.ink }}>{label}</Text>
    </TouchableOpacity>
  );
}

export function ParentContactCard({ parentName, parentPhone, onAddContact, onError }: Props) {
  const name = parentName?.trim() || null;
  const normalised = normaliseSaPhone(parentPhone);

  if (!name && !normalised) {
    return (
      <TouchableOpacity
        onPress={onAddContact}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Add parent contact"
        style={{
          minHeight: MIN_TOUCH + 8,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: COLORS.inkFaint,
          borderRadius: 14,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Feather name="user-plus" size={16} color={COLORS.inkSoft} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.ink }}>Add parent contact</Text>
          <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkFaint }}>
            For WhatsApp receipts and top-up reminders
          </Text>
        </View>
        <Feather name="chevron-right" size={16} color={COLORS.inkFaint} />
      </TouchableOpacity>
    );
  }

  async function call() {
    const uri = telUri(parentPhone);
    if (!uri) return;
    try {
      await Linking.openURL(uri);
    } catch {
      onError("Couldn't open the phone app");
    }
  }

  async function whatsapp() {
    try {
      await openWhatsApp(parentPhone, greeting(name));
    } catch {
      onError("Couldn't open WhatsApp");
    }
  }

  return (
    <View style={{ borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 14, padding: 14, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Feather name="user" size={14} color={COLORS.inkSoft} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.ink }}>{name ?? 'Parent'}</Text>
          {normalised ? (
            <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkSoft, marginTop: 2 }}>
              {formatPhoneDisplay(normalised)}
            </Text>
          ) : (
            <TouchableOpacity onPress={onAddContact} accessibilityRole="button" style={{ minHeight: 28, justifyContent: 'center' }}>
              <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.oxblood, textDecorationLine: 'underline' }}>
                Add WhatsApp number
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      {normalised ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <ActionButton icon="phone" label="Call" onPress={call} />
          <ActionButton icon="message-circle" label="WhatsApp" onPress={whatsapp} />
        </View>
      ) : null}
    </View>
  );
}
