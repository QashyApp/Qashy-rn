import type { ThemeMode } from "@/domain/models";

/**
 * A one-line cache of the user's theme mode and the resolved page color and accent, so the static
 * web shell can paint the right background before React and before settings load. Without it a
 * user who forced dark (or forced light on a dark system) sees the shell's default color flash on
 * every PWA launch.
 *
 * The cached page color is only ever used for a FORCED mode. With the mode on "system" the hint
 * says so and the shell leaves the choice to `prefers-color-scheme`: the cached color belongs to
 * whatever scheme the system had last session, which may not be today's.
 *
 * Web only, in `localStorage`, and never anything but a mode and two colors: no finance data, no
 * `AppSettings`, nothing that syncs. Every access is wrapped because storage can be absent or
 * throw (private windows, blocked site data), and the page must render correctly without it.
 */

export const THEME_HINT_KEY = "qashy:theme-hint";

export interface ThemeHint {
  /** The user's theme mode (not the resolved scheme): `system` means the live system scheme decides. */
  mode: ThemeMode;
  /** The page background resolved last session, `#RRGGBB`; only meaningful for a forced mode. */
  background: string;
  /** The resolved accent, `#RRGGBB`; tints the startup loading indicator in every mode (across schemes it differs only by a contrast-driven shade). */
  accent: string;
}

const MODES: readonly string[] = ["system", "light", "dark"];
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Validates a stored value; anything unexpected is no hint at all. */
export function parseThemeHint(raw: unknown): ThemeHint | null {
  if (typeof raw !== "string") return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { mode, background, accent } = value as Record<string, unknown>;
    if (typeof mode !== "string" || !MODES.includes(mode)) return null;
    if (typeof background !== "string" || !HEX.test(background)) return null;
    if (typeof accent !== "string" || !HEX.test(accent)) return null;
    return { mode: mode as ThemeMode, background, accent };
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
 * The inline script `+html.tsx` runs in the document head. For a forced light or dark mode it
 * publishes the cached page color as `--qashy-bg`, pins the UA color scheme and sets both
 * address-bar theme-color metas to that color (what the theme provider writes for a forced mode,
 * so a dark launch on a light system does not tint the bar light). With mode
 * `system`, no hint, or an invalid one it does nothing, and the stylesheet's
 * `prefers-color-scheme` rules paint the live system scheme. The text is fixed, so the Content
 * Security Policy pins its hash (`THEME_HINT_SCRIPT_HASH` in `csp.ts`; a test checks it).
 */
export const THEME_HINT_SCRIPT = `(function(){try{var h=JSON.parse(localStorage.getItem("${THEME_HINT_KEY}"));if(!h||(h.mode!=="light"&&h.mode!=="dark")||!/^#[0-9a-fA-F]{6}$/.test(h.background))return;var s=document.documentElement.style;s.setProperty("--qashy-bg",h.background);s.colorScheme=h.mode;["light","dark"].forEach(function(n){var m=document.getElementById("qashy-theme-color-"+n);if(m)m.setAttribute("content",h.background)})}catch(e){}})();`;
