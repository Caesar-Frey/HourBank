import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { F, MIN_TOUCH } from '../../src/theme/fonts';
import { COLORS } from '../../src/theme/colors';
import { FormScreen } from '../../src/components/FormScreen';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { useToast } from '../../src/components/Toast';
import { SegmentedControl } from '../../src/components/calendar/SegmentedControl';
import { DateField } from '../../src/components/calendar/DateField';
import { listClaimablePool, buildClaim, finaliseClaim, ClaimablePoolLine } from '../../src/db/claims';
import { formatClaimPeriod, formatDayShort, formatHours, formatLedgerDate, formatRand, pluralize } from '../../src/utils/format';
import { modeLabel } from '../../src/screens/schedule/labels';
import { lessonKmBySession } from '../../src/screens/money/moneyQueries';
import { kmLabel } from '../../src/utils/travelBilling';
import {
  claimRange,
  groupByStudent,
  holdBackAll,
  pruneHoldBacks,
  selectedIds as computeSelected,
  toggleHoldBack,
  validateClaimPeriod,
} from '../../src/screens/money/claimModel';

type Scope = 'all' | 'range';

const EYEBROW = {
  fontFamily: F.mono,
  fontSize: 10,
  color: COLORS.inkFaint,
  textTransform: 'uppercase' as const,
  letterSpacing: 1,
  marginBottom: 8,
};

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: checked ? COLORS.ink : COLORS.paperEdge,
        backgroundColor: checked ? COLORS.ink : COLORS.transparent,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {checked ? <Feather name="check" size={14} color={COLORS.paper} /> : null}
    </View>
  );
}

export default function NewClaimScreen() {
  const router = useRouter();
  const toast = useToast();
  const [scope, setScope] = useState<Scope>('all');
  const [fromDate, setFromDate] = useState<Date>(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [toDate, setToDate] = useState<Date>(() => new Date());
  const [picker, setPicker] = useState<'from' | 'to' | null>(null);
  const [pool, setPool] = useState<ClaimablePoolLine[]>([]);
  const [kmBySession, setKmBySession] = useState<Map<string, number | null>>(() => new Map());
  const [heldBack, setHeldBack] = useState<Set<string>>(() => new Set());
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const periodCheck = validateClaimPeriod(fromDate, toDate);
  const rangeInvalid = scope === 'range' && !periodCheck.ok;

  // Half-open [start, end); undefined ⇒ whole-pool claim.
  const range = useMemo(
    () => (scope === 'range' && periodCheck.ok ? claimRange(fromDate, toDate) : undefined),
    [scope, periodCheck.ok, fromDate, toDate],
  );

  const loadPool = useCallback(() => {
    if (rangeInvalid) {
      setPool([]);
      return;
    }
    try {
      const lines = listClaimablePool(range);
      setPool(lines);
      setKmBySession(lessonKmBySession(lines.filter(l => l.mode === 'in_person').map(l => l.session_id)));
      // Keep the tutor's hold-backs across reloads; just forget lessons that left the pool.
      setHeldBack(prev => pruneHoldBacks(prev, lines));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [range, rangeInvalid]);

  useFocusEffect(loadPool);

  const selected = useMemo(() => computeSelected(pool, heldBack), [pool, heldBack]);
  const groups = useMemo(() => groupByStudent(pool, heldBack), [pool, heldBack]);

  const preview = useMemo(() => {
    try {
      return buildClaim({ sessionIds: selected });
    } catch {
      return { lines: [], lessonFeeTotal: 0, travelTotal: 0, grandTotal: 0 };
    }
  }, [selected]);

  const periodStart = range?.start ?? null;
  const periodEnd = range?.end ?? null;
  const canFinalise = selected.length > 0 && !rangeInvalid && !saving;

  function doFinalise() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const { claim } = finaliseClaim({ sessionIds: selected, periodStart, periodEnd });
      toast.show({ kind: 'success', message: `Claim saved · ${formatRand(claim.grand_total)}` });
      router.replace(`/claim/${claim.id}` as Href);
    } catch (e) {
      savingRef.current = false;
      setSaving(false);
      const msg = e instanceof Error ? e.message : '';
      if (/no longer claimable/i.test(msg)) {
        Alert.alert(
          'Some lessons were already claimed',
          'Another claim already includes one or more of these lessons. The list has been refreshed — check it and try again.',
        );
        loadPool();
      } else {
        toast.show({ kind: 'error', message: 'Couldn’t save the claim. Nothing was saved — try again.' });
      }
    }
  }

  function onFinalise() {
    if (!canFinalise || savingRef.current) return;
    Alert.alert(
      `Finalise claim for ${formatRand(preview.grandTotal)}?`,
      `${selected.length} ${pluralize(selected.length, 'lesson')} · ${formatClaimPeriod(periodStart, periodEnd)}.\nA finalised claim can’t be edited — only voided.`,
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Finalise', onPress: doFinalise },
      ],
    );
  }

  const footer = (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkSoft }}>
          {selected.length}/{pool.length} {pluralize(pool.length, 'lesson')} · fees {formatRand(preview.lessonFeeTotal)} · travel{' '}
          {formatRand(preview.travelTotal)}
        </Text>
      </View>
      <TouchableOpacity
        onPress={onFinalise}
        disabled={!canFinalise}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canFinalise }}
        style={{
          borderRadius: 12,
          minHeight: 52,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: canFinalise ? COLORS.ink : COLORS.paperEdge,
          opacity: saving ? 0.6 : 1,
        }}
      >
        <Text style={{ fontFamily: F.monoMed, fontSize: 15, color: canFinalise ? COLORS.paper : COLORS.inkSoft }}>
          {`Finalise · ${formatRand(preview.grandTotal)}`}
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <FormScreen header={<ScreenHeader backLabel="MONEY" onBack={() => router.back()} title="New claim" />} footer={footer}>
      <Text style={{ fontFamily: F.serif, fontSize: 26, color: COLORS.ink, marginTop: 8, marginBottom: 20 }}>Build a claim</Text>

      {/* Scope */}
      <Text style={EYEBROW}>Which lessons</Text>
      <SegmentedControl
        options={[
          { value: 'all', label: 'Everything unclaimed' },
          { value: 'range', label: 'Date range' },
        ]}
        value={scope}
        onChange={s => {
          setScope(s);
          setPicker(null);
        }}
        style={{ marginBottom: 12 }}
      />

      {scope === 'range' ? (
        <View style={{ marginBottom: 8 }}>
          <DateField
            label="From"
            mode="date"
            value={fromDate}
            display={formatDayShort(fromDate)}
            open={picker === 'from'}
            onOpen={() => setPicker('from')}
            onClose={() => setPicker(null)}
            onChange={setFromDate}
          />
          <DateField
            label="To (inclusive)"
            mode="date"
            value={toDate}
            display={formatDayShort(toDate)}
            open={picker === 'to'}
            onOpen={() => setPicker('to')}
            onClose={() => setPicker(null)}
            onChange={setToDate}
            error={rangeInvalid}
          />
          {!periodCheck.ok ? (
            <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.crimson }}>{periodCheck.error}</Text>
          ) : null}
        </View>
      ) : null}

      {loadError ? (
        <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.crimson, marginVertical: 12 }}>
          Couldn’t load claimable lessons. Go back and try again.
        </Text>
      ) : null}

      {/* Lessons */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
        <Text style={[EYEBROW, { marginBottom: 0 }]}>
          Lessons ({selected.length}/{pool.length})
        </Text>
        {pool.length > 0 ? (
          <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity
              onPress={() => setHeldBack(new Set())}
              accessibilityRole="button"
              style={{ minHeight: MIN_TOUCH, paddingHorizontal: 8, justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: COLORS.oxblood }}>All</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setHeldBack(holdBackAll(pool))}
              accessibilityRole="button"
              style={{ minHeight: MIN_TOUCH, paddingHorizontal: 8, justifyContent: 'center' }}
            >
              <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: COLORS.oxblood }}>None</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {pool.length === 0 && !loadError ? (
        <Text style={{ fontFamily: F.serifItalic, fontSize: 14, color: COLORS.inkFaint, textAlign: 'center', marginVertical: 24 }}>
          {rangeInvalid ? 'Fix the dates to see lessons.' : 'No unclaimed lessons in this period.'}
        </Text>
      ) : null}

      {groups.map(group => (
        <View key={group.studentId} style={{ marginTop: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: COLORS.ink, paddingBottom: 4 }}>
            <Text style={{ fontFamily: F.serif, fontSize: 16, color: COLORS.ink, flex: 1 }} numberOfLines={1}>{group.studentName}</Text>
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkSoft }}>
              {group.selectedCount}/{group.lines.length} · {formatRand(group.selectedTotal)}
            </Text>
          </View>
          {group.lines.map(line => {
            const { day, month } = formatLedgerDate(line.ended_at);
            const isSelected = !heldBack.has(line.session_id);
            return (
              <TouchableOpacity
                key={line.session_id}
                onPress={() => setHeldBack(prev => toggleHoldBack(prev, line.session_id))}
                activeOpacity={0.7}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected }}
                accessibilityLabel={`${day} ${month}, ${formatHours(line.billed_hours)}, ${formatRand(line.line_total)}`}
                style={{ borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge, paddingVertical: 10, minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: 12 }}
              >
                <Checkbox checked={isSelected} />
                <View style={{ alignItems: 'center', minWidth: 32 }}>
                  <Text style={{ fontFamily: F.mono, fontSize: 15, color: COLORS.ink, lineHeight: 17 }}>{day}</Text>
                  <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint }}>{month}</Text>
                </View>
                <Text style={{ flex: 1, fontFamily: F.mono, fontSize: 11, color: COLORS.inkSoft }}>
                  {modeLabel(line.mode)} · {formatHours(line.billed_hours)}
                  {kmLabel(line.mode, kmBySession.get(line.session_id)) ? ` · ${kmLabel(line.mode, kmBySession.get(line.session_id))}` : ''}
                  {line.travel_fee > 0 ? ` · travel ${formatRand(line.travel_fee)}` : ''}
                </Text>
                <Text style={{ fontFamily: F.mono, fontSize: 13, color: isSelected ? COLORS.ink : COLORS.inkFaint, textDecorationLine: isSelected ? 'none' : 'line-through' }}>
                  {formatRand(line.line_total)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </FormScreen>
  );
}
