export const F = {
  serif:      'Fraunces_400Regular',
  serifItalic:'Fraunces_300Light_Italic',
  sans:       'Geist_400Regular',
  sansMed:    'Geist_500Medium',
  mono:       'GeistMono_400Regular',
  monoMed:    'GeistMono_500Medium',
} as const;

export type FontKey = keyof typeof F;
