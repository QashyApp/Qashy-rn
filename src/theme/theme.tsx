import { Host } from "@expo/ui";
import {
  Color,
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
} from "expo-router";
import { createContext, use, useEffect, useMemo, type ReactNode } from "react";
import {
  Appearance,
  Platform,
  type ColorValue,
  useColorScheme,
} from "react-native";

import { DirectionScope } from "@/components/ui/direction-scope";
import type { AccentSource } from "@/domain/models";
import { useLocalization } from "@/localization/localization";
import { useFinanceSettings } from "@/providers/finance-provider";
import { useCustomThemes } from "@/theme/custom/use-custom-themes";
import { clampPaletteContrast } from "@/theme/custom/contrast";
import {
  deriveDynamicPalette,
  type SystemPalettes,
} from "@/theme/dynamic-palette";
import { materialRoles } from "@/theme/material-scheme";
import { useIconSets } from "@/theme/icon-sets";
import { applyAppearanceOverrides } from "@/theme/overrides";
import { NO_SHADOW, bevelAccentShadow, flatShadowSet } from "@/theme/shadow";
import { useSystemPalettes } from "@/theme/use-system-palettes";
import { classicTheme } from "@/theme/themes/classic";
import { getTheme } from "@/theme/themes/registry";
import type {
  ChartSpec,
  IconBadgeShape,
  IconBadgeStyle,
  IconSizeScale,
  MaterialSpec,
  MotionSpec,
  RadiusScale,
  SpaceScale,
  ThemeDefinition,
  TileScale,
  TypeSpec,
} from "@/theme/themes/types";
import { fontStyle } from "@/theme/typography";
import {
  accessibleAccentColor,
  ensureContrast,
  mixHex,
  readableTextColor,
  withAlpha,
  type BaseTokens,
} from "@/theme/tokens";

export interface ThemeTokens {
  mode: "light" | "dark";
  /** Shape and rhythm come from the active theme; never import the classic constants from `@/theme/tokens`. */
  space: SpaceScale;
  radius: RadiusScale;
  tile: TileScale;
  iconSize: IconSizeScale;
  motion: MotionSpec;
  /** Registered icon set id (see `@/theme/icon-sets`); only changes how an icon id is drawn. */
  iconSet: string;
  /** Icon set that draws entity icons (categories, accounts, goals); the theme's categorySet, else iconSet. */
  categoryIconSet: string;
  /** How an entity icon sits in its badge; see IconBadge. */
  iconBadge: { style: IconBadgeStyle; shape: IconBadgeShape };
  /** How card, list and tile surfaces are drawn: raised material, hairline outline, or a tonal fill. */
  cardStyle: MaterialSpec["card"];
  /** Draw switches and segmented controls the Material 3 way (the flat engine's look). */
  materialControls: boolean;
  /** Font stacks and the type scale; resolve faces with `fontStyle(weight, type)` and friends from `@/theme/typography`. */
  type: TypeSpec;
  /** Line/donut/grid geometry, slice patterns and category tone for charts. */
  charts: ChartSpec;
  /** Whether surfaces layer the subtle gradients (off for flat and pixel looks). */
  gradients: boolean;
  accent: ColorValue;
  /**
   * The accent as a *text or glyph* colour on the theme's own surfaces. `accent` itself only
   * clears 3:1 (it is mostly a fill), which is not enough for small text; this is nudged to 4.5:1
   * against background, surface and muted surface. Use it for any accent-coloured text.
   */
  accentText: ColorValue;
  onAccent: ColorValue;
  accentContainer: ColorValue;
  onAccentContainer: ColorValue;
  background: ColorValue;
  surface: ColorValue;
  surfaceElevated: ColorValue;
  surfaceMuted: ColorValue;
  /** The fill of a sunken "well": progress tracks, segmented-control tracks, input fields. */
  surfaceSunken: ColorValue;
  text: ColorValue;
  textMuted: ColorValue;
  /** The quiet divider and card edge (Material's outline-variant). */
  border: ColorValue;
  /**
   * The edge of an outlined control (segmented button, chip, text-field bar, switch track): firmer
   * than `border`, softer than `textMuted`. Meets 3:1 against the surface it sits on.
   */
  outline: ColorValue;
  /** A snackbar: the inverse of the page, its text and its action color. */
  inverseSurface: ColorValue;
  inverseOnSurface: ColorValue;
  inversePrimary: ColorValue;
  positive: ColorValue;
  onPositive: ColorValue;
  negative: ColorValue;
  onNegative: ColorValue;
  warning: ColorValue;
  onWarning: ColorValue;
  /** Semantic color for transfers — neither an income nor an expense. */
  transfer: ColorValue;
  /** Tonal secondary and tertiary containers (chips, selected rows, highlights) and their content colors. */
  secondaryContainer: ColorValue;
  onSecondaryContainer: ColorValue;
  tertiaryContainer: ColorValue;
  onTertiaryContainer: ColorValue;
  /** Fill behind a stack header (see stack-layout). Equal to background unless the theme sets it apart. */
  headerBackground: ColorValue;
  /** Fill of the bottom navigation bar. */
  navBackground: ColorValue;
  glassTint: "light" | "dark" | "systemMaterial";
  staticAccent: string;
  /**
   * Real hex for the current mode's card surface and primary text.
   *
   * `surface` and `text` can be opaque Android platform colors under Material
   * You, which the hex helpers in `@/theme/tokens` cannot read. Anything doing
   * color math — `toneColors` for category tints, chart fills — must use these.
   */
  staticSurface: string;
  staticText: string;
  /**
   * CSS `linear-gradient(180deg, top, bottom)` for a raised surface (card,
   * sheet): a subtle top-to-bottom lightening that makes it read as physical
   * material rather than a flat fill. `undefined` under Android's Material You,
   * because `surface` is then an opaque platform color with no JS-readable hex
   * to gradient from.
   */
  surfaceGradient: string | undefined;
  /** CSS `linear-gradient(180deg, top, bottom)` for a primary/accent-filled control. */
  accentGradient: string;
  /**
   * The elevation ladder for the "soft & tactile" material language. Every
   * value is a real CSS `box-shadow` string, valid on native (RN 0.86's
   * `boxShadow` style prop) and on web. Raised surfaces (`shadowCard`,
   * `shadowRaised`) combine an inset top highlight — light catching the top
   * edge — with a soft, layered outer drop shadow, in both modes: unlike the
   * old ladder, dark mode's inset highlight *is* visible against a dark page
   * even though an outer glow would not be, so `shadowCard` is a real string
   * in both modes now, never `undefined`. Sunken wells and pressed controls
   * use an inset shadow only, with no outer shadow, so they read as carved in
   * rather than lifted.
   */
  shadowCard: string;
  shadowRaised: string;
  /** A raised, unpressed control (button, chip, input) at rest. */
  shadowControl: string;
  /** The same control pressed in: inset only, no outer shadow. */
  shadowControlPressed: string;
  /** A sunken well: progress track, segmented-control track, input field. */
  shadowSunken: string;
  shadowOverlay: string;
  /** The floating action button: tighter and darker than `shadowRaised`, so it reads as pressable. */
  shadowFab: string;
  /** An accent-filled control (primary button, FAB) at rest. */
  shadowAccent: string;
  /** The dimmed layer behind a modal picker or menu. */
  scrim: string;
}

const ThemeContext = createContext<ThemeTokens | null>(null);

/** Builds the accent-dependent shadow/gradient pair that no static const can hold. */
function accentMaterial(accent: string, dark: boolean, material: MaterialSpec) {
  if (material.engine === "flat") {
    // A solid fill: no gradient, no drop shadow. Press feedback is the pressed material's tonal fill.
    return {
      accentGradient: `linear-gradient(180deg, ${accent}, ${accent})`,
      shadowAccent: NO_SHADOW,
    };
  }
  if (material.engine === "bevel") {
    return {
      accentGradient: `linear-gradient(180deg, ${accent}, ${accent})`,
      shadowAccent: bevelAccentShadow(accent, material.bevelDepth),
    };
  }
  const gradientTop = mixHex(accent, "#FFFFFF", dark ? 0.1 : 0.14);
  const accentGradient = `linear-gradient(180deg, ${gradientTop}, ${accent})`;
  const highlightAlpha = dark ? 0.18 : 0.28;
  const outerAlpha1 = dark ? 0.42 : 0.3;
  const outerAlpha2 = dark ? 0.6 : 0.45;
  const shadowAccent = `inset 0 1px 0 rgba(255,255,255,${highlightAlpha}), 0 1px 2px ${withAlpha(accent, outerAlpha1)}, 0 6px 14px -4px ${withAlpha(accent, outerAlpha2)}`;
  return { accentGradient, shadowAccent };
}

/** An outline for a palette with no Material role for it: the muted text pulled toward the page. */
function fallbackOutline(base: BaseTokens, dark: boolean): string {
  return ensureContrast(
    mixHex(base.textMuted, base.background, dark ? 0.3 : 0.25),
    base.surface,
    base.text,
    3,
  );
}

// Hand-tuned neutral surfaces with a single accent family. The user's accent
// only drives accent/accentContainer colors; surfaces stay neutral so the app
// keeps a conventional, high-contrast look in both modes.
export function accentTokens(
  seed: string,
  dark: boolean,
  sourceTheme: ThemeDefinition = classicTheme,
): ThemeTokens {
  const scheme = dark ? "dark" : "light";
  // A tinted theme (Material You) takes its whole palette from the seed's Material 3 tonal scheme;
  // shadows that are rings of the border color must follow that palette.
  const tinted = sourceTheme.accent.tintSurfaces === true;
  const roles = tinted
    ? materialRoles(seed, scheme, sourceTheme.palette[scheme])
    : null;
  const base = roles
    ? clampPaletteContrast(scheme, roles.palette).palette
    : sourceTheme.palette[scheme];
  const theme: ThemeDefinition = tinted
    ? {
        ...sourceTheme,
        palette: { ...sourceTheme.palette, [scheme]: base },
        shadows:
          sourceTheme.material.engine === "flat"
            ? {
                ...sourceTheme.shadows,
                [scheme]: flatShadowSet(base, scheme),
              }
            : sourceTheme.shadows,
      }
    : sourceTheme;
  const accent = roles
    ? roles.primary
    : accessibleAccentColor(seed, base.surface, base.text);
  const accentContainer = roles
    ? roles.primaryContainer
    : mixHex(accent, base.surface, dark ? 0.78 : 0.86);
  const outline = roles
    ? ensureContrast(roles.outline, base.surface, base.text, 3)
    : fallbackOutline(base, dark);
  const inverseSurface = roles
    ? roles.inverseSurface
    : dark
      ? base.text
      : mixHex(base.text, base.background, 0.15);
  const inverseOnSurface = roles
    ? roles.inverseOnSurface
    : readableTextColor(inverseSurface);
  const inversePrimary = roles
    ? roles.inversePrimary
    : ensureContrast(accent, inverseSurface, inverseOnSurface, 3);
  const surfaceGradient = dark
    ? `linear-gradient(180deg, ${mixHex(base.surface, "#FFFFFF", 0.035)}, ${base.surface})`
    : `linear-gradient(180deg, #FFFFFF, ${mixHex("#FFFFFF", base.background, 0.35)})`;
  const { accentGradient, shadowAccent } = accentMaterial(
    accent,
    dark,
    theme.material,
  );
  return {
    mode: dark ? "dark" : "light",
    space: theme.space,
    radius: theme.radius,
    tile: theme.tile,
    iconSize: theme.iconSize,
    motion: theme.motion,
    iconSet: theme.icons.set,
    categoryIconSet: theme.icons.categorySet ?? theme.icons.set,
    iconBadge: { style: theme.icons.badge, shape: theme.icons.badgeShape },
    cardStyle: theme.material.card,
    materialControls: theme.material.engine === "flat",
    type: theme.type,
    charts: theme.charts,
    gradients: theme.material.gradients,
    accent,
    accentText: [base.surface, base.background, base.surfaceMuted].reduce(
      (color, surface) =>
        ensureContrast(
          color,
          surface,
          base.text,
          theme.id === "high-contrast" ? 7 : 4.5,
        ),
      accent,
    ),
    onAccent: roles ? roles.onPrimary : readableTextColor(accent),
    accentContainer,
    onAccentContainer: roles
      ? roles.onPrimaryContainer
      : ensureContrast(accent, accentContainer, base.text),
    background: base.background,
    surface: base.surface,
    surfaceElevated: base.surfaceElevated,
    surfaceMuted: base.surfaceMuted,
    surfaceSunken: base.surfaceSunken,
    text: base.text,
    textMuted: base.textMuted,
    border: base.border,
    outline,
    inverseSurface,
    inverseOnSurface,
    inversePrimary,
    positive: base.positive,
    onPositive: readableTextColor(base.positive),
    negative: base.negative,
    onNegative: readableTextColor(base.negative),
    warning: base.warning,
    onWarning: readableTextColor(base.warning),
    transfer: base.transfer,
    secondaryContainer: base.secondaryContainer,
    onSecondaryContainer: base.onSecondaryContainer,
    tertiaryContainer: base.tertiaryContainer,
    onTertiaryContainer: base.onTertiaryContainer,
    headerBackground: base.headerBackground,
    navBackground: base.navBackground,
    glassTint: dark ? "dark" : "light",
    staticAccent: accent,
    staticSurface: base.surface,
    staticText: base.text,
    surfaceGradient,
    accentGradient,
    shadowAccent,
    ...theme.shadows[scheme],
  };
}

// Material You stays available as an explicit opt-in on Android only; every
// other platform uses the default indigo on the hand-tuned neutral surfaces.
function systemTokens(
  dark: boolean,
  theme: ThemeDefinition = classicTheme,
  palettes: SystemPalettes | null = null,
): ThemeTokens {
  if (palettes) return paletteTokens(palettes, dark, theme);
  const fallback = accentTokens(theme.accent.default, dark, theme);
  if (Platform.OS !== "android") return fallback;
  const { accentGradient, shadowAccent } = accentMaterial(
    fallback.staticAccent,
    dark,
    theme.material,
  );
  return {
    ...fallback,
    accent: Color.android.dynamic.primary,
    accentText: Color.android.dynamic.primary,
    onAccent: Color.android.dynamic.onPrimary,
    accentContainer: Color.android.dynamic.primaryContainer,
    onAccentContainer: Color.android.dynamic.onPrimaryContainer,
    background: Color.android.dynamic.surface,
    surface: Color.android.dynamic.surfaceContainerLow,
    surfaceElevated: Color.android.dynamic.surfaceContainer,
    surfaceMuted: Color.android.dynamic.surfaceContainerHigh,
    surfaceSunken: Color.android.dynamic.surfaceContainerHighest,
    text: Color.android.dynamic.onSurface,
    textMuted: Color.android.dynamic.onSurfaceVariant,
    border: Color.android.dynamic.outlineVariant,
    outline: Color.android.dynamic.outline,
    // `surface` is now an opaque platform color with no JS-readable hex, so a
    // gradient computed from it would be meaningless; the accent gradient is
    // still derived from a real hex seed and stays valid.
    surfaceGradient: undefined,
    accentGradient,
    shadowAccent,
  };
}

/**
 * Tokens from the Android 12+ wallpaper palettes (read by the qashy-dynamic-colors module): the
 * whole palette is derived in JS like a seed theme, so every value is real hex, gradients, chart
 * tints and contrast math all work, and nothing relies on opaque platform colors.
 */
function paletteTokens(
  palettes: SystemPalettes,
  dark: boolean,
  theme: ThemeDefinition,
): ThemeTokens {
  const scheme = dark ? "dark" : "light";
  const derived = deriveDynamicPalette(palettes, scheme, theme.palette[scheme]);
  const derivedTheme: ThemeDefinition = {
    ...theme,
    // The wallpaper palette already carries its own surface tint.
    accent: { ...theme.accent, tintSurfaces: false },
    palette: { ...theme.palette, [scheme]: derived.palette },
    // Flat shadows are rings of the border color, so they follow the derived border.
    shadows:
      theme.material.engine === "flat"
        ? { ...theme.shadows, [scheme]: flatShadowSet(derived.palette, scheme) }
        : theme.shadows,
  };
  return {
    ...accentTokens(derived.seed, dark, derivedTheme),
    accentContainer: derived.accentContainer,
    onAccentContainer: derived.onAccentContainer,
    outline: ensureContrast(
      derived.outline,
      derived.palette.surface,
      derived.palette.text,
      3,
    ),
  };
}

// The appearance preview has to show the accent the provider will actually
// apply. It used to rebuild its own swatch from a hard-coded indigo literal, so
// Android's Material You accent previewed as plain blue no matter what the
// wallpaper produced. Reusing the same two builders is what keeps the preview
// and the applied theme from drifting apart again.
//
// Android's dynamic accent is an opaque platform color with no JS-readable hex,
// so callers must render these values directly and must not pass them through
// the hex helpers in `@/theme/tokens`.
export function previewAccentTokens(
  source: AccentSource,
  accentHex: string,
  dark: boolean,
  theme: ThemeDefinition = classicTheme,
) {
  const tokens =
    source === "system"
      ? systemTokens(dark, theme)
      : accentTokens(accentHex, dark, theme);
  return { accent: tokens.accent, onAccent: tokens.onAccent };
}

/**
 * Which accent a theme lets the settings choose: `system` themes always use the platform accent,
 * `fixed` themes ignore the settings entirely, and `user` themes follow `accentSource`/`accentHex`.
 */
export function resolveAccentChoice(
  theme: ThemeDefinition,
  settings: { accentSource: AccentSource; accentHex: string },
): { kind: "system" } | { kind: "seed"; seed: string } {
  switch (theme.accent.mode) {
    case "system":
      return { kind: "system" };
    case "fixed":
      return { kind: "seed", seed: theme.accent.default };
    default:
      return settings.accentSource === "system"
        ? { kind: "system" }
        : { kind: "seed", seed: settings.accentHex };
  }
}

export function QashyThemeProvider({ children }: { children: ReactNode }) {
  const settings = useFinanceSettings();
  const { isRtl } = useLocalization();
  const systemScheme = useColorScheme();
  const mode =
    settings.themeMode === "system"
      ? systemScheme === "dark"
        ? "dark"
        : "light"
      : settings.themeMode;
  // A custom theme that is not loaded yet, was deleted, or no longer resolves is classic; the stored id is left alone.
  const { themes: customThemes } = useCustomThemes();
  const {
    fontTextOverride,
    fontNumericOverride,
    uiIconSetOverride,
    categoryIconSetOverride,
  } = settings;
  const baseTheme = useMemo(
    () => getTheme(settings.themeId, customThemes),
    [settings.themeId, customThemes],
  );
  // The font and icon-set choices of this device sit on top of whichever theme is active.
  const theme = useMemo(
    () =>
      applyAppearanceOverrides(baseTheme, {
        fontTextOverride,
        fontNumericOverride,
        uiIconSetOverride,
        categoryIconSetOverride,
      }),
    [
      baseTheme,
      fontTextOverride,
      fontNumericOverride,
      uiIconSetOverride,
      categoryIconSetOverride,
    ],
  );
  const accentChoice = resolveAccentChoice(theme, settings);
  const usesSystemAccent = accentChoice.kind === "system";
  const seed =
    accentChoice.kind === "seed" ? accentChoice.seed : theme.accent.default;
  const palettes = useSystemPalettes(usesSystemAccent);
  // A set fetched on demand draws as Ionicons until it lands; the new tokens object that follows
  // is what re-renders every icon with it.
  const iconsReady = useIconSets([
    theme.icons.set,
    theme.icons.categorySet ?? theme.icons.set,
  ]);
  const tokens = useMemo(
    () =>
      usesSystemAccent
        ? systemTokens(mode === "dark", theme, palettes)
        : accentTokens(seed, mode === "dark", theme),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- iconsReady only forces a fresh object
    [mode, seed, theme, usesSystemAccent, palettes, iconsReady],
  );

  useEffect(() => {
    if (
      process.env.EXPO_OS !== "web" &&
      typeof Appearance.setColorScheme === "function"
    ) {
      Appearance.setColorScheme(
        settings.themeMode === "system" ? "unspecified" : settings.themeMode,
      );
    }
  }, [settings.themeMode]);

  // Browser chrome the React tree cannot reach: the focus ring and selection
  // colors declared in `+html.tsx`, the UA color scheme that decides whether
  // scrollbars and form widgets paint light or dark, and the address-bar tint.
  //
  // `color-scheme` is pinned to the resolved mode rather than left at
  // `light dark`, because a user who forces dark while the system is light
  // would otherwise get a white scrollbar down the side of a dark page.
  useEffect(() => {
    if (process.env.EXPO_OS !== "web" || typeof document === "undefined")
      return;
    const root = document.documentElement;
    const cssColor = (value: ColorValue, fallback: string) =>
      typeof value === "string" ? value : fallback;
    root.style.colorScheme = mode;
    root.style.setProperty(
      "--qashy-focus",
      cssColor(tokens.accent, tokens.staticAccent),
    );
    root.style.setProperty(
      "--qashy-selection",
      cssColor(tokens.accentContainer, `${tokens.staticAccent}33`),
    );
    root.style.setProperty(
      "--qashy-selection-text",
      cssColor(tokens.onAccentContainer, "inherit"),
    );

    // Following the system means each media-scoped meta stays truthful. Forcing
    // a mode means only one of them can ever match, so both carry that surface.
    const background = cssColor(
      tokens.background,
      theme.palette[mode].background,
    );
    const light = document.getElementById("qashy-theme-color-light");
    const dark = document.getElementById("qashy-theme-color-dark");
    light?.setAttribute(
      "content",
      settings.themeMode === "system"
        ? theme.palette.light.background
        : background,
    );
    dark?.setAttribute(
      "content",
      settings.themeMode === "system"
        ? theme.palette.dark.background
        : background,
    );
  }, [mode, settings.themeMode, theme, tokens]);

  const navigationTheme = useMemo(() => {
    const baseNavigation = mode === "dark" ? DarkTheme : DefaultTheme;
    return {
      ...baseNavigation,
      // Native stack headers (titles, large titles, back labels) use the app face too.
      fonts: {
        regular: {
          fontFamily: fontStyle("regular", theme.type).fontFamily as string,
          fontWeight: "normal" as const,
        },
        medium: {
          fontFamily: fontStyle("medium", theme.type).fontFamily as string,
          fontWeight: "normal" as const,
        },
        bold: {
          fontFamily: fontStyle("semibold", theme.type).fontFamily as string,
          fontWeight: "normal" as const,
        },
        heavy: {
          fontFamily: fontStyle("bold", theme.type).fontFamily as string,
          fontWeight: "normal" as const,
        },
      },
      colors: {
        ...baseNavigation.colors,
        primary: tokens.staticAccent,
        background:
          typeof tokens.background === "string"
            ? tokens.background
            : baseNavigation.colors.background,
        card:
          typeof tokens.surface === "string"
            ? tokens.surface
            : baseNavigation.colors.card,
        text:
          typeof tokens.text === "string"
            ? tokens.text
            : baseNavigation.colors.text,
        border:
          typeof tokens.border === "string"
            ? tokens.border
            : baseNavigation.colors.border,
      },
    };
  }, [mode, theme.type, tokens]);

  return (
    <ThemeContext value={tokens}>
      <Host
        style={{ flex: 1, direction: isRtl ? "rtl" : "ltr" }}
        colorScheme={mode}
        seedColor={
          usesSystemAccent && Platform.OS === "android" && !palettes
            ? undefined
            : tokens.staticAccent
        }
      >
        <DirectionScope direction={isRtl ? "rtl" : "ltr"} style={{ flex: 1 }}>
          <NavigationThemeProvider value={navigationTheme}>
            {children}
          </NavigationThemeProvider>
        </DirectionScope>
      </Host>
    </ThemeContext>
  );
}

export function useQashyTheme() {
  // No `useColorScheme()` here: the provider already resolves the scheme and republishes the
  // tokens through this context, so a per-component subscription only added hundreds of
  // listeners that re-rendered consumers a second time.
  const theme = use(ThemeContext);
  if (!theme)
    throw new Error("useQashyTheme must be used inside QashyThemeProvider.");
  return theme;
}
