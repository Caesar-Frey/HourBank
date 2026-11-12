import React, { useState, useEffect } from 'react';
import {
  Modal,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { COLORS } from '../theme/colors';
import { F } from '../theme/fonts';

const MAX_MINUTES = 480;

export function formatCustomDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export interface DurationStepperSheetProps {
  visible: boolean;
  initialMinutes: number;
  onConfirm: (minutes: number) => void;
  onCancel: () => void;
  /** Lesson-length step from Settings (15 or 30). Also the minimum. */
  step?: number;
}

export function DurationStepperSheet({
  visible,
  initialMinutes,
  onConfirm,
  onCancel,
  step = 30,
}: DurationStepperSheetProps) {
  const STEP = step > 0 ? step : 30;
  const MIN_MINUTES = STEP;
  const insets = useSafeAreaInsets();
  const [minutes, setMinutes] = useState(initialMinutes);

  // Sync to initialMinutes each time the sheet opens
  useEffect(() => {
    if (visible) {
      // Snap to nearest valid step
      const snapped = Math.max(
        MIN_MINUTES,
        Math.min(MAX_MINUTES, Math.round(initialMinutes / STEP) * STEP)
      );
      setMinutes(snapped);
    }
  }, [visible, initialMinutes, STEP, MIN_MINUTES]);

  function decrement() {
    setMinutes(prev => Math.max(MIN_MINUTES, prev - STEP));
  }

  function increment() {
    setMinutes(prev => Math.min(MAX_MINUTES, prev + STEP));
  }

  const canDecrement = minutes > MIN_MINUTES;
  const canIncrement = minutes < MAX_MINUTES;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      {/* Backdrop */}
      <Pressable
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: COLORS.scrim,
        }}
        onPress={onCancel}
      />

      {/* Sheet panel */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: COLORS.paper,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          paddingHorizontal: 24,
          paddingTop: 24,
          paddingBottom: insets.bottom + 24,
        }}
      >
        {/* Handle bar */}
        <View
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            backgroundColor: COLORS.paperEdge,
            alignSelf: 'center',
            marginBottom: 20,
          }}
        />

        {/* Title */}
        <Text
          style={{
            fontFamily: F.sansMed,
            fontSize: 11,
            color: COLORS.inkFaint,
            textTransform: 'uppercase',
            letterSpacing: 1.5,
            marginBottom: 28,
            textAlign: 'center',
          }}
        >
          Custom Duration
        </Text>

        {/* Stepper row */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 32,
            marginBottom: 36,
          }}
        >
          {/* Decrement */}
          <TouchableOpacity
            onPress={decrement}
            disabled={!canDecrement}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Decrease by 15 minutes"
            accessibilityState={{ disabled: !canDecrement }}
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              borderWidth: 1,
              borderColor: canDecrement ? COLORS.paperEdge : COLORS.paperEdge,
              backgroundColor: COLORS.paper,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: canDecrement ? 1 : 0.35,
            }}
          >
            <Feather name="minus" size={20} color={COLORS.ink} />
          </TouchableOpacity>

          {/* Value label */}
          <Text
            style={{
              fontFamily: F.monoMed,
              fontSize: 32,
              color: COLORS.ink,
              minWidth: 100,
              textAlign: 'center',
            }}
          >
            {formatCustomDuration(minutes)}
          </Text>

          {/* Increment */}
          <TouchableOpacity
            onPress={increment}
            disabled={!canIncrement}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Increase by 15 minutes"
            accessibilityState={{ disabled: !canIncrement }}
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              borderWidth: 1,
              borderColor: canIncrement ? COLORS.paperEdge : COLORS.paperEdge,
              backgroundColor: COLORS.paper,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: canIncrement ? 1 : 0.35,
            }}
          >
            <Feather name="plus" size={20} color={COLORS.ink} />
          </TouchableOpacity>
        </View>

        {/* Confirm button */}
        <TouchableOpacity
          onPress={() => onConfirm(minutes)}
          activeOpacity={0.85}
          style={{
            backgroundColor: COLORS.ink,
            borderRadius: 16,
            paddingVertical: 16,
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <Text
            style={{
              fontFamily: F.sansMed,
              fontSize: 16,
              color: COLORS.paper,
            }}
          >
            Confirm
          </Text>
        </TouchableOpacity>

        {/* Cancel link */}
        <TouchableOpacity
          onPress={onCancel}
          activeOpacity={0.7}
          accessibilityRole="button"
          style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 8, minHeight: 44 }}
        >
          <Text
            style={{
              fontFamily: F.sans,
              fontSize: 14,
              color: COLORS.inkSoft,
            }}
          >
            Cancel
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}
