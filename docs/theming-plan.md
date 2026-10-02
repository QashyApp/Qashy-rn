# Plan: fully modular, themeable design language

Status: proposal. Nothing in this document is implemented yet.

## 1. Goal

Make the whole visual identity of Qashy a swappable, data-driven **theme**: palette, shape, spacing, material (shadows, bevels, borders), typography, motion, icons, chart styling and platform chrome. Adding a theme should mean writing one `ThemeDefinition` file, not editing screens.

Success test: a "Blocky" (Minecraft-style) theme and a "High contrast" theme ship without any feature screen knowing which theme is active. The current look becomes the `classic` theme and renders identically to today.

### Non-goals and constraints (from AGENTS.md)

- No remote theme store, no network fetch of theme assets. The CSP and the "no network" rule stand. Fonts and images are bundled or embedded.
- No theme data in the sync oplog beyond what is argued for in section 4.
- Reduced motion, reduced transparency, RTL, 44-48px touch targets and non-color-only chart meaning must hold in **every** theme, enforced by tests rather than by theme authors' good intentions.
- Do not use Mojang or Minecraft trademarks, textures or fonts. The theme is a blocky/voxel pixel style, named accordingly.

## 2. Current state (verified in the repo)

| Area | Today | Themeable? |
|---|---|---|
| Colors | `ThemeTokens` via `useQashyTheme()`, 80 consumers, near-zero hard-coded hex in features | Yes, but built only from the module globals `lightTokens`/`darkTokens` |
| Accent | `accentTokens(seed, dark)`, plus `systemTokens` for Android Material You | Yes, accent only |
| Materials | `materialStyle()` in `materials.ts`, 38 consumers; shadows are string constants in `theme.tsx` | Fixed "soft and tactile" recipe |
| Spacing / radius / motion / tile | Static constants in `tokens.ts`. `space.` in 67 files, `radius.` in 53, `motion.` in 4, `tile.` in 9 | **No**. Plus about 171 inline `gap/padding/margin: N` and 10 inline `borderRadius: N` |
| Typography | Rubik + Space Grotesk hard-coded in `FONT_ASSETS`; `withAppFont` tests the `Rubik_`/`SpaceGrotesk_` prefixes. Fonts are only referenced inside `src/theme/` | Well encapsulated, but not swappable |
| Icons | `app-icon.tsx` maps SF-style names to Ionicons, with a new in-progress `icon-catalog.ts` for category/account icons | Not swappable |
| Charts | `charts.tsx`, `CATEGORY_PALETTE`, `toneColors` | Palette fixed |
| Chrome | `+html.tsx` and `_layout.tsx` import `lightTokens`/`darkTokens` directly; `theme.tsx` writes CSS variables and `<meta theme-color>`; `Host` seed colour; navigation theme | Partly; direct imports bypass the provider |
| Persistence | `themeMode` (device-local in the sync registry), `accentSource` + `accentHex` (one `accent` field group, which **does** sync) | No theme id |
| Layout breakpoints | `layout.ts` | Intentionally **not** themed |

Correction to an earlier claim: `themeMode` is registered `deviceLocal`, so light/dark does not replicate. Only the accent group does.

## 3. Target architecture

### 3.1 `ThemeDefinition`

New directory `src/theme/themes/`, one file per theme, plus `registry.ts`.

```ts
interface ThemeDefinition {
  id: string;                       // 'classic' | 'material-you' | 'blocky' | ...
  name: string;                     // localized via localization.tsx keys
  schemes: ('light' | 'dark')[];    // single-scheme themes allowed; resolver maps forced mode
  palette: { light?: BaseTokens; dark?: BaseTokens };
  accent: {
    mode: 'user' | 'fixed' | 'system';   // user = presets/custom hex apply; fixed = theme owns it
    default: string;
    presets?: readonly string[];
    derive?: (seed, base, dark) => AccentFamily;   // default = today's accentTokens logic
  };
  shape: { radius: RadiusScale; borderWidth: number; cornerStyle: 'continuous' | 'circular' | 'square' };
  space: SpaceScale;                 // same keys as today; density = different values
  tile: TileScale;
  iconSize: IconSizeScale;
  material: MaterialRecipe;          // see 3.3
  type: TypeSpec;                    // see 3.4
  motion: MotionSpec;                // durations, springs, pressStyle
  icons?: IconSetId;                 // see 3.5
  charts: ChartSpec;                 // see 3.6
  categoryPalette: readonly string[];
  glass: 'allowed' | 'never';        // Liquid Glass only for themes that opt in
  chrome: ChromeSpec;                // status bar style, theme-color overrides, CSS vars
  backdrop?: BackdropSpec;           // optional tiled pattern or texture behind screens
}
```

Rules:
- Everything is **optional-with-inheritance** from `classic` through `defineTheme({ extends: 'classic', ...overrides })`, so a minimal theme is a palette and nothing else.
- The resolved result is a single `ResolvedTheme` object (superset of today's `ThemeTokens`), built in one pure function `resolveTheme(definition, { mode, accentSource, accentHex, platform })`. Pure and unit-testable.
- `useQashyTheme()` keeps its name and existing fields, so the 80 consumers keep compiling. New fields are added: `theme.space`, `theme.radius`, `theme.motion`, `theme.tile`, `theme.type`, `theme.id`.

### 3.2 Scales move into context

`space`, `radius`, `tile`, `iconSize`, `motion` stop being importable constants. They become `useQashyTheme().space.md` etc.

Problem: many files likely use them inside module-level `StyleSheet.create`, which cannot see context. Mitigation: a `useThemedStyles((theme) => StyleSheet.create({...}))` hook that memoizes per theme. A codemod does the mechanical rewrite and a lint rule bans the old imports afterwards.

### 3.3 Material recipes

Replace the hard-coded shadow strings and `materialStyle()` switch with a declarative recipe per material (`card`, `raised`, `sunken`, `control`, `controlPressed`, `accent`, `accentPressed`):

```ts
interface MaterialSpec {
  fill: 'surface' | 'surfaceElevated' | 'surfaceMuted' | 'surfaceSunken' | 'accent';
  gradient?: GradientSpec;                 // optional, ignored where unsupported
  border?: { width: number; color: ColorRole; sides?: ('top'|'bottom'|'left'|'right')[] };
  shadow: ShadowLayer[];                   // inset/outer, offset, blur, spread, color role + alpha
  pressed?: { transform?: 'scale' | 'translate'; amount: number; swapTo?: MaterialName };
}
```

- Two built-in engines cover most looks: **soft** (today's layered blur shadows) and **bevel** (hard 0-blur inset highlights and shadows, optional pixel border). An `escapeHatch: (theme) => ViewStyle` per material allows anything else.
- Shadow layers are serialised to the CSS `boxShadow` string the app already uses, so RN 0.86 and RNW both keep working.
- `GlassSurface` consults `theme.glass` and the existing reduced-transparency path first.

### 3.4 Typography

- A font registry: `FontFamilySpec { id, weights: {regular..bold: asset}, scripts: ['latin'|'hebrew'], fallback }`.
- `typeScale` becomes per-theme, deep-merged over classic. A theme can change size, letter-spacing, weight and a `textTransform`.
- `withAppFont` stops testing for `Rubik_`/`SpaceGrotesk_` and instead asks the registry "is this family one of ours". The `numeric` face is a per-theme slot, which may equal the text face.
- **Hebrew coverage is a hard requirement.** Pixel fonts generally lack Hebrew. A theme must declare a per-script fallback (e.g. pixel face for Latin and digits, Rubik for Hebrew), and a test fails if a theme has no glyph source for a shipped locale.
- Fonts load lazily per theme on native and are precached per theme on web, with a size budget (section 6).

### 3.5 Icons

- Introduce an `IconSet` interface behind `AppIcon`: `resolve(name | iconId) -> { kind: 'vector' | 'image'; ... }`.
- `ionicons` stays the default set. A theme may supply a pixel-art set as bundled sprite or SVG assets.
- Missing glyph in a theme's set falls back to Ionicons rather than rendering nothing, and a test lists the gap.
- The stored `icon` id on accounts and categories stays theme-independent (it is replicated data); only rendering changes.

### 3.6 Charts and category colors

- `ChartSpec`: series palette, stroke width, bar corner style (rounded vs square), gap, fill pattern for color-independent meaning, axis and gridline style.
- Category and account `color` is **stored per entity and synced**, so a theme cannot rewrite it. Instead `toneColors` takes the theme and adjusts tint/contrast at render time, and the theme's `categoryPalette` only changes the *suggested* colors for new entities.

### 3.7 Platform chrome

- `+html.tsx`, `_layout.tsx` and `finance-provider.tsx` stop importing `lightTokens`/`darkTokens`. The static HTML shell keeps the `classic` colors (it renders before React), and `QashyThemeProvider` already rewrites `theme-color`, the CSS variables and `color-scheme` after hydration. That path is extended to cover every theme.
- Known limit: `manifest.json` `theme_color` and `background_color` are static per install. Document it. The in-page `<meta theme-color>` does follow the theme.
- Native: `Host` colorScheme and `seedColor`, the navigation theme and the status bar style all come from `ResolvedTheme`.
- Android Material You becomes a real theme (`material-you`, `accent.mode: 'system'`) instead of a special case inside `theme.tsx`. iOS and web fall back to classic's indigo exactly as today.

## 4. Persistence and sync

- Add `themeId: string` to `AppSettings` (default `'classic'`).
- Register it in `src/sync/oplog/registry.ts` as **`deviceLocal`**, like `themeMode`. A phone and a desktop may reasonably want different looks, and a peer on an older build could not render an unknown id.
- Decision needed: the existing `accent` field group still syncs. Options: (a) leave it, (b) make accent per-theme and device-local. Recommendation: (a) for now, and themes with `accent.mode: 'fixed'` simply ignore it.
- Unknown or removed `themeId` resolves to `classic` at read time, never throws. Because `registry.ts` is the sync merge registry, this must land in the same change as the model field (AGENTS.md rule).
- Update, together: `domain/models.ts`, `domain/defaults.ts`, `data/repository.ts` (`SettingsInput`), the validation in `local-finance-repository.ts` (settings update around lines 413-468 and the import validation around line 3612), and the repository contract tests. Confirm during Phase 2 whether settings are stored as an opaque record (then no storage migration) or need a migration on either adapter.
- Custom user themes (Phase 11) are stored **device-locally** and never in `AppSettings`, because that replicates. Candidate home: `sync_meta` or a dedicated local-only store, decided in that phase. They must not touch the keystore, logs or the service-worker cache.

## 5. Phases

Each phase ends green on `npm run typecheck`, `lint`, `test`, and `build:web`. Phases 1-3 must produce zero visual change in `classic`.

### Phase 0: Guardrails (0.5 day)
- Capture baseline Playwright screenshots of key screens in classic light and dark (Overview, Transactions, Plan, More, a form sheet, Appearance).
- Turn the dev kitchen-sink screen into a **theme gallery**: every shared control, material, type variant and chart in one place, switchable by theme.
- Add an ESLint rule (or `no-restricted-imports`) so that, after Phase 3, importing `space/radius/motion/tile/iconSize/typeScale` from `@/theme/tokens` outside `src/theme/` fails the build.

### Phase 1: Definition and resolver (1-2 days)
- Add `ThemeDefinition`, `defineTheme`, `resolveTheme`, the registry, and `classic` expressed as a definition.
- Rebuild `QashyThemeProvider` on `resolveTheme`; make `accentTokens(seed, dark)` take a `BaseTokens` argument instead of reading globals.
- Move `lightShadows`/`darkShadows` out of `theme.tsx` into classic's material recipe.
- **Acceptance:** a golden test asserts `resolveTheme(classic, ...)` deep-equals today's `accentTokens`/`systemTokens` output for light/dark x system/preset/custom accents. `tokens.test.ts`, `materials.test.ts` and `accent-preview.test.ts` pass unchanged.

### Phase 2: Persistence and selection plumbing (1 day)
- `themeId` through model, defaults, repository, validation, registry (`deviceLocal`), import/export, onboarding draft, Appearance state.
- Unknown-id fallback and tests for it; contract tests for the new setting.
- **Acceptance:** settings round-trip on SQLite and Dexie; sync merge test shows `themeId` is not replicated.

### Phase 3: Scales into context (2-3 days, mostly mechanical)
- Add `theme.space/radius/tile/iconSize/motion` and `useThemedStyles`.
- Codemod the ~120 consuming files; hand-fix module-level `StyleSheet.create` cases. Tackle the ~171 inline `gap/padding/margin: N` and 10 inline `borderRadius: N` by mapping to scale steps where they match, and listing outliers for a decision.
- Turn the lint rule from Phase 0 on.
- **Acceptance:** screenshot diff against the Phase 0 baseline is empty for classic.

### Phase 4: Material engine (2 days)
- Implement recipe types, soft and bevel engines, and the `boxShadow` serializer.
- `materialStyle()` reads `theme.material`; the pressed behavior (scale vs translate) moves into `motion.tsx` and the pressables that use `pressScale` today.
- Replace the remaining direct uses of `theme.shadow*` with materials, and keep `shadowOverlay`/`scrim` as theme fields.
- **Acceptance:** classic output unchanged; a new test renders every material in a bevel theme and asserts no blur radius > 0.

### Phase 5: Typography registry (2 days)
- Font specs, per-theme `typeScale`, generalized `withAppFont`, lazy loading, web precache changes in `workbox-config.cjs` (static files only, `runtimeCaching` stays empty).
- Script-fallback mechanism and the Hebrew-coverage test.
- **Acceptance:** typography tests pass; switching theme swaps faces with no flash of the wrong face on web.

### Phase 6: Icon sets (1-2 days)
- `IconSet` interface, Ionicons set as default, theme-aware `AppIcon` and `IconPickerField`.
- Coordinate with the in-progress `icon-catalog.ts` work (it is uncommitted); land that first.

### Phase 7: Charts and category tone (1-2 days)
- `ChartSpec` consumed by `charts.tsx` and `sparkline.tsx`; render-time `toneColors` adjustment; pattern fills.
- **Acceptance:** a chart test checks that adjacent series differ by more than color (pattern, label or position).

### Phase 8: Chrome and platform (1 day)
- Remove direct token imports from `_layout.tsx`, `+html.tsx`, `finance-provider.tsx` (the HTML shell keeps classic constants intentionally and documents why).
- Theme-driven status bar, navigation theme, `Host`, web CSS variables, `theme-color`.
- Extract `material-you` into a definition; keep the Android-only gate.

### Phase 9: Appearance UX (1-2 days)
- Theme picker on the Appearance screen with a live preview card (reuse the Phase 0 gallery pieces), and the same step in onboarding's look step.
- Themes that are single-scheme or have a fixed accent hide or disable the irrelevant controls with an explanation.
- Add localization keys (English and Hebrew) for names and descriptions.

### Phase 10: First themes (2-4 days)
1. `classic` (baseline) and `material-you` (from Phases 1 and 8).
2. `high-contrast`: proves the system for accessibility, with 7:1 text, thick borders, no gradients and no glass.
3. `blocky` (the stress test): earthy dirt/stone/grass/oak palettes in light and dark, zero radius, 2-3px hard bevels, no blur, a pixel font for Latin and digits with Rubik for Hebrew, pixel icon set, square-bar charts with patterns, "press = shift down 2px" instead of scale, optional tiled backdrop, no glass.
4. Optionally one or two more (e.g. terminal green-on-black, paper/ink) to confirm the abstraction is not accidentally shaped around just two themes.

### Phase 11: User-authored themes (2-3 days, after the rest is stable)
- A versioned JSON schema (`themeSchemaVersion`) covering palette, accent, shape, material parameters and chart palette. No code, no remote URLs, no font or image fetch; bundled assets only, optionally small embedded data URIs with a size cap.
- Validation fails closed: the whole theme is rejected if any field is invalid. Contrast is **enforced** (text vs surface, onAccent vs accent) by clamping through the existing `ensureContrast`.
- Import and export as a file. Storage is device-local. A broken custom theme falls back to classic.

### Phase 12: Docs and hardening (1 day)
- README (features, architecture, privacy note that themes are local) and AGENTS.md (theme authoring rules, the lint restriction, "no hard-coded colors or scales in features").
- A `docs/theme-authoring.md` with a minimal example.

## 6. Test strategy

- **Conformance suite** that runs over every registered theme and fails CI for a bad theme:
  - every token defined for each supported scheme;
  - contrast: text/surface and textMuted/surface at least 4.5:1, onAccent/accent at least 4.5:1, status colors on surface at least 3:1;
  - touch-target sizes (tile, controls) at least 44px;
  - every shipped locale has a glyph source for the type spec;
  - no `Date.now`/network in theme code;
  - icon-set gaps are listed and fall back.
- Golden test: classic resolves identically before and after the refactor.
- Repository contract tests for `themeId`; sync test that it is device-local.
- Playwright: for each theme, smoke the four sections, forms, reduced-motion and reduced-transparency, an RTL (Hebrew) pass, and screenshots.
- PWA: assert precache size stays under a budget (set after measuring; fonts and sprites are the risk) and offline reload works for a non-default theme.
- Native: `npx expo export -p ios` and `-p android` after Phases 3, 5 and 6.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Phase 3 codemod touches ~120 files and conflicts with the large uncommitted worktree | Land or stash the current icon work first; do Phase 3 in its own PR with a zero-diff screenshot gate |
| Module-level `StyleSheet.create` cannot read context | `useThemedStyles`; discovery grep at the start of Phase 3 to size it |
| Bundle and offline size from extra fonts and icon sets | Lazy load on native; per-theme precache and an explicit budget on web |
| Hebrew and RTL regressions with display fonts | Mandatory per-script fallback and the conformance test |
| A bad theme making money unreadable | Enforced contrast and clamping, never trusting the theme author |
| Stored category colors clashing with a theme | Render-time tone adjustment, never mutate stored data |
| Android Material You opaque platform colors cannot be hex-mixed | Keep `staticSurface`/`staticText` and the "no hex math on platform colors" rule inside `material-you` only |
| Theme choice leaking into sync | `deviceLocal` registry entry plus test |
| Scope creep into custom themes and a theme store | Phase 11 is separate and local-only; a store would violate product scope |

## 8. Decisions needed

1. Should `accentSource`/`accentHex` stay synced across devices, or become per-device with `themeId`?
2. Are single-scheme themes allowed (Blocky might be dark-only), and what should "System" mean for them?
3. Pixel font choice: check the licence (OFL fonts such as Silkscreen or Press Start 2P are bundleable) and confirm Latin-plus-digits-only is acceptable with a Rubik fallback for Hebrew.
4. Is Phase 11 (user-authored themes) wanted at all, or are built-in themes enough?
5. Landing order: should the uncommitted icon-catalog work merge before Phase 3?

## 9. Effort and slicing

Rough total: **3-4 weeks** for Phases 0-10 by one developer, about 1 more week for Phases 11-12. Suggested PR slices: (1) Phases 0-2, (2) Phase 3 alone, (3) Phases 4-5, (4) Phases 6-8, (5) Phase 9-10, (6) Phase 11-12.
