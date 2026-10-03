import { Platform } from 'react-native';

import { classicTheme } from '@/theme/themes/classic';
import { highContrastTheme } from '@/theme/themes/high-contrast';
import { materialYouTheme } from '@/theme/themes/material-you';
import { DEFAULT_THEME_ID, type ThemeDefinition } from '@/theme/themes/types';

/** Themes that ship in the app. Custom themes (Phase 11) are passed in by the caller, per device. */
export const BUILT_IN_THEMES: readonly ThemeDefinition[] = [classicTheme, materialYouTheme, highContrastTheme];

export type ThemePlatform = 'ios' | 'android' | 'web';

/** Whether a theme is offered on a platform; `availableOn` omitted means everywhere. */
export function isThemeAvailable(theme: ThemeDefinition, platform: ThemePlatform = currentPlatform()): boolean {
  return !theme.availableOn || theme.availableOn.includes(platform);
}

function currentPlatform(): ThemePlatform {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
}

/** Built-in themes followed by custom ones (built-in ids win), limited to those the platform offers. */
export function listAvailableThemes(custom: readonly ThemeDefinition[] = [], platform: ThemePlatform = currentPlatform()): ThemeDefinition[] {
  const builtInIds = new Set(BUILT_IN_THEMES.map((theme) => theme.id));
  return [...BUILT_IN_THEMES, ...custom.filter((theme) => !builtInIds.has(theme.id))].filter((theme) =>
    isThemeAvailable(theme, platform),
  );
}

/**
 * Resolves an id to a theme, never throwing: an id this device cannot resolve — a removed theme,
 * a custom theme that was deleted, an older save without one, or a theme not offered on this
 * platform (settings replicate between devices) — is the default theme.
 * Built-ins win over a custom theme that reuses their id.
 */
export function getTheme(
  id: string | null | undefined,
  custom: readonly ThemeDefinition[] = [],
  platform: ThemePlatform = currentPlatform(),
): ThemeDefinition {
  const match =
    BUILT_IN_THEMES.find((theme) => theme.id === id) ?? custom.find((theme) => theme.id === id);
  return match && isThemeAvailable(match, platform) ? match : classicTheme;
}

export { DEFAULT_THEME_ID };
