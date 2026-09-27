import type { ViewStyle } from 'react-native';

import { useQashyTheme, type ThemeTokens } from '@/theme/theme';

/**
 * Gradient support, on native vs. web.
 *
 * RN 0.86 exposes a real gradient style prop, `experimental_backgroundImage`
 * (see `node_modules/react-native/Libraries/StyleSheet/StyleSheetTypes.d.ts`,
 * `ViewStyle`), which accepts a CSS `linear-gradient(...)` string on iOS and
 * Android.
 *
 * react-native-web 0.21 does **not** special-case that prop name anywhere in
 * `dist/cjs/exports/StyleSheet/compiler/createReactDOMStyle.js` — the prop
 * name → CSS property table there (`STYLE_SHORT_FORM_EXPANSIONS`) and the
 * hand-written branches (`backgroundClip`, `flex`, `font`, `fontFamily`,
 * `textDecorationLine`, `writingDirection`) have no entry for it, so an
 * `experimental_backgroundImage` key would fall through to the generic
 * `resolvedStyle[prop] = value` branch unchanged, i.e. it would emit a CSS
 * property literally named `experimental-background-image`, which the
 * browser ignores. Plain `backgroundImage`, on the other hand, falls through
 * that same generic branch and becomes the real DOM style key `backgroundImage`
 * (React's `style` attribute uses camelCase directly), which the browser
 * renders correctly. So: native gets `experimental_backgroundImage`, web gets
 * a plain `backgroundImage`, and both are optional enhancements layered over
 * an always-present solid `backgroundColor`.
 */
const GRADIENT_KEY = process.env.EXPO_OS === 'web' ? 'backgroundImage' : 'experimental_backgroundImage';

export type Material = 'card' | 'raised' | 'sunken' | 'control' | 'controlPressed' | 'accent' | 'accentPressed';

function withGradient(style: ViewStyle, gradient: string | undefined): ViewStyle {
  if (!gradient) return style;
  return { ...style, [GRADIENT_KEY]: gradient };
}

/**
 * Resolves the background/shadow/gradient combination for one material in the
 * "soft & tactile" design language. Every material is a solid `backgroundColor`
 * plus a real `boxShadow` string, with a CSS gradient layered on top as an
 * optional enhancement (never required for the material to look correct).
 */
export function materialStyle(theme: ThemeTokens, material: Material): ViewStyle {
  switch (material) {
    case 'card':
      return withGradient({ backgroundColor: theme.surface, boxShadow: theme.shadowCard }, theme.surfaceGradient);
    case 'raised':
      return withGradient({ backgroundColor: theme.surface, boxShadow: theme.shadowRaised }, theme.surfaceGradient);
    case 'sunken':
      return { backgroundColor: theme.surfaceSunken, boxShadow: theme.shadowSunken };
    case 'control':
      return withGradient({ backgroundColor: theme.surfaceElevated, boxShadow: theme.shadowControl }, theme.surfaceGradient);
    case 'controlPressed':
      return { backgroundColor: theme.surfaceMuted, boxShadow: theme.shadowControlPressed };
    case 'accent':
      return withGradient({ backgroundColor: theme.accent, boxShadow: theme.shadowAccent }, theme.accentGradient);
    case 'accentPressed':
      return { backgroundColor: theme.accent, boxShadow: theme.shadowControlPressed };
    default:
      return {};
  }
}

/** Convenience hook: `materialStyle` bound to the current theme. */
export function useMaterial(material: Material): ViewStyle {
  const theme = useQashyTheme();
  return materialStyle(theme, material);
}
