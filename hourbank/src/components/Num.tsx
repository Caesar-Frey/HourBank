/**
 * Numbers in GeistMono inside mixed strings (E5).
 *
 * `<Mixed>` renders a sentence in the surrounding font but switches every
 * numeric run ("R 1 250.00", "1h 30m", "−45m", "3", "14:05") to F.mono via a
 * nested <Text>, so the font rule holds without callers splitting strings.
 * `<Num>` is the plain wrapper for a value you already have on its own.
 */
import React from 'react';
import { Text, type TextStyle } from 'react-native';
import { F } from '../theme/fonts';

// Optional sign, optional "R ", digits with NBSP/space/comma/dot/colon groups,
// then an optional h/m unit and a trailing "30m" part ("1h 30m").
const NUMERIC_RUN = /[−+-]?(?:R[  ])?\d(?:[\d,.:]|[  ](?=\d{3}\b))*(?:[hm]\b)?(?:[  ]\d+m\b)?/g;

export type Run = { text: string; num: boolean };

/** Split text into alternating plain and numeric runs. Pure, for tests. */
export function splitNumericRuns(text: string): Run[] {
  const runs: Run[] = [];
  let last = 0;
  for (const m of text.matchAll(NUMERIC_RUN)) {
    const start = m.index ?? 0;
    if (start > last) runs.push({ text: text.slice(last, start), num: false });
    runs.push({ text: m[0], num: true });
    last = start + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), num: false });
  return runs;
}

export function Num({ children, style, medium = false }: { children: React.ReactNode; style?: TextStyle; medium?: boolean }) {
  return <Text style={[{ fontFamily: medium ? F.monoMed : F.mono }, style]}>{children}</Text>;
}

/** Inline-only: nest inside a <Text> that sets size and colour. */
export function Mixed({ text, medium = false, numStyle }: { text: string; medium?: boolean; numStyle?: TextStyle }) {
  const runs = splitNumericRuns(text);
  return (
    <>
      {runs.map((r, i) =>
        r.num ? (
          <Num key={i} medium={medium} style={numStyle}>{r.text}</Num>
        ) : (
          <React.Fragment key={i}>{r.text}</React.Fragment>
        )
      )}
    </>
  );
}
