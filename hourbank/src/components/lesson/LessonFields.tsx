/**
 * Field building blocks shared by the Record / Edit lesson form and the timer
 * review (end-session) screen.
 */
import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { F, MIN_TOUCH, hitSlopFor } from '../../theme/fonts';
import { COLORS } from '../../theme/colors';
import { TopicChip } from '../TopicChip';
import { formatHours, formatMinutes } from '../../utils/format';
import { balanceColour, balanceStatus } from '../../utils/balance';
import { LESSON_LENGTH_PRESETS, LESSON_STEP_MINUTES, stepBilled } from './lessonFormLogic';
import type { SubjectOption } from './lessonFormData';

// ─── Subject ─────────────────────────────────────────────────────────────────

/** Pills with each subject's balance. One subject → read-only line. */
export function SubjectPicker({
  options,
  value,
  onChange,
  fallbackName,
}: {
  options: SubjectOption[];
  value: string | null;
  onChange: (id: string) => void;
  /** Shown when the lesson's subject is no longer active (e.g. archived). */
  fallbackName?: string | null;
}) {
  if (options.length <= 1) {
    const only = options[0];
    return (
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, minHeight: 28 }}>
        <Text style={{ fontFamily: F.sans, fontSize: 15, color: COLORS.ink }}>{only?.subject ?? fallbackName ?? '—'}</Text>
        {only ? (
          <Text style={{ fontFamily: F.mono, fontSize: 12, color: balanceColour(balanceStatus(only.balance)) }}>
            {only.balance < 0 ? `owes ${formatHours(-only.balance)}` : `${formatHours(only.balance)} left`}
          </Text>
        ) : null}
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
      {options.map(o => {
        const active = o.id === value;
        return (
          <TouchableOpacity
            key={o.id}
            onPress={() => onChange(o.id)}
            activeOpacity={0.75}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, checked: active }}
            accessibilityLabel={`${o.subject}, ${o.balance < 0 ? `owes ${formatHours(-o.balance)}` : `${formatHours(o.balance)} left`}`}
            hitSlop={hitSlopFor(40)}
            style={{
              minHeight: 40,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              backgroundColor: active ? COLORS.ink : COLORS.transparent,
              borderWidth: 1,
              borderColor: active ? COLORS.ink : COLORS.paperEdge,
              borderRadius: 999,
              paddingHorizontal: 14,
            }}
          >
            <Text style={{ fontFamily: F.sans, fontSize: 14, color: active ? COLORS.paper : COLORS.ink }}>{o.subject}</Text>
            <Text
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                color: active ? COLORS.paper60 : balanceColour(balanceStatus(o.balance)),
              }}
            >
              {o.balance < 0 ? `−${formatHours(-o.balance)}` : formatHours(o.balance)}
            </Text>
          </TouchableOpacity>
        );
      })}
      {value && !options.some(o => o.id === value) && fallbackName ? (
        <View style={{ minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 999, backgroundColor: COLORS.ink }}>
          <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.paper }}>{`${fallbackName} (archived)`}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Billed minutes ──────────────────────────────────────────────────────────

/**
 * Lesson length stepper: − / value / + moving by the tutor's step (15 or 30,
 * Settings), with ≥44pt targets. No free typing (owner decision 2026-11-12).
 * `presets` adds quick picks (30m · 1h · 1h 30m · 2h) for the record form.
 */
export function BilledMinutesField({
  value,
  onChange,
  caption,
  step = LESSON_STEP_MINUTES,
  presets = false,
  label = 'Bill',
}: {
  value: number;
  onChange: (minutes: number) => void;
  caption?: string;
  step?: number;
  presets?: boolean;
  /** Verb for screen readers ("Bill 30 minutes more", "Charge …"). */
  label?: string;
}) {
  const stepBtn = (dir: 1 | -1) => {
    const next = stepBilled(value, dir, step);
    const enabled = next !== value;
    const a11y = `${label} ${step} minutes ${dir > 0 ? 'more' : 'less'}`;
    return (
      <TouchableOpacity
        onPress={() => onChange(next)}
        disabled={!enabled}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        activeOpacity={0.7}
        style={{
          width: MIN_TOUCH,
          height: MIN_TOUCH,
          borderRadius: MIN_TOUCH / 2,
          borderWidth: 1,
          borderColor: COLORS.ink,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: enabled ? 1 : 0.4,
        }}
      >
        <Feather name={dir > 0 ? 'plus' : 'minus'} size={18} color={COLORS.ink} />
      </TouchableOpacity>
    );
  };

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {stepBtn(-1)}
        <View
          accessible
          accessibilityLabel={`${formatMinutes(value)}`}
          style={{ minWidth: 88, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: F.monoMed, fontSize: 20, color: COLORS.ink }}>{formatMinutes(value)}</Text>
        </View>
        {stepBtn(1)}
      </View>
      {presets ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {LESSON_LENGTH_PRESETS.map(m => {
            const selected = m === value;
            return (
              <TouchableOpacity
                key={m}
                onPress={() => onChange(m)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${formatMinutes(m)} lesson`}
                activeOpacity={0.7}
                style={{
                  minHeight: MIN_TOUCH,
                  paddingHorizontal: 14,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: selected ? COLORS.ink : COLORS.paperEdge,
                  backgroundColor: selected ? COLORS.ink : COLORS.transparent,
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontFamily: F.mono, fontSize: 14, color: selected ? COLORS.paper : COLORS.ink }}>{formatMinutes(m)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
      {caption ? (
        <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, marginTop: 6 }}>{caption}</Text>
      ) : null}
    </View>
  );
}

// ─── Travel km ───────────────────────────────────────────────────────────────

export function TravelKmField({
  text,
  onChangeText,
  error,
  defaultKm,
}: {
  text: string;
  onChangeText: (t: string) => void;
  error?: string | null;
  /** Student's default km, shown as a hint. */
  defaultKm?: number | null;
}) {
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput
          value={text}
          onChangeText={onChangeText}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={COLORS.inkFaint}
          accessibilityLabel="Travel kilometres"
          style={{
            fontFamily: F.mono,
            fontSize: 16,
            color: COLORS.ink,
            minWidth: 96,
            minHeight: MIN_TOUCH,
            borderBottomWidth: 1,
            borderBottomColor: error ? COLORS.crimson : COLORS.paperEdge,
            paddingVertical: 8,
          }}
        />
        <Text style={{ fontFamily: F.mono, fontSize: 14, color: COLORS.inkSoft }}>km</Text>
        {defaultKm != null ? (
          <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint, marginLeft: 8, flexShrink: 1 }}>
            {`student default ${defaultKm} km`}
          </Text>
        ) : null}
      </View>
      {error ? <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.crimson, marginTop: 6 }}>{error}</Text> : null}
    </View>
  );
}

// ─── Topics ──────────────────────────────────────────────────────────────────

export function TopicsField({
  topics,
  selected,
  onToggle,
  onAdd,
}: {
  topics: string[];
  selected: string[];
  onToggle: (t: string) => void;
  onAdd: (t: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');

  function submit() {
    const t = text.trim();
    if (t) onAdd(t);
    setText('');
    setAdding(false);
  }

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {topics.map(t => (
        <TopicChip key={t} label={t} selected={selected.includes(t)} onPress={() => onToggle(t)} />
      ))}
      {adding ? (
        <TextInput
          autoFocus
          value={text}
          onChangeText={setText}
          onSubmitEditing={submit}
          onBlur={submit}
          placeholder="Topic name…"
          placeholderTextColor={COLORS.inkFaint}
          returnKeyType="done"
          accessibilityLabel="New topic"
          style={{
            fontFamily: F.sans,
            fontSize: 13,
            color: COLORS.ink,
            borderWidth: 1,
            borderColor: COLORS.ink,
            borderRadius: 999,
            paddingHorizontal: 12,
            minHeight: 36,
            minWidth: 120,
          }}
        />
      ) : (
        <TouchableOpacity
          onPress={() => setAdding(true)}
          activeOpacity={0.75}
          hitSlop={hitSlopFor(36)}
          accessibilityRole="button"
          accessibilityLabel="Add a topic"
          style={{
            borderWidth: 1,
            borderColor: COLORS.inkFaint,
            borderStyle: 'dashed',
            borderRadius: 999,
            paddingHorizontal: 12,
            minHeight: 36,
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft }}>+ Add</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Preview ─────────────────────────────────────────────────────────────────

/** Live "what will happen" lines under the form. */
export function LessonPreview({
  balanceText,
  owes,
  travelText,
}: {
  balanceText: string | null;
  owes: boolean;
  travelText: string | null;
}) {
  if (!balanceText && !travelText) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 12, padding: 12, gap: 6, backgroundColor: COLORS.cardFill }}
    >
      {balanceText ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="clock" size={14} color={owes ? COLORS.crimson : COLORS.inkSoft} />
          <Text style={{ fontFamily: F.mono, fontSize: 13, color: owes ? COLORS.crimson : COLORS.ink, flexShrink: 1 }}>{balanceText}</Text>
        </View>
      ) : null}
      {travelText ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="map-pin" size={14} color={COLORS.inkSoft} />
          <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.ink, flexShrink: 1 }}>{travelText}</Text>
        </View>
      ) : null}
    </View>
  );
}
