/**
 * Subjects editor for the student form. Each subject has its own hours
 * balance, so saved subjects can only be archived (balance kept) — never
 * deleted. Unsaved rows can simply be removed.
 */
import React, { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, TextStyle, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { F, MIN_TOUCH, hitSlopFor } from '../../theme/fonts';
import { COLORS } from '../../theme/colors';
import { balanceColour, balanceStatus } from '../../utils/balance';
import { formatHours } from '../../utils/format';
import { FieldError, FieldHint, SectionLabel } from './ui';
import { cleanSubjectName, newSubjectDraft, SubjectDraft, subjectArchiveWarning } from './subjectLogic';

const INPUT: TextStyle = {
  flex: 1,
  fontFamily: F.sans,
  fontSize: 16,
  color: COLORS.ink,
  paddingVertical: 10,
};

interface Props {
  subjects: SubjectDraft[];
  onChange: (next: SubjectDraft[]) => void;
  /** Catalog + suggestion names. */
  suggestions: string[];
  grades: number[];
  curricula: string[];
  error?: string;
}

export function SubjectsEditor({ subjects, onChange, suggestions, grades, curricula, error }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const active = subjects.filter(d => !d.archived);
  const archived = subjects.filter(d => d.archived && d.id);
  const taken = new Set(active.map(d => cleanSubjectName(d.name).toLowerCase()));
  const quickAdd = suggestions.filter(s => !taken.has(s.toLowerCase())).slice(0, 8);
  const showBalances = subjects.some(d => d.id);

  function patch(key: string, p: Partial<SubjectDraft>) {
    onChange(subjects.map(d => (d.key === key ? { ...d, ...p } : d)));
  }

  function add(name = '') {
    const blank = active.find(d => !d.id && cleanSubjectName(d.name) === '');
    if (blank && name) {
      patch(blank.key, { name });
      return;
    }
    onChange([...subjects, newSubjectDraft(name)]);
  }

  function removeOrArchive(d: SubjectDraft) {
    if (!d.id) {
      onChange(subjects.filter(x => x.key !== d.key));
      return;
    }
    if (active.length <= 1) {
      Alert.alert('Keep one subject', 'A student needs at least one subject. Add the new one first, then archive this.');
      return;
    }
    const warning = subjectArchiveWarning(d);
    const label = cleanSubjectName(d.name) || 'this subject';
    Alert.alert(
      `Archive ${label}?`,
      warning ?? `${label} is hidden from pickers. Its history stays in the ledger.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Archive', style: 'destructive', onPress: () => patch(d.key, { archived: true }) },
      ],
    );
  }

  const pill = (on: boolean) => ({
    borderWidth: 1,
    borderColor: on ? COLORS.oxblood : COLORS.paperEdge,
    borderRadius: 8,
    backgroundColor: on ? COLORS.oxblood : COLORS.cardFill,
    minHeight: 36,
    minWidth: 40,
    paddingHorizontal: 10,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  });

  return (
    <View style={{ marginBottom: 22 }}>
      <SectionLabel>{active.length > 1 ? 'SUBJECTS · EACH HAS ITS OWN BALANCE' : 'SUBJECT'}</SectionLabel>

      {active.map((d, i) => {
        const open = expanded === d.key;
        const override = d.grade !== null || d.curriculum !== null;
        const overrideLabel = override
          ? [d.grade !== null ? `Gr ${d.grade}` : null, d.curriculum].filter(Boolean).join(' · ')
          : 'Same grade';
        const blank = cleanSubjectName(d.name) === '';
        return (
          <View key={d.key} style={{ borderBottomWidth: 1, borderBottomColor: error && blank ? COLORS.crimson : COLORS.paperEdge }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput
                value={d.name}
                onChangeText={v => patch(d.key, { name: v })}
                placeholder={i === 0 ? 'e.g. Mathematics' : 'Subject name'}
                placeholderTextColor={COLORS.inkFaint}
                autoCapitalize="words"
                accessibilityLabel={`Subject ${i + 1} name`}
                style={INPUT}
              />
              {showBalances && d.id ? (
                <Text style={{ fontFamily: F.mono, fontSize: 12, color: balanceColour(balanceStatus(d.balanceHours)) }}>
                  {Math.round(d.balanceHours * 60) < 0 ? `owes ${formatHours(-d.balanceHours)}` : formatHours(d.balanceHours)}
                </Text>
              ) : null}
              <TouchableOpacity
                onPress={() => setExpanded(open ? null : d.key)}
                hitSlop={hitSlopFor(28)}
                accessibilityRole="button"
                accessibilityLabel={`Grade and curriculum for ${d.name || 'this subject'}: ${overrideLabel}`}
                style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}
              >
                <Text style={{ fontFamily: F.mono, fontSize: 12, color: override ? COLORS.oxblood : COLORS.inkFaint }}>
                  {overrideLabel.toUpperCase()}
                </Text>
              </TouchableOpacity>
              {active.length > 1 || !d.id ? (
                <TouchableOpacity
                  onPress={() => removeOrArchive(d)}
                  hitSlop={hitSlopFor(28)}
                  accessibilityRole="button"
                  accessibilityLabel={d.id ? `Archive ${d.name}` : `Remove ${d.name || 'empty subject'}`}
                  style={{ minHeight: MIN_TOUCH, minWidth: 32, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Feather name={d.id ? 'archive' : 'x'} size={16} color={COLORS.inkSoft} />
                </TouchableOpacity>
              ) : null}
            </View>
            {open ? (
              <View style={{ paddingBottom: 12, gap: 8 }}>
                <FieldHint>Only if this subject is taught at a different grade or curriculum.</FieldHint>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  <TouchableOpacity
                    onPress={() => patch(d.key, { grade: null })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: d.grade === null }}
                    accessibilityLabel="Same grade as student"
                    style={pill(d.grade === null)}
                  >
                    <Text style={{ fontFamily: F.sans, fontSize: 12, color: d.grade === null ? COLORS.paper : COLORS.inkSoft }}>Same</Text>
                  </TouchableOpacity>
                  {grades.map(g => (
                    <TouchableOpacity
                      key={g}
                      onPress={() => patch(d.key, { grade: g })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: d.grade === g }}
                      accessibilityLabel={`Grade ${g}`}
                      style={pill(d.grade === g)}
                    >
                      <Text style={{ fontFamily: F.mono, fontSize: 13, color: d.grade === g ? COLORS.paper : COLORS.inkSoft }}>{g}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {[null, ...curricula].map(c => (
                    <TouchableOpacity
                      key={c ?? 'same'}
                      onPress={() => patch(d.key, { curriculum: c })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: d.curriculum === c }}
                      accessibilityLabel={c ?? 'Same curriculum as student'}
                      style={pill(d.curriculum === c)}
                    >
                      <Text style={{ fontFamily: c ? F.mono : F.sans, fontSize: c ? 11 : 12, color: d.curriculum === c ? COLORS.paper : COLORS.inkSoft }}>
                        {c ? c.toUpperCase() : 'Same'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ) : null}
          </View>
        );
      })}

      <TouchableOpacity
        onPress={() => add()}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Add another subject"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: MIN_TOUCH }}
      >
        <Feather name="plus" size={14} color={COLORS.oxblood} />
        <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.oxblood }}>Add subject</Text>
      </TouchableOpacity>
      {quickAdd.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {quickAdd.map(s => (
            <TouchableOpacity
              key={s}
              onPress={() => add(s)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Add ${s}`}
              style={{ borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 999, paddingHorizontal: 12, minHeight: 32, justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkSoft }}>{`+ ${s}`}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}

      {archived.length > 0 ? (
        <View style={{ marginTop: 12 }}>
          <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, letterSpacing: 0.4 }}>ARCHIVED</Text>
          {archived.map(d => (
            <View key={d.key} style={{ flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH }}>
              <Text style={{ flex: 1, fontFamily: F.serifItalic, fontSize: 14, color: COLORS.inkSoft }}>
                {d.name}
                {d.initiallyArchived ? '' : ' · on save'}
              </Text>
              {Math.round(d.balanceHours * 60) !== 0 ? (
                <Text style={{ fontFamily: F.mono, fontSize: 12, color: balanceColour(balanceStatus(d.balanceHours)), marginRight: 12 }}>
                  {Math.round(d.balanceHours * 60) < 0 ? `owes ${formatHours(-d.balanceHours)}` : formatHours(d.balanceHours)}
                </Text>
              ) : null}
              <TouchableOpacity
                onPress={() => patch(d.key, { archived: false })}
                hitSlop={hitSlopFor(28)}
                accessibilityRole="button"
                accessibilityLabel={`Restore ${d.name}`}
                style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}
              >
                <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.oxblood }}>{d.initiallyArchived ? 'RESTORE' : 'UNDO'}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
      <FieldError message={error} />
    </View>
  );
}
