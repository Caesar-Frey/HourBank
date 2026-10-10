import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ActivityIndicator, ScrollView } from 'react-native';
import { F, MIN_TOUCH } from '../../theme/fonts';
import { COLORS } from '../../theme/colors';
import type { BackupSummary } from '../../utils/backup';
import { RESTORE_CONFIRM_WORD, restoreSummaryLines } from './settingsLogic';

/**
 * Confirmation step of "Restore from backup": shows what the file contains and
 * requires typing RESTORE, because restoring replaces every record on the phone.
 */
export function RestoreBackupModal({
  summary,
  busy,
  lessonInProgress,
  onCancel,
  onConfirm,
}: {
  /** null = hidden. */
  summary: BackupSummary | null;
  busy: boolean;
  lessonInProgress: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (summary) setTyped('');
  }, [summary]);

  const armed = typed.trim().toUpperCase() === RESTORE_CONFIRM_WORD && !busy;

  return (
    <Modal visible={summary !== null} transparent animationType="fade" onRequestClose={busy ? () => {} : onCancel}>
      <View style={{ flex: 1, backgroundColor: COLORS.scrim, justifyContent: 'center', padding: 24 }}>
        <ScrollView
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ backgroundColor: COLORS.paper, borderRadius: 16, padding: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={{ fontFamily: F.serif, fontSize: 22, color: COLORS.ink, marginBottom: 6 }}>Restore this backup?</Text>
          <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.inkSoft, marginBottom: 16 }}>
            Everything currently on this phone will be replaced with the backup below. This can't be undone — back up
            first if you're unsure.
          </Text>

          {summary && (
            <View
              style={{
                borderWidth: 1,
                borderColor: COLORS.paperEdge,
                borderRadius: 12,
                backgroundColor: COLORS.cardFill,
                paddingHorizontal: 14,
                paddingVertical: 6,
                marginBottom: 16,
              }}
            >
              {restoreSummaryLines(summary).map(([label, value]) => (
                <View key={label} style={{ flexDirection: 'row', paddingVertical: 6 }}>
                  <Text style={{ flex: 1, fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft }}>{label}</Text>
                  <Text style={{ fontFamily: F.mono, fontSize: 13, color: COLORS.ink }}>{value}</Text>
                </View>
              ))}
            </View>
          )}

          {lessonInProgress && (
            <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.crimson, marginBottom: 12 }}>
              A lesson is in progress. It will be lost unless it's also in the backup.
            </Text>
          )}

          <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft, marginBottom: 8 }}>
            {`Type ${RESTORE_CONFIRM_WORD} to confirm.`}
          </Text>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            editable={!busy}
            placeholder={RESTORE_CONFIRM_WORD}
            placeholderTextColor={COLORS.inkFaint}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel={`Type ${RESTORE_CONFIRM_WORD} to confirm`}
            style={{
              minHeight: MIN_TOUCH,
              fontFamily: F.mono,
              fontSize: 16,
              color: COLORS.crimson,
              borderWidth: 1,
              borderColor: COLORS.crimson,
              borderRadius: 8,
              paddingHorizontal: 12,
              marginBottom: 20,
            }}
          />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity
              onPress={onCancel}
              disabled={busy}
              activeOpacity={0.8}
              accessibilityRole="button"
              style={{
                flex: 1,
                minHeight: MIN_TOUCH,
                borderWidth: 1,
                borderColor: COLORS.paperEdge,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.inkSoft }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onConfirm}
              disabled={!armed}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ disabled: !armed, busy }}
              style={{
                flex: 1,
                minHeight: MIN_TOUCH,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: armed || busy ? COLORS.crimson : COLORS.paperEdge,
              }}
            >
              {busy ? (
                <ActivityIndicator color={COLORS.paper} />
              ) : (
                <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: armed ? COLORS.paper : COLORS.inkFaint }}>
                  Restore
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
