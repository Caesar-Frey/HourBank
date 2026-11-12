/**
 * Home "Finish setting up" card (A5, mockup M3). Shown above the Today card
 * while the tutor's name, own rates or payment details are still missing, so
 * receipts, claims and reminders never go out with placeholders. Not
 * dismissible; disappears when all three are done.
 */
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { F } from '../../theme/fonts';
import { COLORS } from '../../theme/colors';
import type { SetupStatus } from '../../db/tutorProfile';
import { formatRand } from '../../utils/format';

export type SetupTarget = 'name' | 'rates' | 'payment';

type Row = { key: SetupTarget; done: boolean; title: string; hint: React.ReactNode };

export function SetupCard({
  status,
  starterRate,
  onOpen,
}: {
  status: SetupStatus;
  /** Current payout rate, shown while it is still the starter value. */
  starterRate: number;
  onOpen: (target: SetupTarget) => void;
}) {
  if (!status.needed) return null;
  const rows: Row[] = [
    { key: 'name', done: status.nameDone, title: 'Your name', hint: 'Printed on receipts and claims' },
    {
      key: 'rates',
      done: status.ratesDone,
      title: 'Confirm your rates',
      hint: (
        <>
          {'Still the starter '}
          <Text style={{ fontFamily: F.mono, fontSize: 12 }}>{`${formatRand(starterRate)}/h`}</Text>
        </>
      ),
    },
    { key: 'payment', done: status.paymentDone, title: 'Add your bank details', hint: 'Parents need these to pay you' },
  ];
  const doneCount = rows.filter(r => r.done).length;

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: COLORS.oxblood,
        borderRadius: 16,
        padding: 16,
        paddingBottom: 4,
        marginBottom: 16,
        backgroundColor: COLORS.cardFill,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={{ fontFamily: F.mono, fontSize: 12, letterSpacing: 1.5, color: COLORS.oxblood }}>FINISH SETTING UP</Text>
        <Text style={{ fontFamily: F.mono, fontSize: 12, color: COLORS.inkFaint }}>{`${doneCount} OF 3`}</Text>
      </View>
      <Text style={{ fontFamily: F.serif, fontSize: 19, lineHeight: 26, color: COLORS.ink, marginTop: 4, marginBottom: 8 }}>
        {'So receipts and claims carry '}
        <Text style={{ fontFamily: F.serifItalic }}>your</Text>
        {' details.'}
      </Text>
      {rows.map(r =>
        r.done ? (
          <View
            key={r.key}
            accessible
            accessibilityLabel={`${r.title}, done`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, borderTopWidth: 1, borderTopColor: COLORS.paperEdge }}
          >
            <Feather name="check-circle" size={20} color={COLORS.moss} />
            <Text style={{ flex: 1, fontFamily: F.sans, fontSize: 15, color: COLORS.inkFaint, textDecorationLine: 'line-through' }}>
              {r.title}
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            key={r.key}
            onPress={() => onOpen(r.key)}
            accessibilityRole="button"
            accessibilityLabel={`${r.title}, to do`}
            activeOpacity={0.7}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, borderTopWidth: 1, borderTopColor: COLORS.paperEdge }}
          >
            <Feather name="circle" size={20} color={COLORS.ink} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontFamily: F.sansMed, fontSize: 15, color: COLORS.ink }}>{r.title}</Text>
              <Text style={{ fontFamily: F.sans, fontSize: 13, color: COLORS.inkSoft }}>{r.hint}</Text>
            </View>
            <Feather name="chevron-right" size={16} color={COLORS.inkFaint} />
          </TouchableOpacity>
        ),
      )}
    </View>
  );
}
