/**
 * Settings › Items you sell (F1). Saved items appear as chips on the
 * "Charge an item" screen. Editing or removing one never changes past charges,
 * which keep their own name and price.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { F, MIN_TOUCH } from '../../src/theme/fonts';
import { COLORS } from '../../src/theme/colors';
import { FormScreen } from '../../src/components/FormScreen';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { useToast } from '../../src/components/Toast';
import { getSaleItems, saveSaleItems, SaleItem } from '../../src/db/items';
import { newId } from '../../src/db/uuid';
import { formatHours, parseDecimal } from '../../src/utils/format';
import { Button, FieldHint, PageHeading, SectionLabel } from '../../src/components/student/ui';

type Draft = { id: string; name: string; price: string; hours: string };

const INPUT = {
  minHeight: 44,
  borderWidth: 1,
  borderColor: COLORS.paperEdge,
  borderRadius: 10,
  backgroundColor: COLORS.cardFill,
  paddingHorizontal: 12,
  fontSize: 15,
  color: COLORS.ink,
} as const;

function toDraft(i: SaleItem): Draft {
  return { id: i.id, name: i.name, price: i.price ? String(i.price) : '', hours: i.hours ? String(i.hours) : '' };
}

/** Hours typed as "1", "1.5" or "1,5". */
function parseHoursInput(t: string): number | null {
  const v = t.trim() ? parseDecimal(t) : null;
  return v != null && v > 0 ? v : null;
}

export default function SaleItemsScreen() {
  const router = useRouter();
  const toast = useToast();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const loadedRef = useRef(false);

  useEffect(() => {
    try {
      setDrafts(getSaleItems().map(toDraft));
    } catch {
      setDrafts([]);
    }
    loadedRef.current = true;
  }, []);

  function persist(next: Draft[]) {
    setDrafts(next);
    try {
      saveSaleItems(next.map(d => ({
        id: d.id,
        name: d.name,
        price: d.price.trim() ? parseDecimal(d.price) : null,
        hours: parseHoursInput(d.hours),
      })));
    } catch {
      toast.show({ kind: 'error', message: "Couldn't save your items" });
    }
  }

  function update(id: string, patch: Partial<Draft>) {
    setDrafts(ds => ds.map(d => (d.id === id ? { ...d, ...patch } : d)));
  }

  function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= drafts.length) return;
    const next = [...drafts];
    [next[index], next[j]] = [next[j], next[index]];
    persist(next);
  }

  return (
    <FormScreen
      edges={['top', 'bottom']}
      header={<ScreenHeader backLabel="SETTINGS" onBack={() => { persist(drafts); router.back(); }} />}
      footer={
        <Button
          label="Add an item"
          icon="plus"
          variant="secondary"
          onPress={() => setDrafts(ds => [...ds, { id: newId(), name: '', price: '', hours: '' }])}
          testID="sale-items-add"
        />
      }
    >
      <PageHeading eyebrow="ITEMS YOU SELL" line1="Things you" line2="charge to credit." />
      <Text style={{ fontFamily: F.sans, fontSize: 14, lineHeight: 20, color: COLORS.inkSoft, marginTop: -12, marginBottom: 20 }}>
        These show as quick picks when you charge an item. Changing one here never changes past charges.
      </Text>

      {drafts.length === 0 ? (
        <Text style={{ fontFamily: F.serifItalic, fontSize: 15, color: COLORS.inkFaint, marginBottom: 12 }}>
          No saved items yet.
        </Text>
      ) : null}

      {drafts.map((d, i) => {
        const h = parseHoursInput(d.hours);
        return (
          <View
            key={d.id}
            style={{ borderWidth: 1, borderColor: COLORS.paperEdge, borderRadius: 14, padding: 14, marginBottom: 12, gap: 8 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <SectionLabel style={{ marginBottom: 0 }}>{`ITEM ${i + 1}`}</SectionLabel>
              <View style={{ flexDirection: 'row' }}>
                <IconBtn icon="arrow-up" label={`Move ${d.name || 'item'} up`} disabled={i === 0} onPress={() => move(i, -1)} />
                <IconBtn icon="arrow-down" label={`Move ${d.name || 'item'} down`} disabled={i === drafts.length - 1} onPress={() => move(i, 1)} />
                <IconBtn icon="trash-2" label={`Remove ${d.name || 'item'}`} onPress={() => persist(drafts.filter(x => x.id !== d.id))} />
              </View>
            </View>
            <TextInput
              value={d.name}
              onChangeText={t => update(d.id, { name: t })}
              onBlur={() => persist(drafts)}
              placeholder="Name, e.g. Past papers"
              placeholderTextColor={COLORS.inkFaint}
              accessibilityLabel="Item name"
              maxLength={80}
              style={{ ...INPUT, fontFamily: F.sans }}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                value={d.price}
                onChangeText={t => update(d.id, { price: t })}
                onBlur={() => persist(drafts)}
                placeholder="Price (R)"
                placeholderTextColor={COLORS.inkFaint}
                keyboardType="decimal-pad"
                accessibilityLabel="Default price in rand, optional"
                style={{ ...INPUT, flex: 1, fontFamily: F.mono }}
              />
              <TextInput
                value={d.hours}
                onChangeText={t => update(d.id, { hours: t })}
                onBlur={() => persist(drafts)}
                placeholder="Hours"
                placeholderTextColor={COLORS.inkFaint}
                keyboardType="decimal-pad"
                accessibilityLabel="Default hours to take from credit, optional"
                style={{ ...INPUT, flex: 1, fontFamily: F.mono }}
              />
            </View>
            {h ? <FieldHint>{`Takes ${formatHours(h)} from credit`}</FieldHint> : null}
          </View>
        );
      })}
    </FormScreen>
  );
}

function IconBtn({ icon, label, onPress, disabled = false }: {
  icon: React.ComponentProps<typeof Feather>['name']; label: string; onPress: () => void; disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.3 : 1 }}
    >
      <Feather name={icon} size={16} color={COLORS.inkSoft} />
    </TouchableOpacity>
  );
}
