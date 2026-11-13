/**
 * Tappable date/time row that mounts a native picker ONLY while open.
 *
 * Android's picker is a dialog: mounting it permanently (or more than one at a
 * time) re-opens it on every render — the "date picker loop". The parent keeps
 * at most one field open; Android closes on the first change/dismiss, iOS shows
 * an inline picker with a Done button.
 */
import React from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { COLORS } from '../../theme/colors';
import { F, MIN_TOUCH } from '../../theme/fonts';
import { LazyDateTimePicker } from '../LazyDateTimePicker';

interface Props {
  label: string;
  value: Date;
  display: string;
  mode: 'date' | 'time';
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (d: Date) => void;
  error?: boolean;
  minimumDate?: Date;
}

export function DateField({ label, value, display, mode, open, onOpen, onClose, onChange, error, minimumDate }: Props) {
  const isIOS = Platform.OS === 'ios';
  return (
    <View style={{ marginBottom: 12 }}>
      <TouchableOpacity
        onPress={open ? onClose : onOpen}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${display}`}
        accessibilityHint={`Change ${label.toLowerCase()}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: MIN_TOUCH + 4,
          borderBottomWidth: 1,
          borderBottomColor: error ? COLORS.crimson : COLORS.paperEdge,
        }}
      >
        <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, textTransform: 'uppercase' }}>{label}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontFamily: F.mono, fontSize: 15, color: error ? COLORS.crimson : COLORS.ink }}>{display}</Text>
          <Feather name={mode === 'date' ? 'calendar' : 'clock'} size={14} color={COLORS.inkFaint} />
        </View>
      </TouchableOpacity>
      {open ? (
        <View>
          <LazyDateTimePicker
            value={value}
            mode={mode}
            is24Hour
            minimumDate={minimumDate}
            onChange={(_e, d) => {
              if (!isIOS) onClose();
              if (d) onChange(d);
            }}
          />
          {isIOS ? (
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              style={{ alignSelf: 'flex-end', minHeight: MIN_TOUCH, justifyContent: 'center', paddingHorizontal: 8 }}
            >
              <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.oxblood }}>Done</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
