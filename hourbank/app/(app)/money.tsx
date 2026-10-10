import React, { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COLORS } from '../../src/theme/colors';
import { TabHeader } from '../../src/components/ScreenHeader';
import { SegmentedControl } from '../../src/components/calendar/SegmentedControl';
import { MoneyInView } from '../../src/screens/money/MoneyInView';
import { MoneyOutView } from '../../src/screens/money/MoneyOutView';

type Segment = 'in' | 'out';

export default function MoneyTab() {
  const [segment, setSegment] = useState<Segment>('in');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.paper }} edges={['top']}>
      <TabHeader title="Money" divider={false} />
      <SegmentedControl
        options={[
          { value: 'in', label: 'In' },
          { value: 'out', label: 'Out' },
        ]}
        value={segment}
        onChange={setSegment}
        accessibilityLabel="Money direction"
        style={{ marginHorizontal: 16, marginBottom: 4 }}
      />
      <View style={{ flex: 1 }}>{segment === 'in' ? <MoneyInView /> : <MoneyOutView />}</View>
    </SafeAreaView>
  );
}
