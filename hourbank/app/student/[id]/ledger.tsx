import React, { useCallback, useState } from 'react';
import { SectionList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { F } from '../../../src/theme/fonts';
import { COLORS } from '../../../src/theme/colors';
import { ScreenHeader } from '../../../src/components/ScreenHeader';
import { getStudent, listArchivedStudents } from '../../../src/db/students';
import { currentBalance, lastNEntries } from '../../../src/db/ledger';
import { listForStudent } from '../../../src/db/sessions';
import { LedgerEntry, Student } from '../../../src/db/schema';
import { formatHours, formatHoursSigned } from '../../../src/utils/format';
import { balanceColour, balanceStatus } from '../../../src/utils/balance';
import { StudentLedgerRow } from '../../../src/components/student/StudentLedgerRow';
import { LoadingState, NotFoundState } from '../../../src/components/student/ui';
import { groupLedgerByMonth, ledgerRowHref, sumHours } from '../../../src/components/student/flowLogic';

/** Upper bound for one student's ledger — far beyond any realistic history. */
const ALL_ENTRIES = 100_000;

type LoadState = {
  student: Student | null;
  archived: boolean;
  balance: number;
  entries: LedgerEntry[];
  topicsBySession: Record<string, string>;
};

export default function StudentLedgerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<LoadState | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setData({
        student,
        archived,
        balance: student ? currentBalance(id) : 0,
        entries: student ? lastNEntries(id, ALL_ENTRIES) : [],
        topicsBySession,
      });
      setError(null);
    } catch {
      setError("Couldn't load the ledger");
      setData(d => d ?? { student: null, archived: false, balance: 0, entries: [], topicsBySession: {} });
    }
  }, [id]);

  useFocusEffect(load);

  if (!data) return <LoadingState />;
  if (!data.student) {
    return <NotFoundState title={error ?? 'Student not found'} onBack={() => router.back()} />;
  }

  const sections = groupLedgerByMonth(data.entries).map(g => ({ ...g, data: g.entries }));
  const name = data.student.full_name.trim();

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
                {Math.round(data.balance * 60) < 0 ? 'OWES' : 'BALANCE'}
              </Text>
              <Text style={{ fontFamily: F.monoMed, fontSize: 20, color: balanceColour(balanceStatus(data.balance)) }}>
                {formatHours(Math.abs(data.balance))}
              </Text>
              <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint }}>
                {`· ${data.entries.length} ${data.entries.length === 1 ? 'entry' : 'entries'}`}
              </Text>
            </View>
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
