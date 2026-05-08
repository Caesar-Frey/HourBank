import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { F } from '../../src/theme/fonts';
import { getMonthSummary, MonthSummary } from '../../src/db/reports';
import { formatRand, formatHours } from '../../src/utils/format';

export default function ReportsScreen() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [monthIdx, setMonthIdx] = useState(now.getMonth());
  const [summary, setSummary] = useState<MonthSummary | null>(null);

  useEffect(() => {
    try {
      setSummary(getMonthSummary(year, monthIdx));
    } catch (e) {
      console.error('Reports query error', e);
    }
  }, [year, monthIdx]);

  const isCurrentMonth = year === now.getFullYear() && monthIdx === now.getMonth();

  function goPrev() {
    if (monthIdx === 0) {
      setYear(y => y - 1);
      setMonthIdx(11);
    } else {
      setMonthIdx(m => m - 1);
    }
  }

  function goNext() {
    if (isCurrentMonth) return;
    if (monthIdx === 11) {
      setYear(y => y + 1);
      setMonthIdx(0);
    } else {
      setMonthIdx(m => m + 1);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F4EFE6' }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 }}>
        {/* Eyebrow */}
        <Text
          style={{
            fontFamily: F.mono,
            fontSize: 11,
            color: '#8A7E72',
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginBottom: 4,
          }}
        >
          Billing Overview
        </Text>

        {/* Month selector */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 24,
          }}
        >
          <TouchableOpacity onPress={goPrev} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 22, color: '#4A413A', paddingRight: 16 }}>‹</Text>
          </TouchableOpacity>
          <Text
            style={{
              fontFamily: F.serif,
              fontSize: 22,
              color: '#1B1714',
              flex: 1,
              textAlign: 'center',
            }}
          >
            {summary?.monthLabel ?? ''}
          </Text>
          <TouchableOpacity onPress={goNext} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }} disabled={isCurrentMonth}>
            <Text
              style={{
                fontFamily: F.mono,
                fontSize: 22,
                color: isCurrentMonth ? '#D9CFBF' : '#4A413A',
                paddingLeft: 16,
              }}
            >
              ›
            </Text>
          </TouchableOpacity>
        </View>

        {summary && (
          <>
            {/* Stat tiles */}
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 28 }}>
              <View
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderColor: '#D9CFBF',
                  borderRadius: 16,
                  backgroundColor: 'rgba(255,255,255,0.4)',
                  padding: 16,
                }}
              >
                <Text
                  style={{
                    fontFamily: F.mono,
                    fontSize: 9,
                    color: '#8A7E72',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    marginBottom: 6,
                  }}
                >
                  CASH RECEIVED
                </Text>
                <Text style={{ fontFamily: F.mono, fontSize: 18, color: '#1B1714' }}>
                  {formatRand(summary.totalCashRand)}
                </Text>
              </View>

              <View
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderColor: '#D9CFBF',
                  borderRadius: 16,
                  backgroundColor: 'rgba(255,255,255,0.4)',
                  padding: 16,
                }}
              >
                <Text
                  style={{
                    fontFamily: F.mono,
                    fontSize: 9,
                    color: '#8A7E72',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    marginBottom: 6,
                  }}
                >
                  HOURS DELIVERED
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                  <Text style={{ fontFamily: F.mono, fontSize: 18, color: '#1B1714' }}>
                    {summary.totalHours.toFixed(1)}
                  </Text>
                  <Text style={{ fontFamily: F.serifItalic, fontSize: 12, color: '#4A413A' }}>hrs</Text>
                </View>
              </View>
            </View>

            {/* Per-student section header */}
            <Text
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                color: '#8A7E72',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginBottom: 12,
              }}
            >
              STUDENTS
            </Text>

            {summary.perStudent.length === 0 ? (
              <View style={{ alignItems: 'center', marginTop: 32 }}>
                <Text
                  style={{
                    fontFamily: F.serifItalic,
                    fontSize: 14,
                    color: '#B5A99A',
                    textAlign: 'center',
                  }}
                >
                  No activity this month.
                </Text>
              </View>
            ) : (
              summary.perStudent.map(s => (
                <View
                  key={s.studentId}
                  style={{
                    borderBottomWidth: 1,
                    borderBottomColor: '#E8E0D5',
                    paddingVertical: 14,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1, marginRight: 12 }}>
                      <Text style={{ fontFamily: F.serif, fontSize: 15, color: '#1B1714' }}>
                        {s.name}
                      </Text>
                      <Text style={{ fontFamily: F.sans, fontSize: 11, color: '#8A7E72', marginTop: 1 }}>
                        {`Gr ${s.grade} · ${s.subject}`}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ fontFamily: F.mono, fontSize: 13, color: '#1B1714' }}>
                        {formatHours(s.hours)}
                      </Text>
                      <Text style={{ fontFamily: F.mono, fontSize: 10, color: '#8A7E72', marginTop: 1 }}>
                        {`${s.sessions} session${s.sessions !== 1 ? 's' : ''}`}
                      </Text>
                    </View>
                  </View>
                  {s.cashRand > 0 && (
                    <Text
                      style={{
                        fontFamily: F.mono,
                        fontSize: 11,
                        color: '#3F5641',
                        marginTop: 4,
                      }}
                    >
                      {`${formatRand(s.cashRand)} received`}
                    </Text>
                  )}
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
