import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { F } from '../../../../src/theme/fonts';
import { COLORS } from '../../../../src/theme/colors';
import { getSession } from '../../../../src/db/sessions';
import { getStudent } from '../../../../src/db/students';
import { getBalanceAt } from '../../../../src/db/ledger';
import { getDb } from '../../../../src/db/client';
import { formatHours, formatBilledDuration } from '../../../../src/utils/format';
import { Session, Student, LedgerEntry } from '../../../../src/db/schema';
import { shareSessionReceipt, getSessionReceipt } from '../../../../src/utils/receipt';

function formatLessonDate(isoStr: string): string {
  const d = new Date(isoStr);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${days[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function durationSeconds(session: Session): number {
  if (session.duration_minutes != null) {
    return Math.round(session.duration_minutes * 60);
  }
  if (session.started_at && session.ended_at) {
    const ms = new Date(session.ended_at).getTime() - new Date(session.started_at).getTime();
    return Math.max(0, Math.round(ms / 1000) - (session.paused_seconds ?? 0));
  }
  return 0;
}

function parseTopics(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function LessonDetailScreen() {
  const { id, sessionId } = useLocalSearchParams<{ id: string; sessionId: string }>();
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [ledgerEntry, setLedgerEntry] = useState<LedgerEntry | null>(null);
  const [balanceAt, setBalanceAt] = useState<number>(0);
  const [receiptSent, setReceiptSent] = useState(false);

  useEffect(() => {
    const s = getSession(sessionId);
    if (!s) return;
    setSession(s);

    const stu = getStudent(id);
    setStudent(stu ?? null);

    const entry = getDb().getFirstSync<LedgerEntry>(
      'SELECT * FROM ledger_entries WHERE related_session_id = ? LIMIT 1',
      [sessionId]
    );
    setLedgerEntry(entry ?? null);

    if (s.ended_at) {
      setBalanceAt(getBalanceAt(id, s.ended_at));
    }

    // Check if a receipt already exists for this session
    const existingReceipt = getSessionReceipt(sessionId);
    setReceiptSent(existingReceipt != null);
  }, [id, sessionId]);

  async function handleSendReceipt() {
    try {
      await shareSessionReceipt(sessionId);
      setReceiptSent(true);
    } catch (e) {
      Alert.alert('Error', 'Could not share receipt. Please try again.');
    }
  }

  if (!session) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint }}>
            Session not found.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const topics = parseTopics(session.topics);
  const duration = durationSeconds(session);
  const billedSeconds = session.billed_minutes != null
    ? Math.round(session.billed_minutes * 60)
    : duration;
  const dateStr = session.ended_at
    ? formatLessonDate(session.ended_at)
    : session.scheduled_for
    ? formatLessonDate(session.scheduled_for)
    : '—';
  const creditDeducted = ledgerEntry ? Math.abs(ledgerEntry.hours_delta) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24, flexGrow: 1 }}
      >
        {/* Back button */}
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

        {/* Student name */}
        {student && (
          <Text style={{ fontFamily: F.serif, fontSize: 26, color: COLORS.ink, marginBottom: 4 }}>
            {student.full_name}
          </Text>
        )}

        {/* Date */}
        <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint, marginBottom: 16 }}>
          {dateStr}
        </Text>

        {/* Mode + type badges */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 24 }}>
          <View style={{
            borderWidth: 1,
            borderColor: COLORS.paperEdge,
            borderRadius: 6,
            paddingHorizontal: 8,
            paddingVertical: 3,
          }}>
            <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkSoft, textTransform: 'uppercase' }}>
              {session.mode === 'online' ? 'Online' : 'In-person'}
            </Text>
          </View>
          {session.session_type !== 'general' && (
            <View style={{
              borderWidth: 1,
              borderColor: COLORS.paperEdge,
              borderRadius: 6,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}>
              <Text style={{ fontFamily: F.sansMed, fontSize: 10, color: COLORS.ink, textTransform: 'uppercase' }}>
                {session.session_type === 'review' ? 'Review' : session.session_type === 'test_prep' ? 'Test Prep' : 'Exam Prep'}
              </Text>
            </View>
          )}
        </View>

        {/* Stats row */}
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 28 }}>
          {duration > 0 && (
            <View style={{
              flex: 1,
              borderWidth: 1,
              borderColor: COLORS.paperEdge,
              borderRadius: 14,
              padding: 14,
            }}>
              <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>
                Duration
              </Text>
              <Text style={{ fontFamily: F.mono, fontSize: 16, color: COLORS.ink }}>
                {formatBilledDuration(duration)}
              </Text>
            </View>
          )}
          {billedSeconds !== duration && billedSeconds > 0 && (
            <View style={{
              flex: 1,
              borderWidth: 1,
              borderColor: COLORS.paperEdge,
              borderRadius: 14,
              padding: 14,
            }}>
              <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>
                Billed
              </Text>
              <Text style={{ fontFamily: F.mono, fontSize: 16, color: COLORS.ink }}>
                {formatBilledDuration(billedSeconds)}
              </Text>
            </View>
          )}
          {creditDeducted != null && (
            <View style={{
              flex: 1,
              borderWidth: 1,
              borderColor: COLORS.paperEdge,
              borderRadius: 14,
              padding: 14,
            }}>
              <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>
                Credits used
              </Text>
              <Text style={{ fontFamily: F.mono, fontSize: 16, color: COLORS.ink }}>
                {formatHours(creditDeducted)}
              </Text>
            </View>
          )}
          <View style={{
            flex: 1,
            borderWidth: 1,
            borderColor: COLORS.paperEdge,
            borderRadius: 14,
            padding: 14,
          }}>
            <Text style={{ fontFamily: F.mono, fontSize: 9, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 4 }}>
              Balance after
            </Text>
            <Text style={{ fontFamily: F.mono, fontSize: 16, color: COLORS.ink }}>
              {formatHours(balanceAt)}
            </Text>
          </View>
        </View>

        {/* Subject + grade */}
        {student && (
          <View style={{ marginBottom: 24 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 6 }}>
              Subject
            </Text>
            <Text style={{ fontFamily: F.sans, fontSize: 15, color: COLORS.ink }}>
              {student.subject}
              <Text style={{ color: COLORS.inkSoft }}>{' · Grade '}{student.grade}</Text>
            </Text>
          </View>
        )}

        {/* Topics */}
        {topics.length > 0 && (
          <View style={{ marginBottom: 24 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 8 }}>
              Topics
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {topics.map(topic => (
                <View
                  key={topic}
                  style={{
                    borderWidth: 1,
                    borderColor: COLORS.paperEdge,
                    borderRadius: 20,
                    paddingHorizontal: 12,
                    paddingVertical: 4,
                    backgroundColor: COLORS.paperDeep,
                  }}
                >
                  <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft }}>
                    {topic}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Session notes */}
        {session.session_notes ? (
          <View style={{ marginBottom: 24 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 6 }}>
              Notes
            </Text>
            <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.inkSoft, lineHeight: 20 }}>
              {session.session_notes}
            </Text>
          </View>
        ) : null}

        {/* Spacer pushes receipt button to bottom when content is short */}
        <View style={{ flex: 1 }} />

        {/* Send Receipt */}
        <TouchableOpacity
          onPress={handleSendReceipt}
          activeOpacity={0.8}
          style={{
            borderWidth: 1,
            borderColor: receiptSent ? COLORS.paperEdge : COLORS.oxblood,
            borderRadius: 14,
            paddingVertical: 14,
            alignItems: 'center',
            backgroundColor: receiptSent ? COLORS.paperDeep : 'transparent',
            marginTop: 8,
          }}
        >
          <Text style={{
            fontFamily: F.sansMed,
            fontSize: 15,
            color: receiptSent ? COLORS.inkFaint : COLORS.oxblood,
          }}>
            {receiptSent ? 'Receipt sent ✓' : 'Send Receipt'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
