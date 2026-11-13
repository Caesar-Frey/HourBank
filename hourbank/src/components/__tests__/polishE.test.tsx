import { splitNumericRuns } from '../Num';
import { formatHours, formatRand } from '../../utils/format';
import { balanceColour } from '../../utils/balance';
import { COLORS } from '../../theme/colors';

describe('splitNumericRuns (E5)', () => {
  it('pulls out rand, hours and plain counts', () => {
    const text = `Finalise · ${formatRand(1250)}`;
    expect(splitNumericRuns(text)).toEqual([
      { text: 'Finalise · ', num: false },
      { text: formatRand(1250), num: true },
    ]);
    expect(splitNumericRuns('Lesson 1h 30m · Algebra').filter(r => r.num).map(r => r.text)).toEqual(['1h 30m']);
    expect(splitNumericRuns('Top up −45m').filter(r => r.num).map(r => r.text)).toEqual(['−45m']);
    expect(splitNumericRuns('No numbers here')).toEqual([{ text: 'No numbers here', num: false }]);
  });

  it('keeps every character', () => {
    const t = `Added ${formatHours(10)} · travel ${formatRand(12500)} settled, 3 lessons`;
    expect(splitNumericRuns(t).map(r => r.text).join('')).toBe(t);
  });
});

describe('E1/E6', () => {
  it('uses the AA amber shade for warn balances', () => {
    expect(balanceColour('warn')).toBe(COLORS.amberText);
  });
  it('formats negative hours with a true minus', () => {
    expect(formatHours(-0.75)).toBe('−45m');
  });
});
