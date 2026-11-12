/**
 * "Did this lesson already end?" — the in-app sheet shown when the app finds a
 * lesson timer still running (cold start or return to the app). Mockup M1.
 *
 * A runaway timer (forgotten: far past the booked length, or 4h+ unbooked)
 * asks for the real end time, defaulting to the booked end, and goes straight
 * to the review. Otherwise the tutor continues or ends and reviews. Not
 * dismissible by Back: one of the three choices must be made.
 */
import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { F, MIN_TOUCH } from '../theme/fonts';
import { COLORS } from '../theme/colors';
import { DateTimeField } from './student/DateTimeField';
import { computeElapsedSeconds } from '../db/sessions';
import type { InFlightSession } from '../contexts/SessionTimerContext.helpers';
import { isRunawayTimer, runawayDefaultEnd, taughtMinutesUntil } from '../utils/duration';
import { formatDayShort, formatMinutes, formatTime, formatTimeRange } from '../utils/format';

export function OrphanSheet({
  session,
  onContinue,
  onReview,
  onDiscard,
}: {
  session: InFlightSession | null;
  onContinue: (s: InFlightSession) => void;
  /** endedAt: the chosen end (runaway), or null = now. */
  onReview: (s: InFlightSession, endedAt: Date | null) => void;
  onDiscard: (s: InFlightSession) => void;
}) {
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(() => new Date());
  const [end, setEnd] = useState<Date>(() => new Date());

  const started = session?.started_at ?? null;
  const booked = session?.estimated_duration_minutes ?? null;
  const elapsedMin = session ? computeElapsedSeconds(session, now) / 60 : 0;
  const runaway = !!started && isRunawayTimer(elapsedMin, booked);

  // Fresh clock + default end each time a lesson is shown.
  useEffect(() => {
    if (!session?.started_at) return;
    const n = new Date();
    setNow(n);
    const def = runawayDefaultEnd(session.started_at, session.estimated_duration_minutes);
    setEnd(def.getTime() < n.getTime() ? def : n);
  }, [session]);

  if (!session) return null;
  const first = session.student_full_name.trim().split(/\s+/)[0] || 'the student';
  const taught = started ? taughtMinutesUntil(started, end, session.paused_seconds ?? 0) : 0;
  const endInvalid = !!started && (end.getTime() <= new Date(started).getTime() || end.getTime() > Date.now() + 60_000);
  const paused = session.status === 'paused';

  const btnBase = { borderRadius: 14, alignItems: 'center' as const, justifyContent: 'center' as const };

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={() => { /* choose an option */ }}>
      <View style={{ flex: 1, backgroundColor: COLORS.scrim, justifyContent: 'flex-end' }}>
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: COLORS.paper,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: 24,
            paddingTop: 12,
            paddingBottom: 24 + insets.bottom,
            maxHeight: '92%',
          }}
        >
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.paperEdge, alignSelf: 'center', marginBottom: 16 }} />
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 16 }}>
            <View style={{ gap: 6 }}>
              <Text style={{ fontFamily: F.mono, fontSize: 12, letterSpacing: 1.5, color: COLORS.oxblood }}>
                {paused ? 'LESSON PAUSED' : 'LESSON STILL RUNNING'}
              </Text>
              <Text accessibilityRole="header" style={{ fontFamily: F.serif, fontSize: 28, lineHeight: 34, color: COLORS.ink }}>
                {'Did this lesson '}
                <Text style={{ fontFamily: F.serifItalic, color: COLORS.oxblood }}>already end?</Text>
              </Text>
              <Text style={{ fontFamily: F.sans, fontSize: 15, lineHeight: 22, color: COLORS.inkSoft }}>
                {`The timer for ${session.student_full_name} started `}
                {started ? (
                  <Text style={{ fontFamily: F.mono, fontSize: 14 }}>{`${formatDayShort(started)} · ${formatTime(started)}`}</Text>
                ) : null}
                {' and has run for '}
                <Text style={{ fontFamily: F.mono, fontSize: 14 }}>{formatMinutes(Math.floor(elapsedMin))}</Text>
                {'.'}
              </Text>
            </View>

            {runaway && started ? (
              <View style={{ backgroundColor: COLORS.cardFill, borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 14, padding: 14, gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontFamily: F.mono, fontSize: 12, letterSpacing: 1.5, color: COLORS.inkFaint }}>IT ENDED AT</Text>
                  {booked ? (
                    <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint }}>
                      {`BOOKED ${formatTimeRange(started, runawayDefaultEnd(started, booked))}`}
                    </Text>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', gap: 16 }}>
                  <View style={{ flex: 3 }}>
                    <DateTimeField
                      mode="date"
                      value={end}
                      onChange={setEnd}
                      display={formatDayShort(end)}
                      accessibilityLabel="End date"
                      minimumDate={new Date(started)}
                      maximumDate={new Date()}
                      invalid={endInvalid}
                    />
                  </View>
                  <View style={{ flex: 2 }}>
                    <DateTimeField
                      mode="time"
                      value={end}
                      onChange={setEnd}
                      display={formatTime(end)}
                      accessibilityLabel="End time"
                      invalid={endInvalid}
                    />
                  </View>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <Text style={{ fontFamily: F.sans, fontSize: 14, color: COLORS.inkSoft }}>Taught time</Text>
                  <Text accessibilityLiveRegion="polite" style={{ fontFamily: F.monoMed, fontSize: 16, color: endInvalid ? COLORS.crimson : COLORS.ink }}>
                    {endInvalid ? 'Check the end time' : formatMinutes(Math.round(taught))}
                  </Text>
                </View>
              </View>
            ) : null}

            <View style={{ gap: 8 }}>
              {runaway ? (
                <>
                  <TouchableOpacity
                    onPress={() => onReview(session, end)}
                    disabled={endInvalid}
                    accessibilityRole="button"
                    style={{ ...btnBase, minHeight: 52, backgroundColor: COLORS.oxblood, opacity: endInvalid ? 0.5 : 1 }}
                  >
                    <Text style={{ fontFamily: F.sansMed, fontSize: 16, color: COLORS.paper }}>Yes, review and save it</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => onContinue(session)}
                    accessibilityRole="button"
                    style={{ ...btnBase, minHeight: 48, borderWidth: 1, borderColor: COLORS.ink }}
                  >
                    <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.ink }}>No, I am still teaching</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity
                    onPress={() => onContinue(session)}
                    accessibilityRole="button"
                    style={{ ...btnBase, minHeight: 52, backgroundColor: COLORS.oxblood }}
                  >
                    <Text style={{ fontFamily: F.sansMed, fontSize: 16, color: COLORS.paper }}>Continue lesson</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => onReview(session, null)}
                    accessibilityRole="button"
                    style={{ ...btnBase, minHeight: 48, borderWidth: 1, borderColor: COLORS.ink }}
                  >
                    <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.ink }}>End and review</Text>
                  </TouchableOpacity>
                </>
              )}
              <TouchableOpacity
                onPress={() => onDiscard(session)}
                accessibilityRole="button"
                accessibilityHint={`Throws away the lesson with ${first}; nothing is deducted`}
                style={{ ...btnBase, minHeight: MIN_TOUCH }}
              >
                <Text style={{ fontFamily: F.sansMed, fontSize: 14, color: COLORS.crimson }}>Discard this lesson…</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
