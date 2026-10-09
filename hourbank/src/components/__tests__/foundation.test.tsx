import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));

import { FormScreen } from '../FormScreen';
import { ScreenHeader, TabHeader, HeaderIconButton } from '../ScreenHeader';
import { PackageCard } from '../PackageCard';
import { TopicChip } from '../TopicChip';
import { EVENT_KIND_COLORS, eventKindStyle, ledgerDeltaColor } from '../../theme/eventColors';
import { COLORS } from '../../theme/colors';

test('FormScreen renders header, children and footer', () => {
  const s = render(
    <FormScreen header={<Text>HEAD</Text>} footer={<Text>FOOT</Text>}>
      <Text>BODY</Text>
    </FormScreen>,
  );
  expect(s.getByText('HEAD')).toBeTruthy();
  expect(s.getByText('BODY')).toBeTruthy();
  expect(s.getByText('FOOT')).toBeTruthy();
});

test('ScreenHeader back + right action are pressable with labels', () => {
  const onBack = jest.fn();
  const onMore = jest.fn();
  const s = render(
    <ScreenHeader
      backLabel="ROSTER"
      onBack={onBack}
      right={<HeaderIconButton icon="more-horizontal" accessibilityLabel="More" onPress={onMore} />}
    />,
  );
  fireEvent.press(s.getByLabelText('Back to roster'));
  fireEvent.press(s.getByLabelText('More'));
  expect(onBack).toHaveBeenCalled();
  expect(onMore).toHaveBeenCalled();
});

test('TabHeader renders title, accent and subtitle', () => {
  const s = render(<TabHeader title="Hour" titleAccent="Bank" subtitle="Thu 9 Oct" />);
  expect(s.getByText('Hour')).toBeTruthy();
  expect(s.getByText('Bank')).toBeTruthy();
  expect(s.getByText('Thu 9 Oct')).toBeTruthy();
});

test('PackageCard exposes selected state and visible border', () => {
  const s = render(
    <PackageCard hours={10} price={5500} badge={null} save={null} selected onPress={() => {}} />,
  );
  const card = s.getByRole('radio');
  expect(card.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
  const style = Array.isArray(card.props.style) ? Object.assign({}, ...card.props.style) : card.props.style;
  expect(style.borderWidth).toBe(2);
  expect(style.borderColor).toBe(COLORS.ink);
});

test('TopicChip selected renders filled ink', () => {
  const s = render(<TopicChip label="Algebra" selected onPress={() => {}} />);
  const chip = s.getByRole('checkbox');
  const style = Array.isArray(chip.props.style) ? Object.assign({}, ...chip.props.style) : chip.props.style;
  expect(style.backgroundColor).toBe(COLORS.ink);
});

test('event colours: top-up is moss; lesson kinds avoid balance hues', () => {
  expect(EVENT_KIND_COLORS.top_up.fg).toBe(COLORS.moss);
  const reserved: string[] = [COLORS.amber, COLORS.crimson];
  for (const [k, v] of Object.entries(EVENT_KIND_COLORS)) {
    if (k === 'top_up') continue;
    expect(reserved).not.toContain(v.fg);
    expect(v.fg).not.toBe(COLORS.moss);
  }
  expect(eventKindStyle('session_completed')).toBe(EVENT_KIND_COLORS.completed);
  expect(eventKindStyle('paused')).toBe(EVENT_KIND_COLORS.active);
  expect(ledgerDeltaColor('top_up', 5)).toBe(COLORS.moss);
  expect(ledgerDeltaColor('session_deduction', -1)).toBe(COLORS.ink);
});
