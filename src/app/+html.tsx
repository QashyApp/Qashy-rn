import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

import { classicTheme } from '@/theme/themes/classic';
import { CONTENT_SECURITY_POLICY } from '@/utils/csp';

// Derived from the same tokens the app renders with, rather than hand-copied. The
// static shell used to carry its own `#F7F7FB`/`#121217` pair while the app painted
// `#F6F7F9`/`#0E0F13`, so first paint stepped to a different colour in both schemes
// and the address-bar tint never matched the page behind it.
const LIGHT_BACKGROUND = classicTheme.palette.light.background;
const DARK_BACKGROUND = classicTheme.palette.dark.background;
const QASHY_INDIGO = classicTheme.accent.default;
// This static shell renders before React and before settings load, so classic is the only
// possible choice here. Known limit: manifest.json theme_color/background_color are static per
// install; only the in-page <meta name="theme-color"> follows the active theme (QashyThemeProvider).

// react-native-web resets `outline` to none on every pressable it renders, and
// nothing put a focus style back, so keyboard navigation was invisible across
// the whole site. The rule has to win against RNW's class-based reset, which is
// injected into the head at runtime and therefore always sorts after this tag.
//
// `--qashy-focus` and the selection colors are published by QashyThemeProvider
// so the ring follows the accent the user actually chose; the literals here are
// the defaults that apply before hydration.
const GLOBAL_CSS = `
:root {
  color-scheme: light dark;
  --qashy-focus: ${QASHY_INDIGO};
  --qashy-selection: ${QASHY_INDIGO}33;
  --qashy-selection-text: inherit;
}
html, body {
  background: ${LIGHT_BACKGROUND};
  /* Keeps an installed PWA from rubber-banding or pull-to-refreshing the app
     shell when an inner list runs out of scroll. */
  overscroll-behavior-y: none;
}
::selection {
  background-color: var(--qashy-selection);
  color: var(--qashy-selection-text);
}
:focus-visible:not(input):not(textarea):not(select):not([contenteditable]) {
  outline: 2px solid var(--qashy-focus) !important;
  outline-offset: 2px;
}
input:focus-visible, textarea:focus-visible, select:focus-visible, [contenteditable]:focus-visible {
  outline: none !important;
}
@media (prefers-color-scheme: dark) {
  html, body { background: ${DARK_BACKGROUND}; }
}
/* Windows High Contrast / forced colors replaces every background and box-shadow with system
   colors, which erased progress fills, the selected segment of a control and card edges. Keep
   progress colors as authored (on an outlined track) and mark selected controls with Highlight. */
@media (forced-colors: active) {
  [role="progressbar"] {
    forced-color-adjust: none;
    outline: 1px solid CanvasText;
  }
  [role="radio"][aria-checked="true"],
  [role="tab"][aria-selected="true"],
  [role="button"][aria-pressed="true"],
  [aria-selected="true"][role="button"] {
    forced-color-adjust: none;
    background-color: Highlight !important;
    color: HighlightText !important;
    outline: 2px solid CanvasText;
  }
  [role="radio"][aria-checked="true"] *,
  [role="tab"][aria-selected="true"] *,
  [role="button"][aria-pressed="true"] *,
  [aria-selected="true"][role="button"] * {
    color: HighlightText !important;
  }
}
`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en-US" dir="ltr">
      <head>
        <meta charSet="utf-8" />
        {/* Production only. The dev server rewrites the bundle on every save and talks to
            Metro over its own socket, and a policy fixed at build time cannot describe that
            without being loosened to the point of proving nothing. The exported `dist/` is
            what ships and what `e2e/qashy.spec.ts` runs against, so that is where it holds. */}
        {process.env.NODE_ENV === 'production' ? (
          <meta httpEquiv="Content-Security-Policy" content={CONTENT_SECURITY_POLICY} />
        ) : null}
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* Fallback title. Routes that render `expo-router/head` override it. */}
        <title>Qashy — Calm Budgeting</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        {/* Tints the address bar to match the page behind it. The light entry
            used to be the indigo accent, which is not a surface the app ever
            paints. QashyThemeProvider rewrites both once it knows whether the
            user has forced a mode instead of following the system. */}
        <meta id="qashy-theme-color-light" name="theme-color" content={LIGHT_BACKGROUND} media="(prefers-color-scheme: light)" />
        <meta id="qashy-theme-color-dark" name="theme-color" content={DARK_BACKGROUND} media="(prefers-color-scheme: dark)" />
        <meta name="description" content="A calm, private, local-first budget tracker." />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Qashy" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/qashy-icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/qashy-icon-192.png" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
