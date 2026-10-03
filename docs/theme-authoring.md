# Adding a built-in theme

This is for developers adding a theme that ships with the app. Users who want their own look should read [CUSTOM_THEME_GUIDE.md](../CUSTOM_THEME_GUIDE.md) instead: custom themes are JSON data, built-in themes are TypeScript.

Background and history: [theming-plan.md](theming-plan.md).

## The model

A theme is one `ThemeDefinition` (`src/theme/themes/types.ts`) in its own file under `src/theme/themes/`. The active theme is resolved by `getTheme(id, custom)` in `src/theme/themes/registry.ts`; an unknown id, or a theme not offered on the current platform, falls back to `classic`. Components never see the definition directly: they read the resolved result from `useQashyTheme()`.

| Field                                 | What it is                                                                                                                                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                                  | Stable, lowercase, hyphenated (`THEME_ID_PATTERN`). Stored per device as `AppSettings.themeId`. Never reuse an id for a different look.                                                                                                                                                          |
| `name`                                | Display name. Looked up through localization (see below).                                                                                                                                                                                                                                        |
| `palette`                             | `{ light, dark }`, each a complete `BaseTokens`: the 12 base colors plus the role colors `secondaryContainer`, `onSecondaryContainer`, `tertiaryContainer`, `onTertiaryContainer`, `headerBackground` and `navBackground` (`derivedRoleTokens` derives them from a palette). Both are mandatory. |
| `shadows`                             | `{ light, dark }`, each a `ShadowSet` of CSS `box-shadow` strings plus `scrim`. Both mandatory.                                                                                                                                                                                                  |
| `space`, `radius`, `tile`, `iconSize` | Scales with the same keys as the classic ones.                                                                                                                                                                                                                                                   |
| `motion`                              | Durations, springs, and press behaviour (`press: 'scale' \| 'translate' \| 'overlay'`, `pressScale`, `pressTranslate`).                                                                                                                                                                          |
| `material`                            | `{ engine: 'soft' \| 'bevel' \| 'flat', card: 'elevated' \| 'outlined' \| 'tonal', gradients, bevelDepth }`.                                                                                                                                                                                     |
| `type`                                | `text` and `numeric` font stacks (`family` plus `fallbacks`, both registry ids) and a `scale` of the 11 type variants.                                                                                                                                                                           |
| `icons`                               | `{ set, categorySet?, badge, badgeShape }`: icon set ids from `src/theme/icon-sets.ts` (UI icons and entity icons) and how a category icon sits in its badge.                                                                                                                                    |
| `charts`                              | Line width, cap, donut thickness, grid dash, `patterns`, `categoryPalette`, `tone`.                                                                                                                                                                                                              |
| `accent`                              | `mode` (`user`, `fixed`, `system`), `default`, `presets`.                                                                                                                                                                                                                                        |
| `availableOn`                         | Optional platform list. Omitted means everywhere.                                                                                                                                                                                                                                                |

## A minimal built-in theme

Spread `classicTheme` and override only what differs. Palettes must still be complete for both schemes.

```ts
// src/theme/themes/sepia.ts
import { classicTheme } from "@/theme/themes/classic";
import type { ThemeDefinition } from "@/theme/themes/types";
import type { BaseTokens } from "@/theme/tokens";

const light: BaseTokens = {
  ...classicTheme.palette.light,
  background: "#EFE6D2",
  surface: "#F8F1E0",
  surfaceElevated: "#FFF9EA",
  text: "#2B2112",
  textMuted: "#5C4A2E",
};

const dark: BaseTokens = {
  ...classicTheme.palette.dark,
  background: "#17120B",
  surface: "#221B11",
  surfaceElevated: "#2C2316",
  text: "#F3E8D2",
  textMuted: "#BCA98A",
};

export const sepiaTheme: ThemeDefinition = {
  ...classicTheme,
  id: "sepia",
  name: "Sepia",
  palette: { light, dark },
  accent: {
    mode: "user",
    default: "#B5651D",
    presets: ["#B5651D", "#7A4E2D", "#4C7A3A", "#3F6FD8"],
  },
};
```

If you change a palette but keep classic's `shadows`, the shadows are still neutral black/white based and will work. If you change the material engine, derive shadows (see "Bevel engine" below) rather than copying classic's.

## Registering

1. Add the theme to `BUILT_IN_THEMES` in `src/theme/themes/registry.ts`. Order is the order in the picker. `BUILT_IN_THEMES` also feeds the custom theme validator (`extends` accepts any built-in id and a custom theme may not reuse a built-in id), so a new built-in is automatically available to custom themes.
2. Add the display name and one-line description to the localization table in `src/localization/localization.tsx` (the "Theme selection" block). Theme names and descriptions are looked up by their English text, so add Hebrew entries for both: `Sepia: '...'` and `'Warm paper tones with brown ink.': '...'`. A missing entry just renders English.
3. Add the description to `THEME_DESCRIPTIONS` in `src/components/ui/theme-picker.tsx`, keyed by `theme.id`. The text must match the key you added in step 2. Do not use the words "light" or "dark" in it (it would read like the mode controls).
4. Run the conformance suite.

You do not touch the sync registry: theme choice is already `deviceLocal` (below).

## The conformance suite

`src/theme/__tests__/conformance.test.ts` runs over every theme in `BUILT_IN_THEMES`, so a new theme is checked the moment it is registered. It asserts, per scheme:

- the structural validator (`assertThemeDefinition`, `src/theme/themes/validate.ts`) passes and both schemes exist;
- `text` and `textMuted` reach 4.5:1 on the surfaces they sit on, and `positive`, `negative` and `warning` reach 3:1 on `surface`;
- the resolved accent carries readable on-accent text;
- scales are non-negative and touch targets are sane;
- every shipped locale (Latin and Hebrew) has a glyph source in the type stack;
- the press behaviour actually moves the control;
- a `bevel` theme has no blurred shadow in any material;
- icon-set gaps fall back to Ionicons;
- the theme source has no `Date.now`, `fetch(`, URLs or `require(`.

Run it with:

```bash
npx jest src/theme
```

These are floors. A theme may exceed them (`high-contrast` does). Fix the theme, not the test.

## Bevel engine helpers

`src/theme/shadow.ts` holds the pure helpers for hard-edged looks:

- `serializeShadow(layers)` turns `ShadowLayer[]` (`{ inset, x, y, blur, spread, color }`) into the CSS string that RN 0.86 `boxShadow` and react-native-web both accept. Prefer describing shadows as data.
- `bevelShadowSet(palette, scheme, depth)` derives a whole `ShadowSet` with 0 px blur from a palette: a light top-left edge, a dark bottom-right edge and a solid drop edge. Call it once per scheme and put the results in `shadows`, and set `material: { engine: 'bevel', gradients: false, bevelDepth: depth }`.
- `bevelAccentShadow(accent, depth)` is the matching hard-edged shadow for accent-filled controls; `accentTokens` in `src/theme/theme.tsx` uses it when the engine is `bevel`.
- `shadowBlurs(value)` returns each layer's blur radius; the conformance suite and the validator use it to prove a bevel theme has none.

The `bevelShadowSet` helper builds the bevel look. Pair bevel with `press: 'translate'` and zero radii for the pixel look. `high-contrast.ts` shows the other pattern: `outlineShadows(palette, scrim)` derives ring-style shadows from the palette.

## Flat engine and Material You

`material.engine: 'flat'` is the Material 3 look. `flatShadowSet(palette, scheme)` returns no shadow for cards, raised surfaces and pressed controls, a hairline ring (`ringShadow`) for controls and wells, and keeps a small shadow only for `shadowFab` and `shadowOverlay`. Flat themes have `gradients: false` and use `motion.press: 'overlay'` (a tonal fill, no scale or shift). `material.card` chooses how a card is separated from the page: `elevated` keeps the theme shadow, `outlined` draws an inset ring, `tonal` relies on the fill alone; `materialStyle` applies it to the card and raised materials.

Other capabilities read through `useQashyTheme()`:

- `radius.fab` rounds the floating add button and icon buttons.
- `icons.badge` (`tinted`, `filled` or `none`) and `icons.badgeShape` (`circle` or `squircle`) drive `IconBadge`, which every entity row and widget uses. A multicolor glyph (emoji, Fluent Emoji) keeps a tinted container under `filled`.
- `icons.set` draws UI chrome and `icons.categorySet` (default: `set`) draws category and account icons. `AppIcon` takes `role: 'ui' | 'category'`.
- `headerBackground` fills the native stack header and `navBackground` the tab bar.
- `type.scale` is the per-variant size, weight, spacing and line height; custom themes may override each value within bounds.
- `charts.tone.containerMix` controls how strongly an entity color is mixed into its tinted container.
- `accent.mode: 'system'` follows the wallpaper on Android and `accent.default` elsewhere, with no picker. Material You uses `'user'` instead: the wallpaper is the default `accentSource`, and the Appearance screen also offers curated and custom colors.

### Dynamic colors

`modules/qashy-dynamic-colors` is a local Expo module (Android 12+) that returns the system tonal palettes as hex. `src/theme/dynamic-palette.ts` is the pure resolver that derives the tokens; `useSystemPalettes` re-reads them when the app becomes active. Below Android 12, on iOS and web, and in Jest the module is absent and the theme uses `accent.default`. Changing the module needs a native rebuild (a development build, not Expo Go).

### Per-device overrides

`fontTextOverride`, `fontNumericOverride`, `uiIconSetOverride` and `categoryIconSetOverride` are nullable `deviceLocal` settings. `applyAppearanceOverrides` (`src/theme/overrides.ts`) layers them over the theme, ignores unknown ids, and keeps the Rubik Hebrew fallback for any chosen font. The picker lives in `src/features/more/appearance-overrides-card.tsx`.

## Adding a font

Fonts live in `FONT_REGISTRY` in `src/theme/fonts.ts`. A theme names a font by id; it never references a file.

Requirements:

- **Open license only (SIL OFL or equivalent).** Prefer an `@expo-google-fonts/*` package. Do not bundle fonts with an unclear license, and never reference a remote font.
- Provide all four weights (`regular`, `medium`, `semibold`, `bold`). If a family lacks one, point it at the nearest weight that exists (see how `space-grotesk` handles `regular`).
- Declare honestly which `scripts` the face covers (`latin`, `hebrew`).
- **Hebrew must be covered.** The app ships English and Hebrew. A face that lacks Hebrew must be used with `fallbacks: ['rubik']` (Rubik covers both), and the conformance test fails if a theme's text stack has no Hebrew glyph source. The custom theme builder adds the Rubik fallback automatically for any non-Rubik face; built-in themes must declare it.
- The `require()` goes in `fonts.ts` only (the theme source hygiene test forbids `require(` in theme files). The registered files are bundled and precached for offline use. Keep the precache budget in mind and update `workbox-config.cjs` only for static files; `runtimeCaching` stays empty.

Bundled so far: Rubik, Space Grotesk, Pixelify Sans, Figtree, Inter, Nunito and Atkinson Hyperlegible (regular and bold only). Add each license to `THIRD_PARTY_NOTICES.md`.

Adding a font id also makes it selectable as `type.text.family` / `type.numeric.family` in custom themes, so update the font table in `CUSTOM_THEME_GUIDE.md`.

## Adding an icon set

Icon sets in `src/theme/icon-sets.ts` decide how a stored icon id is drawn on this device. Stored ids (`ion:<glyph>`, `emoji:<char>`, legacy SF-style names) are replicated data and are theme-independent: a set only changes the drawing.

Built in: `ionicons`, `pixel`, `material` (Material Icons through the already bundled vector-icons font) and `fluent-emoji-flat` (an MIT-licensed SVG subset of Fluent Emoji Flat in `fluent-emoji-glyphs.ts`, generated by `scripts/generate-fluent-emoji.js`; see `THIRD_PARTY_NOTICES.md`).

1. Implement `IconSet`: `resolve(ionGlyph)` returns an `IconGlyph` (`ionicon`, `material`, an `svg` with a `viewBox` and paths, or a multicolor `color-svg`) or `null` when the set does not cover that glyph. Sets are keyed by Ionicons glyph name.
2. Register it in `ICON_SETS`. `ICON_SET_IDS` is derived from it, so custom themes can select it immediately; add it to the icon table in `CUSTOM_THEME_GUIDE.md`.
3. Never rely on coverage being complete. `resolveIconRender` falls back to Ionicons for any gap, and the conformance suite lists gaps and checks the fallback. `emoji:` ids always ignore the set.

## Shapes and scales come from the hook

`space`, `radius`, `tile`, `iconSize` and `motion` are per theme. A component must read them from `useQashyTheme()`:

```tsx
const { space, radius, colors } = useQashyTheme();
```

Importing them from `@/theme/tokens` outside `src/theme/` would silently use classic's values and ignore the active theme, so ESLint (`no-restricted-imports`, `THEME_SCALES` in `eslint.config.js`) fails the build. Inside module-level `StyleSheet.create`, which cannot see context, make the style a function of the scale (for example `containerStyle(space)`). `src/components/ui/motion.tsx` is the one documented exemption.

## Never hard-code colors

Use the semantic tokens from `useQashyTheme()`, never a hex string or a light/dark ternary. A hard-coded color works in one theme and is unreadable in another, and conformance only covers the palette, not stray literals. Chart and category colors come from the theme's `charts.categoryPalette`; stored entity colors are never rewritten, they are tinted at render time.

## Device-local, no network

- `themeId`, `themeMode`, `accentSource`, `accentHex` and the four font and icon-set overrides are `deviceLocal` in `src/sync/oplog/registry.ts`, so choosing a theme on one device never changes another. Do not add theme settings to a synced field group.
- Custom themes are not in `AppSettings` either. They live in a device-local `sync_meta` key (`SYNC_META.customThemes`) behind `src/data/custom-themes-store.ts`, written with `transact` so no sync op is captured.
- Themes are data and bundled assets. No remote fonts, images or textures, no fetching, no clock. The CSP and the "no network" rule stand, and the source hygiene test enforces the obvious cases.
- Both light and dark are required for every theme, built-in or custom.
