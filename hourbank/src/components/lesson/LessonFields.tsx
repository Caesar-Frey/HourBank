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
import { LESSON_MAX_MINUTES, LESSON_MIN_MINUTES, LESSON_STEP_MINUTES, parseMinutesInput } from './lessonFormLogic';
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

/** −15m / value / +15m with ≥44pt targets; tap the value to type minutes. */
export function BilledMinutesField({
  value,
  onChange,
  caption,
}: {
  value: number;
  onChange: (minutes: number) => void;
  caption?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  const step = (label: string, dir: 1 | -1, a11y: string) => {
    const enabled = dir < 0 ? value > LESSON_MIN_MINUTES : value < LESSON_MAX_MINUTES;
    return (
      <TouchableOpacity
        onPress={() => onChange(Math.min(LESSON_MAX_MINUTES, Math.max(LESSON_MIN_MINUTES, value + dir * LESSON_STEP_MINUTES)))}
        disabled={!enabled}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        activeOpacity={0.7}
        style={{
          minWidth: MIN_TOUCH + 8,
          minHeight: MIN_TOUCH,
          borderWidth: 1,
          borderColor: COLORS.paperEdge,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: enabled ? 1 : 0.4,
        }}
      >
        <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.ink }}>{label}</Text>
      </TouchableOpacity>
    );
  };

  function onType(t: string) {
    setText(t);
    const n = parseMinutesInput(t);
    if (n !== null) onChange(n);
  }

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {step(`−${LESSON_STEP_MINUTES}m`, -1, `Bill ${LESSON_STEP_MINUTES} minutes less`)}
        {editing ? (
          <TextInput
            autoFocus
            value={text}
            onChangeText={onType}
            onSubmitEditing={() => setEditing(false)}
            onBlur={() => setEditing(false)}
            keyboardType="number-pad"
            returnKeyType="done"
            selectTextOnFocus
            maxLength={3}
            accessibilityLabel="Billed minutes"
            style={{
              fontFamily: F.monoMed,
              fontSize: 18,
              color: COLORS.ink,
              minWidth: 88,
              minHeight: MIN_TOUCH,
              textAlign: 'center',
              borderBottomWidth: 1,
              borderBottomColor: COLORS.oxblood,
            }}
          />
        ) : (
          <TouchableOpacity
            onPress={() => {
              setText(String(value));
              setEditing(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Billed ${formatMinutes(value)}. Tap to type minutes.`}
            style={{ minWidth: 88, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontFamily: F.monoMed, fontSize: 20, color: COLORS.ink }}>{formatMinutes(value)}</Text>
            <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, letterSpacing: 0.5 }}>TAP TO TYPE</Text>
          </TouchableOpacity>
        )}
        {step(`+${LESSON_STEP_MINUTES}m`, 1, `Bill ${LESSON_STEP_MINUTES} minutes more`)}
      </View>
      {editing ? (
        <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkFaint, marginTop: 6 }}>Type minutes, e.g. 75.</Text>
      ) : caption ? (
        <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint, marginTop: 6 }}>{caption}</Text>
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
