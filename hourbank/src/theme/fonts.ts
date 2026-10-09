export const F = {
  serif:      'Fraunces_400Regular',
  serifItalic:'Fraunces_300Light_Italic',
  sans:       'Geist_400Regular',
  sansMed:    'Geist_500Medium',
  mono:       'GeistMono_400Regular',
  monoMed:    'GeistMono_500Medium',
} as const;

export type FontKey = keyof typeof F;

/** Bottom-tab label style — pass as `tabBarLabelStyle` in the (app) tab layout. */
export const TAB_LABEL_STYLE = {
  fontFamily: F.sansMed,
  fontSize: 11,
  letterSpacing: 0.2,
} as const;

/** Minimum touch target (pt) — Apple HIG 44pt / Material 48dp. */
export const MIN_TOUCH = 44;

/** Expand a visual box of `size` pt to a ≥44pt hit area. */
export function hitSlopFor(size: number): { top: number; bottom: number; left: number; right: number } {
  const pad = Math.max(0, Math.ceil((MIN_TOUCH - size) / 2));
  return { top: pad, bottom: pad, left: pad, right: pad };
}
