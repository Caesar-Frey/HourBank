/**
 * Design tokens — the ONLY place (with tailwind.config.js + src/utils/balance.ts)
 * where literal colour values may appear. Keep tailwind.config.js in sync.
 *
 * Reserved semantics:
 *   moss / amber / crimson → balance health (≥3h / 1–3h / <1h) and money in/out.
 *   oxblood                → brand accent / primary action / "needs attention".
 * Calendar event types use indigo / teal / plum / neutrals (see eventColors.ts).
 */
export const COLORS = {
  paper:       '#F4EFE6',
  paperDeep:   '#ECE5D6',
  paperEdge:   '#D9CFBF',
  ink:         '#1B1714',
  inkSoft:     '#4A413A',
  // 5.0:1 on paper, 4.6:1 on paperDeep (WCAG AA body text). Was #8A7E72 (3.4:1).
  inkFaint:    '#706458',
  oxblood:     '#7A2530',
  oxbloodDeep: '#5C1B24',
  oxbloodFill: '#F1DEDF',
  moss:        '#3F5641',
  amber:       '#B8743F',
  crimson:     '#9A2A2A',
  okFill:      '#E4EAE0',
  warnFill:    '#F0E0CB',
  badFill:     '#EFD7D7',
  goodFill:    '#E8F2EA',
  // Event-type accents (calendar colour-coding) — never balance-status hues
  indigo:      '#445A7A',
  indigoFill:  '#DEE3EC',
  teal:        '#2F6A6A',
  tealFill:    '#DCE8E6',
  plum:        '#6E4B63',
  plumFill:    '#E9DEE6',
  sessionBg:   '#1B1714',

  // ── Translucent surfaces (replace inline rgba literals) ──────────────────
  /** Card / input fill on paper (white @ 40%). */
  cardFill:      'rgba(255,255,255,0.4)',
  /** Lighter nested fill (white @ 25%). */
  cardFillSoft:  'rgba(255,255,255,0.25)',
  /** Modal / bottom-sheet backdrop (ink @ 55%). */
  scrim:         'rgba(27,23,20,0.55)',
  /** Lighter backdrop for non-blocking sheets (ink @ 35%). */
  scrimSoft:     'rgba(27,23,20,0.35)',
  /** Ink @ 40% — disabled text / muted strokes on paper. */
  ink40:         'rgba(27,23,20,0.4)',
  /** Ink @ 20% — subtle outline on paper. */
  inkHairline:   'rgba(27,23,20,0.2)',
  /** Paper tints for the dark Live Session screen. */
  paper12:       'rgba(244,239,230,0.12)',
  paper20:       'rgba(244,239,230,0.2)',
  paper30:       'rgba(244,239,230,0.3)',
  paper40:       'rgba(244,239,230,0.4)',
  paper60:       'rgba(244,239,230,0.6)',
  paper10:       'rgba(244,239,230,0.1)',
  transparent:   'transparent',
} as const;

export type ColorToken = keyof typeof COLORS;
