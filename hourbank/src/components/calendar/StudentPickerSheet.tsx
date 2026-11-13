import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../../theme/colors';
import { F, MIN_TOUCH } from '../../theme/fonts';
import { useKeyboardHeight } from '../FormScreen';

interface PickerStudent {
  id: string;
  full_name: string;
}

interface Props {
  visible: boolean;
  title: string;
  students: PickerStudent[];
  onPick: (studentId: string) => void;
  onClose: () => void;
  /** Shown as a button when there are no students yet (C4). */
  onAddStudent?: () => void;
}

/** Bottom sheet listing students with search; used by "Book a lesson". */
export function StudentPickerSheet({ visible, title, students, onPick, onClose, onAddStudent }: Props) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);

  const q = query.trim().toLowerCase();
  const shown = q ? students.filter(s => s.full_name.toLowerCase().includes(q)) : students;

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: COLORS.scrimSoft }} onPress={onClose} accessibilityLabel="Close" />
      <View
        style={{
          backgroundColor: COLORS.paper,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          paddingTop: 16,
          paddingBottom: (keyboard > 0 ? keyboard : insets.bottom) + 16,
          maxHeight: '75%',
        }}
      >
        <Text
          style={{
            fontFamily: F.mono,
            fontSize: 12,
            color: COLORS.inkFaint,
            textTransform: 'uppercase',
            letterSpacing: 0.8,
            marginBottom: 10,
            paddingHorizontal: 20,
          }}
        >
          {title}
        </Text>
        {students.length > 6 ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: COLORS.paperDeep,
              borderRadius: 10,
              marginHorizontal: 20,
              marginBottom: 8,
              paddingHorizontal: 12,
              height: 40,
              gap: 8,
            }}
          >
            <Feather name="search" size={15} color={COLORS.inkFaint} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search students"
              placeholderTextColor={COLORS.inkFaint}
              autoCorrect={false}
              style={{ flex: 1, fontFamily: F.sans, fontSize: 14, color: COLORS.ink, padding: 0 }}
            />
          </View>
        ) : null}
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {shown.map(s => (
            <TouchableOpacity
              key={s.id}
              onPress={() => onPick(s.id)}
              activeOpacity={0.7}
              accessibilityRole="button"
              style={{
                paddingHorizontal: 20,
                minHeight: MIN_TOUCH + 4,
                justifyContent: 'center',
                borderBottomWidth: 1,
                borderBottomColor: COLORS.paperEdge,
              }}
            >
              <Text style={{ fontFamily: F.serif, fontSize: 16, color: COLORS.ink }}>{s.full_name}</Text>
            </TouchableOpacity>
          ))}
          {shown.length === 0 ? (
            <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.inkFaint, paddingHorizontal: 20, paddingVertical: 16 }}>
              {students.length === 0 ? 'No students yet.' : `No students match “${query}”`}
            </Text>
          ) : null}
          {students.length === 0 && onAddStudent ? (
            <TouchableOpacity
              onPress={onAddStudent}
              activeOpacity={0.75}
              accessibilityRole="button"
              testID="picker-add-student"
              style={{ marginHorizontal: 20, minHeight: 48, borderWidth: 1, borderColor: COLORS.ink, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}
            >
              <Feather name="user-plus" size={16} color={COLORS.ink} />
              <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.ink }}>Add a student</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}
