/**
 * A one-line cache of the resolved theme's page color and scheme, so the static web shell can paint
 * the right background before React and before settings load. Without it a user who chose dark
 * (or whose system is dark and who forced light) sees the shell's default color flash on every
 * PWA launch.
 *
 * Web only, in `localStorage`, and never anything but a scheme and two colors: no finance data, no
 * `AppSettings`, nothing that syncs. Every access is wrapped because storage can be absent or
 * throw (private windows, blocked site data), and the page must render correctly without it.
 */

export const THEME_HINT_KEY = "qashy:theme-hint";

export interface ThemeHint {
  scheme: "light" | "dark";
  /** The resolved page background, `#RRGGBB`. */
  background: string;
  /** The resolved accent, `#RRGGBB`; tints the startup loading indicator. */
  accent: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Validates a stored value; anything unexpected is no hint at all. */
export function parseThemeHint(raw: unknown): ThemeHint | null {
  if (typeof raw !== "string") return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { scheme, background, accent } = value as Record<string, unknown>;
    if (scheme !== "light" && scheme !== "dark") return null;
    if (typeof background !== "string" || !HEX.test(background)) return null;
    if (typeof accent !== "string" || !HEX.test(accent)) return null;
    return { scheme, background, accent };
  } catch {
    return null;
  }
}

/** The stored text as is (a stable value, so it can back `useSyncExternalStore`), or null. */
export function readThemeHintRaw(): string | null {
  if (process.env.EXPO_OS !== "web") return null;
  try {
    return globalThis.localStorage?.getItem(THEME_HINT_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeThemeHint(hint: ThemeHint) {
  if (process.env.EXPO_OS !== "web") return;
  try {
    // A color the shell cannot paint (not plain hex) clears the hint rather than leaving a stale one.
    if (!HEX.test(hint.background) || !HEX.test(hint.accent))
      globalThis.localStorage?.removeItem(THEME_HINT_KEY);
    else globalThis.localStorage?.setItem(THEME_HINT_KEY, JSON.stringify(hint));
  } catch {
    // Storage unavailable or full: the next launch falls back to the system scheme.
  }
}

/**
 * The inline script `+html.tsx` runs in the document head. It publishes the cached page color as
 * `--qashy-bg` and pins the UA color scheme; with no (or an invalid) hint it does nothing, and
 * the stylesheet's `prefers-color-scheme` rules paint the fallback. The text is fixed, so the
 * Content Security Policy pins its hash (`THEME_HINT_SCRIPT_HASH` in `csp.ts`; a test checks it).
 */
export const THEME_HINT_SCRIPT = `(function(){try{var h=JSON.parse(localStorage.getItem("${THEME_HINT_KEY}"));if(!h||(h.scheme!=="light"&&h.scheme!=="dark")||!/^#[0-9a-fA-F]{6}$/.test(h.background))return;var s=document.documentElement.style;s.setProperty("--qashy-bg",h.background);s.colorScheme=h.scheme}catch(e){}})();`;
