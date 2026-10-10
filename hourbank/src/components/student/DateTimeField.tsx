/**
 * DateTimeField — tappable mono value that opens the native date/time picker.
 *
 * Android: uses the imperative `DateTimePickerAndroid.open()` dialog, so there
 * is no mounted picker to re-open itself (the old mount/unmount loop) and the
 * dialog closes on selection.
 * iOS: mounts an inline spinner on demand that stays open while the tutor
 * scrolls the wheels; "Done" collapses it.
 * The native module is loaded lazily; if it is missing (e.g. Expo Go without
 * the module) a typed fallback input is shown instead.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { F, MIN_TOUCH } from '../../theme/fonts';
import { COLORS } from '../../theme/colors';
import { withDate, withTime } from './flowLogic';

type PickerModule = typeof import('@react-native-community/datetimepicker');

let cachedModule: PickerModule | null = null;
async function loadPicker(): Promise<PickerModule | null> {
  if (cachedModule) return cachedModule;
  try {
    cachedModule = await import('@react-native-community/datetimepicker');
    return cachedModule;
  } catch {
    return null;
  }
}

export interface DateTimeFieldProps {
  mode: 'date' | 'time';
  value: Date;
  /** Receives `value` with only the date (or time) part replaced. */
  onChange: (next: Date) => void;
  /** Text shown in the field, e.g. "Thu 9 Oct 2026" / "15:00". */
  display: string;
  accessibilityLabel: string;
  minimumDate?: Date;
  maximumDate?: Date;
  invalid?: boolean;
}

export function DateTimeField({
  mode, value, onChange, display, accessibilityLabel, minimumDate, maximumDate, invalid = false,
}: DateTimeFieldProps) {
  const [mod, setMod] = useState<PickerModule | null>(cachedModule);
  const [failed, setFailed] = useState(false);
  const [iosOpen, setIosOpen] = useState(false);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    let cancelled = false;
    if (!cachedModule) {
      loadPicker().then(m => {
        if (cancelled) return;
        if (m) setMod(m);
        else setFailed(true);
      });
    }
    return () => { cancelled = true; };
  }, []);

  function apply(selected: Date) {
    onChange(mode === 'date' ? withDate(valueRef.current, selected) : withTime(valueRef.current, selected));
  }

  function open() {
    if (failed || !mod) {
      setFallbackOpen(v => !v);
      return;
    }
    if (Platform.OS === 'android') {
      mod.DateTimePickerAndroid.open({
        value: valueRef.current,
        mode,
        is24Hour: true,
        minimumDate,
        maximumDate,
        onChange: (event, selected) => {
          if (event.type === 'set' && selected) apply(selected);
        },
      });
      return;
    }
    setIosOpen(v => !v);
  }

  const Picker = mod?.default;

  return (
    <View>
      <TouchableOpacity
        onPress={open}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${accessibilityLabel}: ${display}`}
        accessibilityHint={`Opens the ${mode} picker`}
        style={{
          minHeight: MIN_TOUCH,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottomWidth: 1,
          borderBottomColor: invalid ? COLORS.crimson : COLORS.paperEdge,
          paddingVertical: 8,
        }}
      >
        <Text style={{ fontFamily: F.mono, fontSize: 17, color: invalid ? COLORS.crimson : COLORS.ink }}>{display}</Text>
        <Feather name={mode === 'date' ? 'calendar' : 'clock'} size={16} color={COLORS.inkSoft} />
      </TouchableOpacity>

      {Platform.OS === 'ios' && iosOpen && Picker ? (
        <View style={{ borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge, paddingBottom: 4 }}>
          <Picker
            value={value}
            mode={mode}
            display="spinner"
            is24Hour
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            textColor={COLORS.ink}
            onChange={(_e, selected) => { if (selected) apply(selected); }}
          />
          <TouchableOpacity
            onPress={() => setIosOpen(false)}
            accessibilityRole="button"
            accessibilityLabel={`Done choosing ${mode}`}
            style={{ alignSelf: 'flex-end', minHeight: MIN_TOUCH, paddingHorizontal: 12, justifyContent: 'center' }}
          >
            <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.oxblood }}>Done</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {fallbackOpen ? (
        <TextInput
          autoFocus
          placeholder={mode === 'date' ? 'YYYY-MM-DD' : 'HH:MM'}
          placeholderTextColor={COLORS.inkFaint}
          onSubmitEditing={e => {
            const txt = e.nativeEvent.text.trim();
            if (mode === 'date') {
              const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(txt);
              if (m) apply(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
            } else {
              const m = /^(\d{1,2})[:h](\d{2})$/.exec(txt);
              if (m) {
                const d = new Date(valueRef.current);
                d.setHours(Number(m[1]), Number(m[2]), 0, 0);
                apply(d);
              }
            }
            setFallbackOpen(false);
          }}
          style={{ fontFamily: F.mono, fontSize: 15, color: COLORS.ink, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.ink }}
        />
      ) : null}
    </View>
  );
}
