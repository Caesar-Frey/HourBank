/**
 * Money → In: what came in this month (cash, lessons delivered) plus what is
 * outstanding right now (hours owed / prepaid hours not yet taught).
 */
import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { COLORS } from '../../theme/colors';
import { F, MIN_TOUCH } from '../../theme/fonts';
import {
  getMonthSummary,
  listSessionsForMonth,
  listTopUpsForMonth,
  MonthSummary,
  SessionListRow,
  TopUpRow,
} from '../../db/reports';
import { listActiveStudents, listPausedStudents } from '../../db/students';
import { formatHours, formatLedgerDate, formatRand, pluralize } from '../../utils/format';
import { SegmentedControl } from '../../components/calendar/SegmentedControl';
import { modeLabel, paymentMethodLabel, sessionTypeLabel } from '../schedule/labels';
import {
  Outstanding,
  isChargedNoShow,
  isFutureMonth,
  lessonBilledLabel,
  outstandingFromBalances,
  shiftMonth,
} from './moneyModel';

type List = 'cash' | 'lessons' | 'students';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const EYEBROW = {
  fontFamily: F.mono,
  fontSize: 9,
  color: COLORS.inkFaint,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  marginBottom: 6,
};

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={{ flex: 1, borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 14, backgroundColor: COLORS.cardFill, padding: 14 }}>
      <Text style={EYEBROW}>{label}</Text>
      <Text style={{ fontFamily: F.mono, fontSize: 17, color: COLORS.ink }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {sub ? <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkSoft, marginTop: 2 }}>{sub}</Text> : null}
    </View>
  );
}

function DateCol({ iso }: { iso: string }) {
  const { day, month } = formatLedgerDate(iso);
  return (
    <View style={{ alignItems: 'center', minWidth: 32 }}>
      <Text style={{ fontFamily: F.mono, fontSize: 16, color: COLORS.ink, lineHeight: 18 }}>{day}</Text>
      <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint }}>{month}</Text>
    </View>
  );
}

function Empty({ children }: { children: string }) {
  return (
    <Text style={{ fontFamily: F.serifItalic, fontSize: 14, color: COLORS.inkFaint, textAlign: 'center', marginTop: 28 }}>
      {children}
    </Text>
  );
}

export function MoneyInView() {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [monthIdx, setMonthIdx] = useState(now.getMonth());
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [topUps, setTopUps] = useState<TopUpRow[]>([]);
  const [lessons, setLessons] = useState<SessionListRow[]>([]);
  const [outstanding, setOutstanding] = useState<Outstanding | null>(null);
  const [list, setList] = useState<List>('cash');
  const [error, setError] = useState(false);
  const navigating = useRef(false);

  const load = useCallback(() => {
    navigating.current = false;
    try {
      setSummary(getMonthSummary(year, monthIdx));
      setTopUps(listTopUpsForMonth(year, monthIdx));
      setLessons(listSessionsForMonth(year, monthIdx));
      const balances = [...listActiveStudents(), ...listPausedStudents()].map(s => s.current_balance);
      setOutstanding(outstandingFromBalances(balances));
      setError(false);
    } catch {
      setError(true);
    }
  }, [year, monthIdx]);

  useFocusEffect(load);

  function move(delta: number) {
    const next = shiftMonth(year, monthIdx, delta);
    if (isFutureMonth(next.year, next.monthIdx)) return;
    setYear(next.year);
    setMonthIdx(next.monthIdx);
  }

  function go(href: string) {
    if (navigating.current) return;
    navigating.current = true;
    router.push(href as Href);
  }

  const nextMonth = shiftMonth(year, monthIdx, 1);
  const atCurrentMonth = isFutureMonth(nextMonth.year, nextMonth.monthIdx);

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
      {/* Month switcher */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
        <TouchableOpacity
          onPress={() => move(-1)}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          style={{ minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}
        >
          <Feather name="chevron-left" size={22} color={COLORS.inkSoft} />
        </TouchableOpacity>
        <Text accessibilityRole="header" style={{ fontFamily: F.serif, fontSize: 22, color: COLORS.ink, flex: 1, textAlign: 'center' }}>
          {`${MONTH_NAMES[monthIdx]} ${year}`}
        </Text>
        <TouchableOpacity
          onPress={() => move(1)}
          disabled={atCurrentMonth}
          accessibilityRole="button"
          accessibilityLabel="Next month"
          accessibilityState={{ disabled: atCurrentMonth }}
          style={{ minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', opacity: atCurrentMonth ? 0.3 : 1 }}
        >
          <Feather name="chevron-right" size={22} color={COLORS.inkSoft} />
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={{ alignItems: 'center', paddingVertical: 24, gap: 8 }}>
          <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.crimson }}>Couldn’t load this month’s figures.</Text>
          <TouchableOpacity onPress={load} accessibilityRole="button" style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.oxblood }}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {summary ? (
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
          <Tile label="Cash received" value={formatRand(summary.totalCashRand)} />
          <Tile
            label="Hours taught"
            value={formatHours(summary.totalHours)}
            sub={`${summary.totalLessons} ${pluralize(summary.totalLessons, 'lesson')}`}
          />
        </View>
      ) : null}

      {outstanding ? (
        <View style={{ borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 14, padding: 14, marginBottom: 20 }}>
          <Text style={EYEBROW}>Outstanding right now</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft }}>
              Owed by {outstanding.owingStudents} {pluralize(outstanding.owingStudents, 'student')}
            </Text>
            <Text style={{ fontFamily: F.monoMed, fontSize: 15, color: outstanding.owedHours > 0 ? COLORS.crimson : COLORS.ink }}>
              {formatHours(outstanding.owedHours)}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft }}>Prepaid, not yet taught</Text>
            <Text style={{ fontFamily: F.monoMed, fontSize: 15, color: COLORS.ink }}>{formatHours(outstanding.prepaidHours)}</Text>
          </View>
        </View>
      ) : null}

      <SegmentedControl
        options={[
          { value: 'cash', label: 'Cash' },
          { value: 'lessons', label: 'Lessons' },
          { value: 'students', label: 'By student' },
        ]}
        value={list}
        onChange={setList}
        style={{ marginBottom: 12 }}
      />

      {list === 'cash' &&
        (topUps.length === 0 ? (
          <Empty>No payments received this month.</Empty>
        ) : (
          topUps.map(row => (
            <TouchableOpacity
              key={row.id}
              onPress={() => go(`/transaction/${row.id}`)}
              activeOpacity={0.7}
              accessibilityRole="button"
              style={{ borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge, paddingVertical: 12, minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: 12 }}
            >
              <DateCol iso={row.created_at} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.serif, fontSize: 15, color: COLORS.ink }} numberOfLines={1}>{row.student_full_name}</Text>
                <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkSoft, marginTop: 2 }}>
                  {[paymentMethodLabel(row.payment_method), `+${formatHours(row.hours_delta)}`].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Text style={{ fontFamily: F.monoMed, fontSize: 14, color: COLORS.moss }}>
                {row.amount_paid != null ? formatRand(row.amount_paid) : '—'}
              </Text>
              <Feather name="chevron-right" size={14} color={COLORS.inkFaint} />
            </TouchableOpacity>
          ))
        ))}

      {list === 'lessons' &&
        (lessons.length === 0 ? (
          <Empty>No lessons taught this month.</Empty>
        ) : (
          lessons.map(row => {
            const noShow = isChargedNoShow(row);
            const meta = [modeLabel(row.mode), row.session_type !== 'general' ? sessionTypeLabel(row.session_type) : null]
              .filter(Boolean)
              .join(' · ');
            return (
              <TouchableOpacity
                key={row.id}
                onPress={() => go(`/lesson/${row.id}`)}
                activeOpacity={0.7}
                accessibilityRole="button"
                style={{ borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge, paddingVertical: 12, minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: 12 }}
              >
                <DateCol iso={row.ended_at} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: F.serif, fontSize: 15, color: COLORS.ink }} numberOfLines={1}>{row.student_full_name}</Text>
                  <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkSoft, marginTop: 2 }}>{meta}</Text>
                  {noShow ? (
                    <Text style={{ fontFamily: F.sansMed, fontSize: 11, color: COLORS.oxblood, marginTop: 2 }}>No-show · charged</Text>
                  ) : null}
                </View>
                <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.ink }}>{lessonBilledLabel(row)}</Text>
                <Feather name="chevron-right" size={14} color={COLORS.inkFaint} />
              </TouchableOpacity>
            );
          })
        ))}

      {list === 'students' &&
        (!summary || summary.perStudent.length === 0 ? (
          <Empty>No activity this month.</Empty>
        ) : (
          <View>
            <View style={{ flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge }}>
              <Text style={[EYEBROW, { flex: 1, marginBottom: 0 }]}>Student</Text>
              <Text style={[EYEBROW, { width: 44, textAlign: 'right', marginBottom: 0 }]}>Lsns</Text>
              <Text style={[EYEBROW, { width: 64, textAlign: 'right', marginBottom: 0 }]}>Hours</Text>
              <Text style={[EYEBROW, { width: 96, textAlign: 'right', marginBottom: 0 }]}>Cash</Text>
            </View>
            {summary.perStudent.map(r => (
              <TouchableOpacity
                key={r.studentId}
                onPress={() => go(`/student/${r.studentId}`)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`${r.name}: ${r.sessions} lessons, ${formatHours(r.hours)}, ${formatRand(r.cashRand)}`}
                style={{ flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH, borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge }}
              >
                <Text style={{ flex: 1, fontFamily: F.serif, fontSize: 14, color: COLORS.ink }} numberOfLines={1}>{r.name}</Text>
                <Text style={{ width: 44, textAlign: 'right', fontFamily: F.mono, fontSize: 12, color: COLORS.ink }}>{r.sessions}</Text>
                <Text style={{ width: 64, textAlign: 'right', fontFamily: F.mono, fontSize: 12, color: COLORS.ink }}>{formatHours(r.hours)}</Text>
                <Text style={{ width: 96, textAlign: 'right', fontFamily: F.mono, fontSize: 12, color: COLORS.ink }} numberOfLines={1}>
                  {formatRand(r.cashRand)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
    </ScrollView>
  );
}
