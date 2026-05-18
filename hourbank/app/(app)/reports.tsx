import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { F } from '../../src/theme/fonts';
import { COLORS } from '../../src/theme/colors';
import {
  getMonthSummary,
  listTopUpsForMonth,
  listSessionsForMonth,
  MonthSummary,
  TopUpRow,
  SessionListRow,
} from '../../src/db/reports';
import { formatRand, formatHours, formatBilledDuration, formatLedgerDate } from '../../src/utils/format';

type Tab = 'cash' | 'sessions';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function ReportsScreen() {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [monthIdx, setMonthIdx] = useState(now.getMonth());
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [topUps, setTopUps] = useState<TopUpRow[]>([]);
  const [sessions, setSessions] = useState<SessionListRow[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('cash');

  const isCurrentMonth = year === now.getFullYear() && monthIdx === now.getMonth();

  const loadData = useCallback(() => {
    try {
      setSummary(getMonthSummary(year, monthIdx));
      setTopUps(listTopUpsForMonth(year, monthIdx));
      setSessions(listSessionsForMonth(year, monthIdx));
    } catch (e) {
      console.error('Reports query error', e);
    }
  }, [year, monthIdx]);

  // useFocusEffect handles both initial load and reload on tab focus;
  // no separate useEffect needed — prevents double-load on mount
  useFocusEffect(loadData);

  function goPrev() {
    if (monthIdx === 0) { setYear(y => y - 1); setMonthIdx(11); }
    else setMonthIdx(m => m - 1);
  }

  function goNext() {
    if (isCurrentMonth) return;
    if (monthIdx === 11) { setYear(y => y + 1); setMonthIdx(0); }
    else setMonthIdx(m => m + 1);
  }

  const tileStyle = {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.paperEdge,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.4)',
    padding: 16,
  } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 }}>

        {/* Eyebrow */}
        <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
          Billing Overview
        </Text>

        {/* Month selector */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
          <TouchableOpacity onPress={goPrev} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 22, color: COLORS.inkSoft, paddingRight: 16 }}>‹</Text>
          </TouchableOpacity>
          <Text style={{ fontFamily: F.serif, fontSize: 22, color: COLORS.ink, flex: 1, textAlign: 'center' }}>
            {`${MONTH_NAMES[monthIdx]} ${year}`}
          </Text>
          <TouchableOpacity onPress={goNext} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }} disabled={isCurrentMonth}>
            <Text style={{ fontFamily: F.mono, fontSize: 22, color: isCurrentMonth ? COLORS.paperEdge : COLORS.inkSoft, paddingLeft: 16 }}>
              ›
            </Text>
          </TouchableOpacity>
        </View>

        {/* Summary tiles */}
        {summary && (
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 28 }}>
            <View style={tileStyle}>
              <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                CASH RECEIVED
              </Text>
              <Text style={{ fontFamily: F.mono, fontSize: 18, color: COLORS.ink }}>
                {formatRand(summary.totalCashRand)}
              </Text>
            </View>
            <View style={tileStyle}>
              <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                HOURS DELIVERED
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                <Text style={{ fontFamily: F.mono, fontSize: 18, color: COLORS.ink }}>
                  {summary.totalHours.toFixed(1)}
                </Text>
                <Text style={{ fontFamily: F.serifItalic, fontSize: 12, color: COLORS.inkSoft }}>hrs</Text>
              </View>
            </View>
          </View>
        )}

        {/* Segmented tab control */}
        <View style={{ flexDirection: 'row', marginBottom: 20, borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 8, overflow: 'hidden' }}>
          {(['cash', 'sessions'] as Tab[]).map(tab => (
            <TouchableOpacity
              key={tab}
              onPress={() => setActiveTab(tab)}
              activeOpacity={0.7}
              style={{
                flex: 1,
                paddingVertical: 10,
                alignItems: 'center',
                backgroundColor: activeTab === tab ? COLORS.ink : 'transparent',
              }}
            >
              <Text style={{ fontFamily: F.mono, fontSize: 11, color: activeTab === tab ? COLORS.paper : COLORS.inkFaint, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {tab === 'cash' ? 'CASH' : 'SESSIONS'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* CASH tab */}
        {activeTab === 'cash' && (
          topUps.length === 0 ? (
            <Text style={{ fontFamily: F.serifItalic, fontSize: 14, color: COLORS.inkFaint, textAlign: 'center', marginTop: 32 }}>
              No cash received this month.
            </Text>
          ) : (
            topUps.map(row => {
              const { day, month } = formatLedgerDate(row.created_at);
              return (
                <TouchableOpacity
                  key={row.id}
                  onPress={() => router.push(`/transaction/${row.id}`)}
                  activeOpacity={0.7}
                  style={{ borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ alignItems: 'center', minWidth: 32 }}>
                      <Text style={{ fontFamily: F.mono, fontSize: 16, color: COLORS.ink, lineHeight: 18 }}>{day}</Text>
                      <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint }}>{month}</Text>
                    </View>
                    <Text style={{ fontFamily: F.serif, fontSize: 15, color: COLORS.ink }}>{row.student_full_name}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.moss }}>+{formatHours(row.hours_delta)}</Text>
                    <Feather name="chevron-right" size={14} color={COLORS.inkFaint} />
                  </View>
                </TouchableOpacity>
              );
            })
          )
        )}

        {/* SESSIONS tab */}
        {activeTab === 'sessions' && (
          sessions.length === 0 ? (
            <Text style={{ fontFamily: F.serifItalic, fontSize: 14, color: COLORS.inkFaint, textAlign: 'center', marginTop: 32 }}>
              No sessions this month.
            </Text>
          ) : (
            sessions.map(row => {
              const { day, month } = formatLedgerDate(row.ended_at);
              const isVerified = row.status === 'verified';
              return (
                <TouchableOpacity
                  key={row.id}
                  onPress={() => router.push(`/lesson/${row.id}`)}
                  activeOpacity={0.7}
                  style={{ borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ alignItems: 'center', minWidth: 32 }}>
                      <Text style={{ fontFamily: F.mono, fontSize: 16, color: COLORS.ink, lineHeight: 18 }}>{day}</Text>
                      <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint }}>{month}</Text>
                    </View>
                    <View>
                      <Text style={{ fontFamily: F.serif, fontSize: 15, color: COLORS.ink }}>{row.student_full_name}</Text>
                      <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                        <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint }}>
                          {row.mode === 'online' ? 'ONLINE' : 'IN-PERSON'}
                        </Text>
                        <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint }}>·</Text>
                        <Text style={{ fontFamily: F.mono, fontSize: 10, color: isVerified ? COLORS.moss : COLORS.amber }}>
                          {isVerified ? 'VERIFIED' : 'PENDING'}
                        </Text>
                        {row.session_type && row.session_type !== 'general' && (
                          <>
                            <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint }}>·</Text>
                            <Text style={{ fontFamily: F.sans, fontSize: 10, color: COLORS.inkFaint }}>
                              {row.session_type === 'review' ? 'Review' : row.session_type === 'test_prep' ? 'Test prep' : 'Exam prep'}
                            </Text>
                          </>
                        )}
                      </View>
                    </View>
                  </View>
                  <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.inkSoft }}>
                    {formatBilledDuration(row.duration)}
                  </Text>
                </TouchableOpacity>
              );
            })
          )
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
