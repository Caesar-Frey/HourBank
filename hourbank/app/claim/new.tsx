import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { F } from '../../src/theme/fonts';
import { COLORS } from '../../src/theme/colors';
import { LazyDateTimePicker } from '../../src/components/LazyDateTimePicker';
import {
  listClaimablePool,
  buildClaim,
  finaliseClaim,
  ClaimablePoolLine,
} from '../../src/db/claims';
import { formatRand, formatHours, formatLedgerDate } from '../../src/utils/format';

function modeLabel(mode: 'in_person' | 'online'): string {
  return mode === 'online' ? 'ONLINE' : 'IN-PERSON';
}

export default function NewClaimScreen() {
  const router = useRouter();
  const [scopeAll, setScopeAll] = useState(true);
  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d;
  });
  const [endDate, setEndDate] = useState<Date>(() => new Date());
  const [pool, setPool] = useState<ClaimablePoolLine[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Half-open [start, end) range over ended_at; null ⇒ whole-pool claim.
  const range = useMemo(() => {
    if (scopeAll) return undefined;
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + 1); // make the selected end day inclusive
    return { start: start.toISOString(), end: end.toISOString() };
  }, [scopeAll, startDate, endDate]);

  const periodStart = range?.start ?? null;
  const periodEnd = range?.end ?? null;

  const loadPool = useCallback(() => {
    try {
      const lines = listClaimablePool(range);
      setPool(lines);
      setSelected(new Set(lines.map(l => l.session_id))); // all selected by default
    } catch (e) {
      console.error('Claim pool query error', e);
    }
  }, [range]);

  // Reload on focus and whenever the scope/range changes.
  useFocusEffect(loadPool);

  const selectedIds = useMemo(() => pool.filter(l => selected.has(l.session_id)).map(l => l.session_id), [pool, selected]);

  const preview = useMemo(
    () => buildClaim({ sessionIds: selectedIds, periodStart, periodEnd }),
    [selectedIds, periodStart, periodEnd]
  );

  function toggleRow(sessionId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }

  function onFinalise() {
    if (selectedIds.length === 0) return;
    try {
      const { claim } = finaliseClaim({ sessionIds: selectedIds, periodStart, periodEnd });
      router.replace('/claim/' + claim.id);
    } catch (e) {
      Alert.alert(
        'Claim could not be finalised',
        'One or more lessons are no longer claimable. The pool has been refreshed — please review and try again.'
      );
      loadPool();
    }
  }

  const canFinalise = selectedIds.length > 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 }}>

        {/* Back */}
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.7}
          style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}
        >
          <Feather name="arrow-left" size={16} color={COLORS.inkSoft} />
          <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkSoft, marginLeft: 6, textTransform: 'uppercase' }}>
            Back
          </Text>
        </TouchableOpacity>

        <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>
          New Claim
        </Text>
        <Text style={{ fontFamily: F.serif, fontSize: 26, color: COLORS.ink, marginBottom: 24 }}>
          Build a claim
        </Text>

        {/* ── Step 1: Scope ── */}
        <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Scope
        </Text>
        <View style={{ flexDirection: 'row', marginBottom: 16, borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 8, overflow: 'hidden' }}>
          {([true, false] as const).map(isAll => (
            <TouchableOpacity
              key={String(isAll)}
              onPress={() => setScopeAll(isAll)}
              activeOpacity={0.7}
              style={{ flex: 1, paddingVertical: 10, alignItems: 'center', backgroundColor: scopeAll === isAll ? COLORS.ink : 'transparent' }}
            >
              <Text style={{ fontFamily: F.mono, fontSize: 11, color: scopeAll === isAll ? COLORS.paper : COLORS.inkFaint, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {isAll ? 'Whole pool' : 'Date range'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {!scopeAll && (
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 20 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>From</Text>
              <LazyDateTimePicker
                value={startDate}
                mode="date"
                onChange={(_e, d) => { if (d) setStartDate(d); }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>To</Text>
              <LazyDateTimePicker
                value={endDate}
                mode="date"
                onChange={(_e, d) => { if (d) setEndDate(d); }}
              />
            </View>
          </View>
        )}

        {/* ── Step 2: Hold-back selection ── */}
        <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, textTransform: 'uppercase', letterSpacing: 1, marginTop: 8, marginBottom: 8 }}>
          Lessons ({selectedIds.length}/{pool.length})
        </Text>
        {pool.length === 0 ? (
          <Text style={{ fontFamily: F.serifItalic, fontSize: 14, color: COLORS.inkFaint, textAlign: 'center', marginVertical: 24 }}>
            No claimable lessons in this scope.
          </Text>
        ) : (
          pool.map(line => {
            const { day, month } = formatLedgerDate(line.ended_at);
            const isSelected = selected.has(line.session_id);
            return (
              <TouchableOpacity
                key={line.session_id}
                onPress={() => toggleRow(line.session_id)}
                activeOpacity={0.7}
                style={{ borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}
              >
                {/* Checkbox */}
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: isSelected ? COLORS.ink : COLORS.paperEdge,
                    backgroundColor: isSelected ? COLORS.ink : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isSelected && <Feather name="check" size={14} color={COLORS.paper} />}
                </View>

                {/* Date */}
                <View style={{ alignItems: 'center', minWidth: 32 }}>
                  <Text style={{ fontFamily: F.mono, fontSize: 16, color: COLORS.ink, lineHeight: 18 }}>{day}</Text>
                  <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint }}>{month}</Text>
                </View>

                {/* Details */}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: F.serif, fontSize: 15, color: COLORS.ink }}>{line.student_full_name}</Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                    <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint }}>{modeLabel(line.mode)}</Text>
                    <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint }}>·</Text>
                    <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint }}>{formatHours(line.billed_hours)}</Text>
                  </View>
                </View>

                {/* Line total */}
                <Text style={{ fontFamily: F.mono, fontSize: 13, color: isSelected ? COLORS.ink : COLORS.inkFaint }}>
                  {formatRand(line.line_total)}
                </Text>
              </TouchableOpacity>
            );
          })
        )}

        {/* ── Step 3: Confirm ── */}
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 24, marginBottom: 20 }}>
          <View style={{ flex: 1, borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 14, padding: 14 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>Lesson fees</Text>
            <Text style={{ fontFamily: F.monoMed, fontSize: 16, color: COLORS.ink }}>{formatRand(preview.lessonFeeTotal)}</Text>
          </View>
          <View style={{ flex: 1, borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 14, padding: 14 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>Travel</Text>
            <Text style={{ fontFamily: F.monoMed, fontSize: 16, color: COLORS.ink }}>{formatRand(preview.travelTotal)}</Text>
          </View>
        </View>
        <View style={{ borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 14, padding: 14, marginBottom: 24 }}>
          <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>Grand total</Text>
          <Text style={{ fontFamily: F.monoMed, fontSize: 24, color: COLORS.ink }}>{formatRand(preview.grandTotal)}</Text>
        </View>

        <TouchableOpacity
          onPress={onFinalise}
          disabled={!canFinalise}
          activeOpacity={0.8}
          style={{ borderRadius: 12, paddingVertical: 16, alignItems: 'center', backgroundColor: canFinalise ? COLORS.ink : COLORS.paperEdge }}
        >
          <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: canFinalise ? COLORS.paper : COLORS.inkFaint }}>
            Finalise Claim
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
