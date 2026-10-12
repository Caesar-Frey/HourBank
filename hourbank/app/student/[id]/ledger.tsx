import React, { useCallback, useState } from 'react';
import { ScrollView, SectionList, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { F, hitSlopFor } from '../../../src/theme/fonts';
import { COLORS } from '../../../src/theme/colors';
import { ScreenHeader } from '../../../src/components/ScreenHeader';
import { getStudent, listArchivedStudents } from '../../../src/db/students';
import { currentBalance, LedgerRow, listLedger } from '../../../src/db/ledger';
import { getSubjectBalances, SubjectBalance } from '../../../src/db/subjects';
import { listForStudent } from '../../../src/db/sessions';
import { Student } from '../../../src/db/schema';
import { formatHours, formatHoursSigned } from '../../../src/utils/format';
import { balanceColour, balanceStatus } from '../../../src/utils/balance';
import { StudentLedgerRow } from '../../../src/components/student/StudentLedgerRow';
import { LoadingState, NotFoundState } from '../../../src/components/student/ui';
import { groupLedgerByMonth, ledgerRowHref, sumHours } from '../../../src/components/student/flowLogic';

type LoadState = {
  student: Student | null;
  archived: boolean;
  balance: number;
  entries: LedgerRow[];
  subjects: SubjectBalance[];
  topicsBySession: Record<string, string>;
};

export default function StudentLedgerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<LoadState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** null = all subjects. */
  const [subjectId, setSubjectId] = useState<string | null>(null);

  const load = useCallback(() => {
    try {
      let student = getStudent(id);
      let archived = false;
      if (!student) {
        student = listArchivedStudents().find(s => s.id === id) ?? null;
        archived = !!student;
      }
      const topicsBySession: Record<string, string> = {};
      if (student) {
        for (const s of listForStudent(id)) topicsBySession[s.id] = s.topics;
      }
      const subjects = student ? getSubjectBalances(id) : [];
      // A filter on a subject that no longer shows (archived at 0h) falls back to All.
      const filter = subjectId && subjects.some(s => s.id === subjectId) ? subjectId : null;
      setData({
        student,
        archived,
        balance: student ? (filter ? subjects.find(s => s.id === filter)!.balance_hours : currentBalance(id)) : 0,
        // balance_after is recomputed live per subject by listLedger.
        entries: student ? listLedger(id, filter ? { subjectId: filter } : {}) : [],
        subjects,
        topicsBySession,
      });
      setError(null);
    } catch {
      setError("Couldn't load the ledger");
      setData(d => d ?? { student: null, archived: false, balance: 0, entries: [], subjects: [], topicsBySession: {} });
    }
  }, [id, subjectId]);

  useFocusEffect(load);

  if (!data) return <LoadingState />;
  if (!data.student) {
    return <NotFoundState title={error ?? 'Student not found'} onBack={() => router.back()} />;
  }

  const sections = groupLedgerByMonth(data.entries).map(g => ({ ...g, data: g.entries }));
  const name = data.student.full_name.trim();
  const multiSubject = data.subjects.length > 1;
  const filterOptions: Array<{ id: string | null; label: string }> = [
    { id: null, label: 'All' },
    ...data.subjects.map(s => ({ id: s.id, label: s.status === 'archived' ? `${s.subject} (archived)` : s.subject })),
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top', 'bottom']}>
      <ScreenHeader backLabel={name.split(/\s+/)[0].toUpperCase()} onBack={() => router.back()} title="Ledger" />
      <SectionList
        sections={sections}
        keyExtractor={e => e.id}
        stickySectionHeadersEnabled
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 48 }}
        ListHeaderComponent={
          <View style={{ paddingTop: 16, paddingBottom: 8 }}>
            <Text style={{ fontFamily: F.serif, fontSize: 26, color: COLORS.ink }}>{name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
              <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint }}>
                {`${subjectId && multiSubject ? `${data.subjects.find(s => s.id === subjectId)?.subject.toUpperCase() ?? ''} ` : ''}${Math.round(data.balance * 60) < 0 ? 'OWES' : 'BALANCE'}`}
              </Text>
              <Text style={{ fontFamily: F.monoMed, fontSize: 20, color: balanceColour(balanceStatus(data.balance)) }}>
                {formatHours(Math.abs(data.balance))}
              </Text>
              <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint }}>
                {`· ${data.entries.length} ${data.entries.length === 1 ? 'entry' : 'entries'}`}
              </Text>
            </View>
            {multiSubject ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingTop: 12 }}
                accessibilityRole="tablist"
              >
                {filterOptions.map(o => {
                  const on = o.id === subjectId;
                  return (
                    <TouchableOpacity
                      key={o.id ?? 'all'}
                      onPress={() => setSubjectId(o.id)}
                      activeOpacity={0.75}
                      hitSlop={hitSlopFor(36)}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`Show ${o.label}`}
                      style={{
                        minHeight: 36,
                        justifyContent: 'center',
                        paddingHorizontal: 14,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: on ? COLORS.ink : COLORS.paperEdge,
                        backgroundColor: on ? COLORS.ink : COLORS.transparent,
                      }}
                    >
                      <Text style={{ fontFamily: F.sans, fontSize: 13, color: on ? COLORS.paper : COLORS.ink }}>{o.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            ) : null}
            {data.archived ? (
              <Text style={{ fontFamily: F.serifItalic, fontSize: 13, color: COLORS.inkSoft, marginTop: 6 }}>
                Archived student — read only. Restore them from the archived list to make changes.
              </Text>
            ) : null}
            {error ? (
              <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.crimson, marginTop: 6 }}>{error}</Text>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              paddingTop: 16,
              paddingBottom: 6,
              backgroundColor: COLORS.paper,
              borderBottomWidth: 1,
              borderBottomColor: COLORS.ink,
            }}
          >
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.ink, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {section.title}
            </Text>
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkSoft }}>
              {`net ${formatHoursSigned(sumHours(section.data))}`}
            </Text>
          </View>
        )}
        renderItem={({ item }) => (
          <StudentLedgerRow
            entry={item}
            sessionTopics={item.related_session_id ? data.topicsBySession[item.related_session_id] : null}
            subjectName={multiSubject && !subjectId ? item.subject_name : null}
            onPress={() => {
              const href = ledgerRowHref(item);
              if (href) router.push(href);
            }}
          />
        )}
        ListEmptyComponent={
          <Text style={{ fontFamily: F.serifItalic, fontSize: 14, color: COLORS.inkFaint, marginTop: 24 }}>
            No ledger entries yet.
          </Text>
        }
      />
    </SafeAreaView>
  );
}
