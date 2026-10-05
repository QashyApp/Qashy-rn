> **Superseded in part:** the `react-native-screens` patch this plan proposes was replaced by the local `modules/qashy-tab-gestures` module (see "No patched libraries" in the README); Qashy no longer patches any library.

# Plan: Cashew-style Material You, Android nav-bar customization, month pagers

Status: proposal, not started. Three independent workstreams (A, B, C) that can be handed to separate owners.
Before touching Expo APIs, read the SDK 57 docs (<https://docs.expo.dev/versions/v57.0.0/>), and follow `AGENTS.md`.
The worktree has unrelated in-progress changes (exchange rates, sync, localization). Preserve them.

---

## A. Material You theme → a Cashew-like UI language

### A.0 Feasibility verdict

**Feasible, but it can't be done by changing tokens alone.** It's a medium-to-large change, roughly 2–3 weeks for one engineer.

Today `materialYouTheme` (`src/theme/themes/material-you.ts`) is `classicTheme` with `accent.mode: "system"`. The theme system (`ThemeDefinition` in `src/theme/themes/types.ts`) can already swap colors, spacing, radius, type, icons, motion, materials and charts per theme. That covers about 40% of the Cashew look: rounded tonal surfaces, the dynamic palette, a friendlier font and colorful category icons.

The other 60% is **composition**. In Cashew, components are shaped and arranged differently, beyond being painted differently:

| Cashew trait (from the screenshots)                                                                                                                  | Qashy today                        | Needed                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------- |
| Large greeting header ("Good evening / Ziv") and tinted collapsing app bar with a big title                                                          | Native stack header, `PageHeading` | Header variant                                    |
| Accounts as horizontally scrolling selectable tiles with an "add account" ghost tile                                                                 | `accounts-widget.tsx` list         | Widget variant                                    |
| Budget card with a tinted/gradient header band, a "Today" marker on the progress bar and "spend X/day for N days"                                    | `budget-pulse-widget.tsx`          | Widget variant + one new derived figure           |
| Category icon as a colorful illustration inside a filled color circle, plus a secondary "type" badge (recurring/transfer) and `×13` installment chip | `transaction-row.tsx`              | Row variant                                       |
| Transactions: scrollable **month tab strip** with an underline indicator, and a pill summary `▾₪0  ▴₪1,462  = ₪1,462`                                | `MonthSwitcher` + summary tiles    | Month-nav variant + summary variant               |
| Collapsible "Future transactions" section                                                                                                            | Not present as a section           | New list section (pure grouping util)             |
| "More" as a grid of outlined tiles (full-width rows plus a two-column grid)                                                                          | `more-screen.tsx` list rows        | Screen variant                                    |
| Rounded-square tonal FAB                                                                                                                             | Circular FAB                       | FAB shape variant (`radius` may already cover it) |
| M3 nav bar with a pill indicator                                                                                                                     | Already native (`indicatorColor`)  | None                                              |

So the work is: **add a component-variant layer to `ThemeDefinition`**, implement the Cashew variants, and point Material You at them. Classic and High Contrast stay identical (all defaults are the current look).

### A.1 Hard constraints (non-negotiable)

1. **License / branding.** Cashew is GPL-3.0. Reimplement the visual language from observation only. Don't copy its source, assets, icon pack, strings or name. The theme keeps the name "Material You".
2. **Fonts.** Cashew uses Avenir, which is proprietary, so it can't be bundled. Pick an open-license geometric/humanist face with a similar feel (candidates: _Nunito Sans_, _Figtree_, _Mulish_), bundle it through `src/theme/fonts.ts`, and use Rubik as the Hebrew fallback. No remote fonts.
3. **Icons.** Cashew's colorful category art is its own. To get the same "illustration in a circle" feel, add a bundled icon set in `src/theme/icon-sets.ts` mapped from existing theme-independent ids. Use an open set, e.g. Microsoft Fluent Emoji _Flat_ (MIT) or Noto Emoji (Apache-2.0), SVG and subset to the mapped ids only. Unmapped ids fall back to Ionicons. Stored icon ids never change.
4. **Theme rules from AGENTS.md still apply.** Both schemes are required. Read everything through `useQashyTheme()`. No hard-coded colors or scale values in features. Theme fields stay `deviceLocal`. Keep reduced-motion, reduced-transparency and contrast clamping. Touch targets stay 44–48px.
5. **Platform.** Material You stays `availableOn: ["android"]`. Because the variants live on `ThemeDefinition`, a later "Cashew-like" theme for iOS/web with a seed accent is a small follow-up, not a rewrite.

### A.2 Architecture

**A.2.1 `ThemeDefinition.variants` (new, scheme-independent)**

```ts
// src/theme/themes/types.ts
export interface VariantSpec {
  header: "native" | "expressive"; // expressive = greeting / large tinted title band
  monthNav: "switcher" | "tabStrip";
  flowSummary: "tiles" | "pill";
  transactionRow: "standard" | "avatar"; // avatar = filled circle + illustration + type badge
  accountsWidget: "list" | "tiles";
  budgetCard: "standard" | "banded";
  moreScreen: "list" | "tileGrid";
  fab: "circle" | "squircle";
}
```

- Every built-in theme gets defaults equal to today's look. `assertThemeDefinition` / `validate.ts` checks the enums.
- Components branch on `theme.variants.x` **inside** the shared component (`src/components/ui`, `src/components/finance`, the overview widgets). Feature screens don't branch on theme ids. The existing `theme.id === "high-contrast"` check in `theme.tsx` is the only allowed exception, and it shouldn't spread.
- **Custom themes:** don't expose `variants` in the custom-theme JSON schema in v1. Custom themes inherit Classic variants. This keeps `CUSTOM_THEME_GUIDE.md` and its tests unchanged. Exposing them later means updating `src/theme/custom/schema.ts`, the guide and `guide.test.ts` together. _(Open decision D2.)_

**A.2.2 A fuller dynamic palette**

`systemTokens()` in `src/theme/theme.tsx` maps a handful of `Color.android.dynamic.*` roles to tokens. Two limits:

- The Cashew look uses **secondary/tertiary containers** (account tiles, badges, the budget band). Add semantic tokens such as `secondaryContainer`, `onSecondaryContainer`, `tertiaryContainer` and `onTertiaryContainer` to `BaseTokens` for every theme. Non-system themes derive them from their palette.
- `Color.android.dynamic.*` are opaque `PlatformColor`s with no hex available in JS. So gradients, alpha mixes, category container tints and contrast clamping can't be computed from them. That's why the current theme falls back for gradients.
  **Recommended:** add a small local Expo module (`modules/qashy-dynamic-colors`, Android 12+) that reads the system tonal palettes (`system_accent1/2/3_*`, `system_neutral1/2_*`) and returns hex strings. The resolver then derives the full token set in JS, like any seed theme, so mixes, gradients and contrast clamps all work. Re-read on `AppState` "active" so a wallpaper change is picked up. Fall back to the theme's default seed below Android 12 or on web. This requires a dev-client/EAS build (already the workflow).
  Without the module, v1 can ship with flat tonal bands instead of gradients.

**A.2.3 New pure logic (domain, not screens)**

- "You can spend X/day for N more days": a pure helper in the budget utils (minor units, integer math, uses the period's remaining days). Unit-tested, including the last day, overspent and zero-remaining cases.
- "Future transactions" grouping: a pure partition of the month's list into future vs. past by `todayLocal()`, collapsible in the UI. Collapse state stays in local component state (not persisted, not in AppSettings).
- `×N` installment chip: derive from the existing recurring/occurrence data if a count exists. If not, leave it out of scope. Don't invent a field without a model, registry and migration change.

### A.3 Phases

| #   | Work                                                                                                                                                                           | Main files                                                                                   | Done when                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| A1  | `VariantSpec` type, defaults for all built-ins, validation, tests                                                                                                              | `themes/types.ts`, `classic.ts`, `high-contrast.ts`, `validate.ts`, `theme.tsx`, theme tests | Typecheck passes; Classic/High Contrast snapshots unchanged                                           |
| A2  | New container tokens in `BaseTokens` for all themes + custom-theme derivation                                                                                                  | `tokens.ts`, `themes/*`, `custom/schema.ts` (derive, not expose)                             | Contrast tests pass for every theme × scheme                                                          |
| A3  | (Recommended) `qashy-dynamic-colors` Android module + resolver path                                                                                                            | `modules/…`, `theme.tsx`                                                                     | Material You derives hex tokens on device; falls back cleanly below Android 12                        |
| A4  | Font + icon set registered and bundled (subset)                                                                                                                                | `fonts.ts`, `icon-sets.ts`, assets                                                           | Hebrew renders through Rubik; bundle growth measured and reported                                     |
| A5  | Variants, one PR each: FAB → transaction row → flow summary pill → month tab strip → accounts tiles → banded budget card → expressive header → More tile grid → Future section | the components listed in A.0                                                                 | Each variant has light/dark screenshots, a11y labels and selected states, and reduced-motion behavior |
| A6  | Point `materialYouTheme` at the Cashew variants, font, icon set and radius/space tweaks                                                                                        | `material-you.ts`, `theme-picker.tsx` description                                            | Side-by-side QA against the reference screenshots                                                     |
| A7  | Docs                                                                                                                                                                           | `docs/theme-authoring.md`, `README.md`                                                       | Variants are documented for future theme authors                                                      |

**Risks:** variant branches slowly turning into a second app (keep the variant count small and reviewed); illustration icons + font increasing bundle size; RTL mirroring of the tab strip and the accounts carousel; the month tab strip has to work together with workstream C's pager (C owns the gesture, the tab strip only reflects and drives `month`).

---

## B. Android nav bar: long-press → bottom sheet → native vs. floating

### B.0 Feasibility verdict

**Feasible, with one real obstacle.** Android uses `NativeTabs` (`src/app/(tabs)/_layout.tsx`, expo-router `unstable-native-tabs` → react-native-screens → Material `BottomNavigationView`). That bar is drawn natively, outside the React tree. It exposes `onTabSelected` but **no long-press event**. Android's own long-press there shows a tooltip. No JS gesture can be layered over it.

The floating bar has to be a JS-rendered tab bar anyway, since native tabs can't float. So "floating" mode means a JS tab host, and long-press there is easy. The question is only how long-press works while in **native** mode:

- **Option 1 (recommended): hybrid + small native patch.** Keep `NativeTabs` for native mode. Add a `patch-package` patch (or upstream PR) to react-native-screens' Android tabs that calls `setOnLongClickListener` on each menu item view, suppresses the tooltip, and emits an `onTabLongPress` event that expo-router passes through (`NativeTabsHostNativeProps`). It's fragile across SDK upgrades, so add a test on the patch and a note in the upgrade checklist.
- **Option 2: JS-only tabs on Android.** Use expo-router's JS `Tabs` (`@react-navigation/bottom-tabs`) with one custom `tabBar` that renders either a docked M3-faithful bar or the floating bar. Long-press works the same in both modes. The cost: "native" becomes a faithful imitation, not the platform view (ripple, predictive back and system font scaling have to be matched by hand).
- **Fallback in either case:** a "Navigation bar style" row in Appearance (or Gestures) opens the same sheet, so the setting is always reachable and discoverable.

_(Open decision D1: Option 1 vs. 2.)_

### B.1 Design

- **Setting:** `navBarStyle: "native" | "floating"` on `AppSettings`, registered as `{ kind: "deviceLocal" }` in `src/sync/oplog/registry.ts`. This follows the existing `swipeBetweenMonths` / `themeMode` pattern, so it never replicates as a real preference. Default `"native"`. Update the model, defaults, both storage paths/migrations if the settings shape is versioned, contract tests and registry tests together. Ignored on iOS and web.
- **Layout switch:** `src/app/(tabs)/_layout.tsx` (or a new `_layout.android.tsx` if the split gets large) renders `NativeTabs` or the JS `Tabs` + `FloatingTabBar` based on the setting. Switching navigators remounts the tab stacks. On switch, re-navigate to the current section path (`/overview`, `/transactions`, …) so the user stays put. Losing deeper stack state on a style change is acceptable; note it in the release notes.
- **Floating bar (`src/components/navigation/floating-tab-bar.tsx`):** inset pill with `radius`/`space`/`shadowFab`/materials from `useQashyTheme()`, an animated pill indicator on the selected item, icons from the same `md` names, labels visible, 48px targets, `accessibilityRole="tab"` and `accessibilityState.selected`. It hides on scroll through the existing `use-scroll-hide.ts` (matching `minimizeBehavior="onScrollDown"`). The opaque fallback for reduced transparency is required.
- **Long-press:** `Gesture.LongPress` (or `Pressable.onLongPress`, ~400ms) on the bar → `hapticImpactLight()` → open the sheet. In native mode, it's triggered by `onTabLongPress` (Option 1).
- **Sheet:** `@expo/ui` Jetpack Compose `ModalBottomSheet` inside the shared `Host` (AGENTS: native controls stay in `Host`; check the SDK 57 component name and API). It contains two large preview cards ("Native" / "Floating") rendered as mini mock bars, a radio-style selection, and a short caption. The selection applies immediately and the sheet animates closed. Swipe-down and back dismiss it. Use the localized strings in `src/localization/localization.tsx` (all shipped locales, RTL-safe).
- **Insets:** today, bottom spacing assumes a docked bar (`metrics.hasBottomNavigation`, `ScreenContainer` padding, FAB at `92 + insets.bottom`, `batchBarBottom` in transactions). Add one source of truth, e.g. `useBottomChromeInset()` in `src/theme/layout.ts` or `src/components/navigation`, that returns the right offset for native vs. floating, and replace the hard-coded `92`s. The FAB must sit above the floating bar, not behind it.

### B.2 Tests / done when

- Unit: settings default, deviceLocal registry entry (it must not appear in outgoing ops), inset hook values per mode.
- Manual Android QA: long-press in both modes, switching preserves the current section, FAB/batch-bar/undo-bar placement in both modes, gesture-nav vs. 3-button nav insets, TalkBack announces tabs and the sheet, reduced transparency, RTL (Hebrew), dark/light, Material You and Classic.
- iOS and web unchanged (verify `npx expo export -p ios`, `npm run build:web`, `npm run test:web`).

Estimate: ~3–5 days (Option 1 adds ~1–2 days for the native patch).

---

## C. Month swipes that reveal the neighbouring month

### C.0 Feasibility verdict

**Feasible, moderate effort (~4–6 days).** `useMonthSwipe` (`src/components/ui/use-month-swipe.ts`) + `MonthSwipeView` translate _the whole wrapped view_ with resistance (`FOLLOW = 0.45`). On release they change `month` and nudge the new content in from 44px. No neighbouring month is ever rendered. Both screens wrap everything: `transactions-screen.tsx:351` wraps the pinned toolbar _and_ the list, and `overview-screen.tsx:329` wraps the whole scroll view.

The target is a real **pager**: previous / current / next month laid side by side. The drag tracks the finger 1:1, so the month you're swiping toward slides in from that side, and release either commits or springs back.

### C.1 Shared component: `MonthPager`

`src/components/ui/month-pager.tsx` + `use-month-pager.ts`, replacing `MonthSwipeView`/`useMonthSwipe` once both screens migrate:

```tsx
<MonthPager
  month={month}
  max={maxMonth}                 // newest allowed month, optional
  disabled={selectionMode || allMonths || editing}
  onChange={(next, direction) => …}
  renderPage={(pageMonth, { isCurrent }) => <… month={pageMonth} />}
/>
```

- **Layout:** a clipped container of width `W`. Three absolutely positioned pages at `-W`, `0`, `+W` (mirrored for RTL with `isRtl`), and a shared `translateX` driven by Gesture Handler `Pan` + Reanimated.
- **Gesture:** keep the current tuning (`activeOffsetX ±24`, `failOffsetY ±14`) so vertical scrolling wins. Commit if `|dx| > W * 0.25` or `|vx| > 600`, then animate to `±W` with `motion.spring.snappy` from the theme. Otherwise spring back to 0.
- **Commit without flicker:** at the end of the animation, `runOnJS(onChange)`. The parent updates `month`, the pages re-key (`prev/current/next` shift by one), and translate is reset to 0 in a `useLayoutEffect` keyed on `month`, so the swap and the reset land in the same frame.
- **Bounds:** past `max` there is no next page. Rubber-band at the current `BLOCKED_FOLLOW` resistance and never commit.
- **Edge conflicts:** ignore pans that start within ~24dp of the left/right screen edge so Android's back gesture keeps working. Inner horizontal scrollers (filter chips, account tiles, the month tab strip from A) should block the pager through `blocksExternalGesture` / `simultaneousWithExternalGesture`. Pass the inner gesture refs in.
- **Programmatic changes:** tapping `MonthSwitcher` or the tab strip should call `pager.goTo(direction)`, which runs the same slide, so tap and swipe look the same.
- **Reduced motion:** no slide. Commit on threshold with a short crossfade (`ReduceMotion.System`).
- **Web:** keep it disabled on web, as now (the mouse drag would fight text selection). `renderPage` still renders only the current month there.
- **Setting:** still gated by device-local `settings.swipeBetweenMonths`. Haptic selection on commit, as now.
- **Pure helper + tests:** extract the decision logic (`resolveSwipe(dx, vx, width, canForward, isRtl) → -1 | 0 | 1`) into a pure function and unit-test thresholds, RTL, blocked-forward and velocity flicks.

### C.2 Performance

The neighbour pages are real content, so they cost renders:

- Mount neighbours **lazily**: the current page renders immediately; the neighbours mount after interactions settle (`InteractionManager.runAfterInteractions`) or on the first `onBegin` of the pan, whichever comes first.
- Neighbour pages render with `scrollEnabled={false}` and a small `initialNumToRender` (they're only ever seen at their top).
- Memoize per-month projections (sections, summaries, `useDashboard(month)`) so a swipe doesn't recompute all three months on every frame. The drag is UI-thread only, so no JS renders happen mid-gesture.
- Measure on a low-end Android device. If the Overview neighbours are too heavy, fall back to a lighter neighbour render (header + first widgets only) that switches to full content on commit.

### C.3 Transactions: only the list slides

- Refactor `transactions-screen.tsx` (897 lines): extract the `SectionList` and everything per-month below the pinned toolbar into `src/features/transactions/list/transaction-month-list.tsx` (`{ month, kind, search, selection… }`). Move the sections derivation into a pure util in `list/` so it can run for any month.
- The screen becomes: the **pinned toolbar outside the pager** (heading, `MonthSwitcher` or the A tab strip, search, filter chips), then `<MonthPager renderPage={m => <TransactionMonthList month={m} …/>} />`.
- The income/spent/net summary in the toolbar keeps its current `MotionView` direction animation on commit. Optionally, interpolate it with the drag progress later.
- Disabled while in selection mode or the all-months search, as now. Scroll position: the new month opens at the top. The `onScroll` used for FAB/scroll-hide attaches to the current page only.

### C.4 Overview: the whole window slides

- Extract the month-dependent body of `overview-screen.tsx` into `OverviewMonthPage({ month })`. Each page owns its own `ScrollView`. Wrap the screen in `MonthPager`, disabled in edit mode.
- Non-month chrome that must not slide (the FAB, any floating bar from B) stays outside the pager.

### C.5 Done when

- Unit tests for `resolveSwipe` and the sections util. Existing tests and `e2e/qashy.spec.ts` stay green (web path unchanged).
- Manual Android + iOS QA: both directions, LTR + RTL, fast flick vs. slow drag, cancel mid-drag, the boundary at `max`, vertical scroll not hijacked, chip row/account tiles still scroll horizontally, Android edge back gesture still works, reduced motion, selection mode blocks the swipe, switcher tap animates the same way, no blank frame on commit.

---

## Open decisions for the product owner

- **D1 (B):** long-press in native mode: patch react-native-screens (Option 1, keeps the true native bar) or use JS tabs everywhere on Android (Option 2, simpler, imitation "native").
- **D2 (A):** expose `variants` to user-authored custom themes now, or keep them built-in-only in v1 (recommended).
- **D3 (A):** build the dynamic-color native module (full gradients/tints) or ship v1 with flat tonal bands.
- **D4 (A):** font choice (Nunito Sans / Figtree / Mulish) and icon source (Fluent Emoji Flat vs. Noto).
- **D5 (A):** whether a Cashew-like seed-accent theme should also be offered on iOS/web later.

## Suggested sequencing

B and C have no dependency on each other and can start immediately. A1–A2 can run in parallel with them. A5's month tab strip should land **after** C's `MonthPager`, so the tab strip drives the pager instead of competing with it. A5's floating-FAB/shape work should coordinate with B's inset hook.

## Handoff checks (per AGENTS.md)

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build:web`, `npm run test:web`, plus `npx expo export -p ios` / `-p android`, since all three touch shared UI, routing and theme code. Update `README.md` (features) and `docs/theme-authoring.md` (variants).
