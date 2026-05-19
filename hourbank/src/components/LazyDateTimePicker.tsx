import React from 'react';
import { TextInput } from 'react-native';
import { F } from '../theme/fonts';
import { COLORS } from '../theme/colors';

type Props = {
  value: Date;
  mode: 'date' | 'time';
  is24Hour?: boolean;
  minimumDate?: Date;
  onChange: (event: unknown, selectedDate: Date | undefined) => void;
};

export function LazyDateTimePicker(props: Props) {
  const [Comp, setComp] = React.useState<React.ComponentType<Props> | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('@react-native-community/datetimepicker');
        if (!cancelled) setComp(() => mod.default as unknown as React.ComponentType<Props>);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (failed) {
    return (
      <TextInput
        placeholder={props.mode === 'date' ? 'YYYY-MM-DD' : 'HH:MM'}
        defaultValue={
          props.mode === 'date'
            ? props.value.toISOString().slice(0, 10)
            : `${String(props.value.getHours()).padStart(2, '0')}:${String(props.value.getMinutes()).padStart(2, '0')}`
        }
        onSubmitEditing={e => {
          const txt = e.nativeEvent.text;
          const d = new Date(props.value);
          if (props.mode === 'date') {
            const parsed = new Date(txt);
            if (!isNaN(parsed.getTime())) {
              d.setFullYear(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
              props.onChange(null, d);
              return;
            }
          } else {
            const [hh, mm] = txt.split(':').map(Number);
            if (!isNaN(hh) && !isNaN(mm)) {
              d.setHours(hh, mm, 0, 0);
              props.onChange(null, d);
              return;
            }
          }
          props.onChange(null, undefined);
        }}
        style={{ fontFamily: F.mono, fontSize: 14, color: COLORS.ink, paddingVertical: 8, paddingHorizontal: 4 }}
      />
    );
  }
  if (!Comp) return null;
  return <Comp {...props} />;
}
