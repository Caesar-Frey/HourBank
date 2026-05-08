import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { COLORS } from '../../../src/theme/colors';
import { F } from '../../../src/theme/fonts';
import { useStudents } from '../../../src/hooks/useStudents';
import { useSessionTimer } from '../../../src/contexts/SessionTimerContext';
import { createUnscheduled, startSession } from '../../../src/db/sessions';
import { Session } from '../../../src/db/schema';

export default function StartUnscheduled() {
  const router = useRouter();
  const { students, loading } = useStudents();
  const { startTimer } = useSessionTimer();
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [mode, setMode] = useState<Session['mode']>('in_person');

  function handleStart() {
    if (!selectedStudentId) return;
    const session = createUnscheduled(selectedStudentId, mode);
    const started = startSession(session.id);
    startTimer(session.id, selectedStudentId, started.started_at!, 0);
    router.replace(`/student/${selectedStudentId}/session?sessionId=${session.id}`);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={{ marginRight: 16 }}>
            <Feather name="arrow-left" size={20} color={COLORS.ink} />
          </TouchableOpacity>
          <Text style={{ fontFamily: F.mono, fontSize: 11, color: COLORS.inkFaint, textTransform: 'uppercase' }}>
            START SESSION
          </Text>
        </View>

        {/* Mode toggle */}
        <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 8 }}>
          MODE
        </Text>
        <View style={{ flexDirection: 'row', borderRadius: 10, borderWidth: 1, borderColor: COLORS.paperEdge, overflow: 'hidden', marginBottom: 28 }}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setMode('in_person')}
            style={{
              flex: 1,
              paddingVertical: 10,
              alignItems: 'center',
              backgroundColor: mode === 'in_person' ? COLORS.oxblood : 'transparent',
            }}
          >
            <Text style={{ fontFamily: F.mono, fontSize: 12, color: mode === 'in_person' ? COLORS.paper : COLORS.inkSoft }}>
              IN-PERSON
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setMode('online')}
            style={{
              flex: 1,
              paddingVertical: 10,
              alignItems: 'center',
              backgroundColor: mode === 'online' ? COLORS.oxblood : 'transparent',
            }}
          >
            <Text style={{ fontFamily: F.mono, fontSize: 12, color: mode === 'online' ? COLORS.paper : COLORS.inkSoft }}>
              ONLINE
            </Text>
          </TouchableOpacity>
        </View>

        {/* Student picker */}
        <Text style={{ fontFamily: F.mono, fontSize: 10, color: COLORS.inkFaint, textTransform: 'uppercase', marginBottom: 8 }}>
          SELECT STUDENT
        </Text>

        {loading ? (
          <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint }}>Loading...</Text>
        ) : (
          <View style={{ marginBottom: 32 }}>
            {students.map(student => {
              const selected = selectedStudentId === student.id;
              return (
                <TouchableOpacity
                  key={student.id}
                  activeOpacity={0.7}
                  onPress={() => setSelectedStudentId(student.id)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 14,
                    borderBottomWidth: 1,
                    borderBottomColor: COLORS.paperEdge,
                  }}
                >
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      borderWidth: 2,
                      borderColor: selected ? COLORS.oxblood : COLORS.paperEdge,
                      backgroundColor: selected ? COLORS.oxblood : 'transparent',
                      marginRight: 14,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {selected && <Feather name="check" size={11} color={COLORS.paper} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: F.serif, fontSize: 15, color: COLORS.ink }}>
                      {student.full_name}
                    </Text>
                    <Text style={{ fontFamily: F.sans, fontSize: 12, color: COLORS.inkSoft }}>
                      {student.subject} · Grade {student.grade}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Confirm */}
        <TouchableOpacity
          onPress={handleStart}
          activeOpacity={selectedStudentId ? 0.85 : 1}
          style={{
            backgroundColor: selectedStudentId ? COLORS.oxblood : COLORS.paperEdge,
            borderRadius: 14,
            paddingHorizontal: 20,
            paddingVertical: 16,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Text style={{ fontFamily: F.mono, fontSize: 13, color: selectedStudentId ? COLORS.paper : COLORS.inkFaint }}>
            Start session
          </Text>
          <Feather name="arrow-right" size={14} color={selectedStudentId ? COLORS.paper : COLORS.inkFaint} />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
