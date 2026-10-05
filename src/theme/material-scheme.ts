import {
  Hct,
  MaterialDynamicColors,
  SchemeTonalSpot,
  argbFromHex,
  hexFromArgb,
} from "@material/material-color-utilities";

import type { ThemeScheme } from "@/theme/themes/types";
import type { BaseTokens } from "@/theme/tokens";

/**
 * The Material 3 color roles for a seed, from Google's own HCT tonal-spot scheme (the algorithm
 * Android's Material You uses for a wallpaper), so a picked accent produces the same containers,
 * surfaces and outlines as the real thing instead of a blend toward the seed. Pure: no clock,
 * randomness or I/O.
 */
export interface MaterialRoles {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  outline: string;
  inverseSurface: string;
  inverseOnSurface: string;
  inversePrimary: string;
  /** Surfaces, text and borders for the scheme, with the base palette's semantic colors kept. */
  palette: BaseTokens;
}

const cache = new Map<string, MaterialRoles>();

/** Roles for `seed` (`#RRGGBB`) in `scheme`, laid over `base` (which keeps income/expense/warning/transfer). */
export function materialRoles(
  seed: string,
  scheme: ThemeScheme,
  base: BaseTokens,
): MaterialRoles {
  const key = `${seed}|${scheme}|${base.positive}${base.negative}${base.warning}${base.transfer}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const dark = scheme === "dark";
  const source = new SchemeTonalSpot(Hct.fromInt(argbFromHex(seed)), dark, 0);
  const role = (name: keyof typeof MaterialDynamicColors) =>
    hexFromArgb(
      (MaterialDynamicColors[name] as { getArgb(s: unknown): number }).getArgb(
        source,
      ),
    ).toUpperCase();

  const surface = role("surface");
  const roles: MaterialRoles = {
    primary: role("primary"),
    onPrimary: role("onPrimary"),
    primaryContainer: role("primaryContainer"),
    onPrimaryContainer: role("onPrimaryContainer"),
    outline: role("outline"),
    inverseSurface: role("inverseSurface"),
    inverseOnSurface: role("inverseOnSurface"),
    inversePrimary: role("inversePrimary"),
    palette: {
      ...base,
      background: surface,
      surface: role("surfaceContainerLow"),
      surfaceElevated: role("surfaceContainer"),
      surfaceMuted: role("surfaceContainerHigh"),
      // Material's fields and tracks are the highest container in both modes. The old "sunken"
      // surface was the lowest container in dark mode, so wells read inverted against the page.
      surfaceSunken: role("surfaceContainerHighest"),
      text: role("onSurface"),
      textMuted: role("onSurfaceVariant"),
      border: role("outlineVariant"),
      secondaryContainer: role("secondaryContainer"),
      onSecondaryContainer: role("onSecondaryContainer"),
      tertiaryContainer: role("tertiaryContainer"),
      onTertiaryContainer: role("onTertiaryContainer"),
      headerBackground: surface,
      navBackground: role("surfaceContainer"),
    },
  };
  if (cache.size > 64) cache.clear();
  cache.set(key, roles);
  return roles;
}
