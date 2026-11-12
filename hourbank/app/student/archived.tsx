import React, { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { F, MIN_TOUCH } from '../../src/theme/fonts';
import { COLORS } from '../../src/theme/colors';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { useToast } from '../../src/components/Toast';
import { listArchivedStudents, restoreStudent } from '../../src/db/students';
import { Student } from '../../src/db/schema';
import { getSubjectBalances } from '../../src/db/subjects';
import { formatHours } from '../../src/utils/format';
import { balanceColour, balanceStatus } from '../../src/utils/balance';
import { LoadingState } from '../../src/components/student/ui';

type ArchivedRow = Student & { current_balance: number; subjects: Array<{ name: string; balance: number }> };

function withSubjects(rows: Array<Student & { current_balance: number }>): ArchivedRow[] {
  return rows.map(r => {
    let subjects: ArchivedRow['subjects'] = [];
    try {
      subjects = getSubjectBalances(r.id).map(b => ({ name: b.subject, balance: b.balance_hours }));
    } catch { /* fall back to students.subject */ }
    return { ...r, subjects: subjects.length > 0 ? subjects : [{ name: r.subject, balance: r.current_balance }] };
  });
}

/** "Maths 2h · Science owes 30m" for several subjects; plain balance line for one. */
function balanceSummary(row: ArchivedRow): string {
  const fmt = (h: number) => (Math.round(h * 60) < 0 ? `owes ${formatHours(-h)}` : `${formatHours(h)} left`);
  if (row.subjects.length < 2) return fmt(row.current_balance);
  return row.subjects.map(s => `${s.name} ${Math.round(s.balance * 60) < 0 ? `owes ${formatHours(-s.balance)}` : formatHours(s.balance)}`).join(' · ');
}

export default function ArchivedStudentsScreen() {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<ArchivedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const restoringRef = useRef<string | null>(null);

  const load = useCallback(() => {
    try {
      setRows(withSubjects(listArchivedStudents()));
      setError(null);
    } catch {
      setRows(r => r ?? []);
      setError("Couldn't load archived students");
    }
  }, []);

  useFocusEffect(load);

  function restore(row: ArchivedRow) {
    const first = row.full_name.trim().split(/\s+/)[0];
    Alert.alert(
      `Restore ${row.full_name.trim()}?`,
      'They return to your active roster with their balance and history. Lessons cancelled when they were archived stay cancelled.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          onPress: () => {
            if (restoringRef.current) return;
            restoringRef.current = row.id;
            try {
              restoreStudent(row.id);
              toast.show({
                kind: 'success',
                message: `${first} restored`,
                actionLabel: 'Open',
                onAction: () => router.push(`/student/${row.id}?from=ARCHIVED`),
              });
              load();
            } catch {
              toast.show({ kind: 'error', message: `Couldn't restore ${first} — please try again` });
            } finally {
              restoringRef.current = null;
            }
          },
        },
      ],
    );
  }

  if (!rows) return <LoadingState />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top', 'bottom']}>
      <ScreenHeader backLabel="BACK" onBack={() => router.back()} title="Archived students" />
      <FlatList
        data={rows}
        keyExtractor={r => r.id}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 48 }}
        ListHeaderComponent={
          <View style={{ paddingTop: 16, paddingBottom: 8 }}>
            <Text style={{ fontFamily: F.serifItalic, fontSize: 14, color: COLORS.inkSoft }}>
              Archived students are hidden from your roster. Their ledger is kept — tap one to view it, or restore them.
            </Text>
            {error ? <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.crimson, marginTop: 6 }}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 48, gap: 8 }}>
            <Feather name="archive" size={28} color={COLORS.inkFaint} />
            <Text style={{ fontFamily: F.serif, fontSize: 20, color: COLORS.ink }}>Nothing archived</Text>
            <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkFaint, textAlign: 'center' }}>
              Students you archive from their page will show up here.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const owes = Math.round(item.current_balance * 60) < 0;
          return (
            <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: COLORS.paperEdge }}>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 12, minHeight: MIN_TOUCH + 8 }}
                activeOpacity={0.7}
                onPress={() => router.push(`/student/${item.id}/ledger`)}
                accessibilityRole="button"
                accessibilityLabel={`${item.full_name}, ${owes ? 'owes' : 'balance'} ${formatHours(Math.abs(item.current_balance))}. View ledger`}
              >
                <Text style={{ fontFamily: F.serif, fontSize: 17, color: COLORS.ink }}>{item.full_name}</Text>
                <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint, marginTop: 2 }}>
                  {`GR ${item.grade} · ${item.subjects.map(x => x.name).join(', ')}`}
                </Text>
                <Text style={{ fontFamily: F.mono, fontSize: 12, color: balanceColour(balanceStatus(Math.min(...item.subjects.map(x => x.balance)))), marginTop: 4 }}>
                  {balanceSummary(item)}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => restore(item)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={`Restore ${item.full_name}`}
                style={{
                  minHeight: MIN_TOUCH,
                  paddingHorizontal: 14,
                  borderWidth: 1,
                  borderColor: COLORS.ink,
                  borderRadius: 12,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Feather name="rotate-ccw" size={14} color={COLORS.ink} />
                <Text style={{ fontFamily: F.sansMed, fontSize: 13, color: COLORS.ink }}>Restore</Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}
