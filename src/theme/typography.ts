import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';

import { fontFamilies, numericFontFamilies, type FontWeightName } from '@/theme/tokens';

type NumericFontWeightName = keyof typeof numericFontFamilies;

/**
 * Local font files, keyed by the family names in `fontFamilies` and
 * `numericFontFamilies`. Loaded once by the root layout; nothing here touches
 * the network, and on web the files ship in `dist/` where the service worker
 * precaches them with the rest of the shell.
 */
export const FONT_ASSETS = {
  [fontFamilies.regular]: require('@expo-google-fonts/rubik/400Regular/Rubik_400Regular.ttf'),
  [fontFamilies.medium]: require('@expo-google-fonts/rubik/500Medium/Rubik_500Medium.ttf'),
  [fontFamilies.semibold]: require('@expo-google-fonts/rubik/600SemiBold/Rubik_600SemiBold.ttf'),
  [fontFamilies.bold]: require('@expo-google-fonts/rubik/700Bold/Rubik_700Bold.ttf'),
  [numericFontFamilies.medium]: require('@expo-google-fonts/space-grotesk/500Medium/SpaceGrotesk_500Medium.ttf'),
  [numericFontFamilies.semibold]: require('@expo-google-fonts/space-grotesk/600SemiBold/SpaceGrotesk_600SemiBold.ttf'),
  [numericFontFamilies.bold]: require('@expo-google-fonts/space-grotesk/700Bold/SpaceGrotesk_700Bold.ttf'),
} as const;

// A system stack behind the bundled face on web, so text is readable during
// the brief swap on a cold, uncached first load instead of falling back to
// the browser's serif default.
const WEB_FALLBACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Hebrew", sans-serif';

export function weightName(weight: TextStyle['fontWeight']): FontWeightName {
  const numeric = weight === 'bold' ? 700 : weight === 'normal' || weight == null ? 400 : Number(weight);
  if (!Number.isFinite(numeric) || numeric < 450) return 'regular';
  if (numeric < 550) return 'medium';
  if (numeric < 650) return 'semibold';
  return 'bold';
}

/**
 * The font properties for one weight of the app face.
 *
 * Native gets the weight's own family and *no* `fontWeight`: with a static
 * font file, a `fontWeight` on Android synthesises a fake bold on top of the
 * real one, and iOS may ignore the family entirely. Web keeps the numeric
 * weight so the system fallback renders at the intended weight too.
 */
export function fontStyle(weight: FontWeightName): TextStyle {
  const family = fontFamilies[weight];
  if (process.env.EXPO_OS === 'web') {
    const numeric = { regular: '400', medium: '500', semibold: '600', bold: '700' } as const;
    return { fontFamily: `${family}, ${WEB_FALLBACK}`, fontWeight: numeric[weight] };
  }
  return { fontFamily: family, fontWeight: undefined };
}

/**
 * The font properties for one weight of the numeric display face (Space
 * Grotesk). There is no bundled 400-weight file, so `regular` resolves to
 * `medium` — the lightest weight actually loaded. Only digits (and the
 * handful of symbols money formatting uses) are ever rendered in this face,
 * so it never has to cover Hebrew or any other script.
 */
export function numericFontStyle(weight: FontWeightName): TextStyle {
  const numericWeight: NumericFontWeightName = weight === 'regular' ? 'medium' : weight;
  const family = numericFontFamilies[numericWeight];
  if (process.env.EXPO_OS === 'web') {
    const numeric = { medium: '500', semibold: '600', bold: '700' } as const;
    return { fontFamily: `${family}, ${WEB_FALLBACK}`, fontWeight: numeric[numericWeight] };
  }
  return { fontFamily: family, fontWeight: undefined };
}

/**
 * Resolves a composed text style so its `fontWeight` picks the matching
 * family for the requested face. Call sites keep writing `fontWeight: '700'`
 * in overrides and still get the real bold file rather than a synthesised
 * one. `face: 'numeric'` resolves against Space Grotesk instead of Rubik —
 * used only where the rendered text is guaranteed to be digits.
 */
export function withAppFont(style: StyleProp<TextStyle>, fallback: FontWeightName = 'regular', face: 'text' | 'numeric' = 'text'): TextStyle {
  const flat = StyleSheet.flatten(style) ?? {};
  const isOurFont = !flat.fontFamily || flat.fontFamily.startsWith('Rubik_') || flat.fontFamily.startsWith('SpaceGrotesk_');
  if (!isOurFont) return flat;
  const weight = flat.fontWeight != null ? weightName(flat.fontWeight) : fallback;
  return { ...flat, ...(face === 'numeric' ? numericFontStyle(weight) : fontStyle(weight)) };
}
