# Qashy Agent Guide

Qashy is a private, local-first personal budget app built with Expo SDK 58, React Native, React 19, and Expo Router. It targets Android and an installable responsive PWA for desktop and mobile browsers.

> Native iOS is not currently supported. Do not add iOS-specific code paths, `Platform.OS === "ios"` branches, or iOS-only APIs. The web PWA still supports iOS Safari (home-screen install, safe-area insets, WebKit quirks); that is web code, not native iOS.

Before changing Expo APIs, read the exact SDK 58 documentation at <https://docs.expo.dev/versions/v58.0.0/>. Do not assume examples for older Expo SDKs still apply.

## Product scope

Qashy supports:

- Guided onboarding and editable starter categories.
- Accounts in multiple currencies with automatic exchange rates (on by default, per-device opt-out) (via Frankfurter) and a manual-rate fallback.
- Expense, income, and transfer transactions.
- Search, filters, date-grouped lists, and batch category/deletion actions.
- Daily, weekly, monthly, yearly, and custom budgets with rollover snapshots.
- Saving and spending goals with linked or manual contributions.
- Reviewed or automatically posted recurring transactions.
- Dashboard analytics and lightweight SVG charts.
- Validated CSV mapping, preview, atomic import, and UTF-8 export.
- System/light/dark appearance, Material You colors, curated accents, and custom hex colors.
- Offline PWA startup and install/update behavior.
- End-to-end encrypted, peer-to-peer sync between the user's own devices.

Do not add authentication, bank connections, analytics, advertising, or a remote finance API unless the task explicitly expands the product scope. Automatic exchange rates are the second deliberate, device-local network exception alongside sync: on by default with a per-device opt-out, `src/data/exchange-rates/` sends only currency codes and dates to `frankfurter.dev` (never amounts or account details), pivots every request through EUR, and stores the on/off flag in `sync_meta` — never in `AppSettings`, which replicates to peers.

Sync is the one deliberate exception to "no network". It is peer-to-peer and zero-access: any server involved is a blind relay that only ever holds padded ciphertext addressed to a rotating opaque identifier. It is not a cloud account, it has no server-side identity, and it must never become one. See `docs/sync-threat-model.md`.

## Architecture

- `src/domain/` defines sync-ready entities and defaults.
- `src/data/repository.ts` is the public `FinanceRepository` contract.
- `src/data/local-finance-repository.ts` owns finance rules, queries, aggregates, recurrence, and CSV transactions.
- `src/data/storage.native.ts` persists native records with Expo SQLite, migrations, WAL mode, and exclusive transactions.
- `src/data/storage.web.ts` persists web records in IndexedDB through Dexie. Do not replace it with Expo SQLite web support.
- `src/providers/finance-provider.tsx` initializes and exposes the repository snapshot.
- `src/theme/theme.tsx` owns semantic tokens and platform-specific color behavior.
- `src/features/` contains product screens; route files in `src/app/` should remain thin.
- `src/components/ui/` contains reusable semantic controls and surfaces.
- `src/components/finance/` contains finance-specific presentation components and charts.
- `workbox-config.cjs`, `public/manifest.json`, and the PWA update prompt implement web installation and offline startup.

Keep domain logic out of screen components when it belongs in the repository or a pure utility.

## Data invariants

- Store money as validated safe integers in currency minor units. Never persist floating-point monetary amounts.
- Store exchange rates as decimal strings. Snapshot the applied rate and base-currency minor amount on every transaction.
- Account balances derive from opening balances and posted transactions; never store a mutable current balance.
- Transfers affect both accounts but never income or expense analytics.
- Every persisted entity has a UUID, revision, `createdAt`, `updatedAt`, and nullable `deletedAt`.
- Deleting erases. A deleted finance entity becomes a tombstone that keeps only what `src/domain/erasure.ts` lists (identity, `deletedAt`, kinds, a transaction's `occurrenceKey`, create-time links, and an account's currency, icon and color). Every storage adapter writes tombstones through `toStoredForm`, the op diff emits only the `delete`, and the merge erases causal state at or before the newest delete. A new entity field needs an erasure entry, and the types enforce it. The one hard delete is the import's replace option ("Delete my current data and import"); see the Sync and cryptography rules.
- Nothing is archived. Deleting an account deletes its transactions and recurring schedules in the same single `putMany` (a transfer whose other side survives is converted in place to income or expense on that side, written as one whole `ledger` group; `src/utils/account-impact.ts` is the shared plan the repository applies and the confirmation describes). A budget that loses its last filter is kept and covers all spending. The `archived` flag stays in the models and the merge registry only because older peers may still send it: nothing may set it to true, and the startup/refresh sweep (`sweepArchivedNow`, run only where recurring generation runs) deletes anything that arrives archived. The repair pass's account resurrection still writes `archived: true` as a transient view, which that sweep then deletes.
- Preserve historical budget period limits, filters, category caps, and rollover values.
- Recurring generation must remain idempotent through occurrence keys.
- Batch mutations and CSV commits must use one adapter `putMany` call so SQLite and Dexie can apply them atomically.
- Validate the complete operation before mutating repository state. Update the in-memory snapshot only after persistence succeeds.
- The app language is device-local: the Android per-app locale, or `sync_meta` `appLanguage` on web. It is never stored in `AppSettings` (whose `locale` is legacy and unused for display) and never synced.
- Do not put finance records in service-worker caches, AsyncStorage, URL parameters, or logs.

When adding or changing an entity, update the model, repository contract, both storage paths if necessary, migrations, and contract tests together.

## Sync and cryptography

- All cryptography lives in `src/sync/crypto/`. Nothing outside that directory may import `@noble/*` or `@scure/*`; ESLint enforces this.
- Never hand-roll a primitive. Compose the audited ones, and give every hand-written construction known-answer tests and golden wire vectors.
- Sync has no timers: it runs on the foreground seam and on explicit user actions, because a relay contacted on a schedule is a traffic pattern. The single exception is the opt-in background check-in: Android only, a per-device switch stored in `sync_meta` (`SYNC_META.backgroundSync`, via `src/data/background-sync-store.ts`, never `AppSettings`), off by default, cleared when the device leaves the vault. It is a unique periodic WorkManager job (about every 30 minutes, network connected, battery not low) owned by `modules/qashy-widgets` that starts the `QashyBackgroundSync` headless task, which calls the same `SyncRuntime.reconcile` once per wake (`src/sync/background.ts`). The schedule is reconciled with the setting and sync state on app start and on every status change. Do not add any other timer, polling loop or scheduled relay contact, and keep `docs/sync-threat-model.md` (metadata exposure) in step with it. It fails closed exactly like a foreground pass and never catches and continues past a crypto error.
- Every HKDF label comes from the table in `src/sync/crypto/labels.ts`. Never inline a label string.
- Key material lives only in the platform keystore (`src/sync/keystore.*`). It must never reach `sync_meta`, `AppSettings`, logs, URLs, the clipboard, or the service-worker cache. `AppSettings` replicates to peers, so it can never hold sync configuration.
- Fail closed. A signature failure, roster miss, chain break, or epoch mismatch rejects the entire batch — never a partial apply. Do not swallow crypto errors in a generic `catch`.
- Adding an entity or field means updating the merge registry in `src/sync/oplog/registry.ts` in the same change. An unregistered field is silently never synced.
- Co-dependent fields must share a field group. Splitting `amountMinor` from `currency`, or `accountId` from the currency derived from it, produces states no local mutation could create and corrupts money silently.
- The repair pass in `src/sync/oplog/repair.ts` must stay pure and emit no ops: no `Date.now()`, no `todayLocal()`, no `makeId()`, no `Math.random()`, and no locale-sensitive collation.
- `work` passed to `StorageAdapter.transact` must not await anything but the transaction it is handed. Dexie tracks membership through its own promise zone, and a foreign await commits or aborts the transaction underneath you.
- Never hard-delete a `records` row. Tombstones are erased, not removed: they carry recurrence suppression, so deleting one resurrects a transaction the user deleted. The sole exception is the import's replace option, by explicit product decision: it erases the replaced entity types' rows (tombstones included) in one `transact`, and only when `hasSyncHistory` is false. On a device with any sync history it is refused, because the op log and other devices still hold those entities and would restore them. Do not add other hard deletes, and do not weaken that guard.
- Prefer deterministic entity ids over post-hoc duplicate repair whenever a value uniquely identifies the record.

## Widgets

- Widget settings are device-local: they live in `sync_meta` (`SYNC_META.widgetSettings`, via `src/data/widget-settings-store.ts`) and never in `AppSettings`, which replicates to peers. Write them only through `updateWidgetSettings`.
- The widget data copy (a formatted snapshot in the app's no-backup storage) holds display strings only, is never logged, and is cleared when the last widget is removed or after a replace import. Hide amounts must keep amounts out of it, not merely hide them when drawing.
- The headless widget refresh path (midnight, time-zone/clock and locale changes, a widget needing data) must stay write-free: it reads the repository and pushes a snapshot, and never mutates finance data, generates recurring transactions or writes settings other than pruning removed widgets. Its repository `initialize({ generateRecurring: false })` may perform the one-time storage initialization and, once per device, the tombstone-erasure migration (`eraseStoredTombstones`, guarded by `SYNC_META.tombstonesErased`); that is the only write it may cause. There is no boot receiver: WorkManager persists the scheduled midnight work across reboots.
- The one exception is the opt-in background sync task (Android, per device, off by default; see Sync and cryptography). It is a separate headless task (`QashyBackgroundSync`) that initializes the repository with `generateRecurring: false`, runs exactly one sync reconcile pass, lets incoming ops apply through `applyRemoteOps`, and refreshes widgets. It may write only what applying remote ops and the sync engine's own bookkeeping (op log, cursors, activity) require. It never generates recurring transactions, never otherwise mutates finance data or settings, never runs while the app is in the foreground, and takes the same `withSyncPassLock` as foreground passes. Do not widen it.
- The snapshot contract lives in `src/features/widgets/snapshot.ts` and `modules/qashy-widgets` `Snapshot.kt`. Change both together, and bump the snapshot version when the shape changes.
- Widget figures are read with `includePendingAutoPosts` (`getDashboard`, `getBudgetStatuses`), which counts the auto-post recurring occurrences that are due but not generated yet through the read-only `getPendingAutoPosts`; it shares `planRecurring` with generation and stores, emits and caches nothing. A widget read that skips it shows numbers that lag until the app opens.
- Every kind shares the breakpoints in `WidgetSizes.kt` (one per launcher cell count, 1x1 to 5x1, 2x2 to 4x3) and shows less rather than cut text off: Glance's Text has no ellipsis, so text is measured with `TextFit` (same typeface, sp and font scale as drawn, a 15% safety margin, against `WidgetSizes.fitSize`, the smaller of the breakpoint and the launcher-reported size) and chosen or cut to fit. Only labels and names may be ellipsized; an amount never is: `TextFit.plan` decides once per layout whether every amount in the widget is full or every one compact (all-or-nothing), then steps the size down to 10sp. The add button is always on the physical right, in every language (first child in RTL). Meters draw no elapsed-period marker. Snapshot amounts carry a full and a compact string, and a budget meter past 100% draws its overflow lap in the accent's deeper shade (`WidgetColors.accentDeep`) over the first lap. Layout changes are checked with the Robolectric screenshot tests in `modules/qashy-widgets/android/src/test` (see its README; JVM only, not part of `npm test`), which render every size in English and Hebrew, light and dark, and fail on clipped text.
- Widget kinds are registered, never named elsewhere: no `kind === "…"` branch outside a kind's own file. Adding a kind is: a `src/features/widgets/kinds/<kind>.ts` (config type, defaults, `normalize`, `build`) plus its entries in `WidgetConfig` and `REGISTRY` in `kinds/index.ts`; its payload field on `WidgetSnapshotEntry` (named after the kind); a section and title in `src/features/more/widget-kind-sections.tsx`; on Android a `<Kind>Widget.kt` (widget, receiver, data class, parser) plus its line in `WidgetKinds.kt`, a manifest `<receiver>`, `res/xml` and `res/xml-v31` provider files and strings in `values` and `values-iw` (then `npm run strings:android`). Every kind also needs a picker preview: `previewSizeMode` and a `providePreview` override in its own Kotlin file that call `providePreviewContent` with fixed sample data from string resources (never the snapshot or user data), a `previewLayout` (xml-v31) and `previewImage` for older Android, and a `PREVIEW_VERSION` bump in `WidgetPreviews.kt` whenever preview visuals change. Removing a kind is the reverse; saved configs of an unknown kind are dropped on load, so stale settings need no migration.
- Glance widget content must read the snapshot through `SnapshotStore`'s observable flow inside `provideContent`. Values read before it are frozen for the whole session (~45 s), and `update()` does not re-run `provideGlance` on a live session, so a captured snapshot silently drops every push. Pushes are published by `WidgetPublisher` with one-shot `GlanceAppWidget.compose` plus `AppWidgetManager.updateAppWidget`, never `update`/`updateAll`, which only signal a live session and can be lost; the flow covers the sessions Glance starts itself (placement, resize, `onUpdate`).
- Widgets refresh on the leading edge (`WIDGET_REFRESH_WINDOW_MS`), flush on leaving the foreground, and retry a refresh that did not complete. Anything that changes what a widget shows must either emit through the repository, the widget settings store or the custom themes store, or call `refreshWidgets` itself; a silent write leaves widgets stale.

## Navigation and responsive layout

The primary sections are:

1. Overview
2. Transactions
3. Plan
4. More

Use Expo Router and preserve real public web paths such as `/overview`, `/transactions`, `/plan`, and `/more`.

- Mobile uses four native tabs with nested stacks.
- Web uses bottom navigation below 768px, a compact rail from 768–1199px, and a full sidebar at 1200px and above.
- Creation and editing flows use form-sheet presentation where supported. Web uses the native form sheet; Android uses `AndroidSheet` (`src/components/navigation/android-sheet.tsx`), a transparent-modal route animated with Reanimated, because the native one cannot be restyled without modifying a library.
- Never modify a third-party package: no `patch-package`, no edits under `node_modules`, no vendored forks. Reach for a public API, a local Expo module in `modules/`, or an upstream contribution instead.
- After a sheet mutation, return to or replace with its owning section so repository projections render fresh data on web.
- Route files should generally import and export a feature screen rather than contain business logic.

## UI and theming

- Use semantic values from `useQashyTheme()` instead of hard-coded light/dark surface colors.
- Keep native controls inside the shared `@expo/ui` `Host`.
- A theme is a `ThemeDefinition` in `src/theme/themes/` (registered in `BUILT_IN_THEMES`). Read it only through `useQashyTheme()`, for colors AND scales: `space`, `radius`, `tile`, `iconSize` and `motion` are per theme and must not be imported from `@/theme/tokens` outside `src/theme/` (ESLint enforces this). Never hard-code colors or scale values in features. See `docs/theme-authoring.md`.
- Every theme defines both light and dark; there are no single-scheme themes.
- Classic's surfaces are the hand-tuned neutral tokens in `src/theme/tokens.ts`; other themes may use different surfaces, shapes, materials, type and icon sets. The accent drives the accent color family only when the theme's `accent.mode` is `user`; Android system accent (Material You theme) optionally uses dynamic Material colors, while web uses the theme's default accent.
- Custom (user-authored) themes are JSON files validated fail-closed and contrast-clamped by `src/theme/custom/schema.ts`. They are stored device-locally in `sync_meta` (`SYNC_META.customThemes`, via `src/data/custom-themes-store.ts`), never in `AppSettings`, and never synced. A broken or missing custom theme falls back to Classic. Changing the schema means updating `CUSTOM_THEME_GUIDE.md` and its tests (`src/theme/custom/__tests__/guide.test.ts`).
- `themeId`, `themeMode`, `accentSource` and `accentHex` are `deviceLocal` in the sync registry. Do not move theme settings into a synced field group.
- Icon ids stored on entities stay theme-independent; a theme's icon set only changes how an id is drawn, and any gap falls back to Ionicons.
- Fonts come from the registry in `src/theme/fonts.ts`, must be open-license and bundled, and any face without Hebrew needs a Rubik fallback. No remote theme assets: no fonts, images or URLs fetched for a theme.
- Blur is selective: navigation, sheets, and floating actions only. Always provide blur and opaque reduced-transparency fallbacks.
- Prefer continuous corners, restrained shadows, tabular financial figures, and subtle motion.
- Use `react-native-svg` for shared lightweight charts.
- Maintain 44–48px minimum touch targets and meaningful accessibility roles, labels, and selected states.
- Respect reduced motion and reduced transparency. Do not encode chart meaning through color alone.
- Reuse shared UI components before introducing one-off styling or another component library.
- After changing `src/localization/messages/he.ts`, run `npm run strings:android`: Android UI strings ship as resources for Play translation, and a test fails when the generated files are stale.

## Platform code

Use platform files when behavior genuinely differs:

- `.native.ts` or `.native.tsx` for Android (iOS is not currently supported).
- `.web.ts` or `.web.tsx` for browsers.
- A non-suffixed file may act as a TypeScript or Metro fallback.

Guard browser globals such as `window`, `document`, `navigator`, `Blob`, and IndexedDB. Guard native-only APIs before using them on web.

## PWA rules

- `npm run build:web` must generate both the Expo static export and Workbox service worker.
- The service worker caches only static app-shell resources.
- Keep `runtimeCaching` empty unless a reviewed non-finance use case requires it.
- Preserve the manifest, update prompt, persistent-storage request, and offline navigation fallback.
- Test service-worker behavior against the production `dist/` export, not the Expo development server.

## Testing and handoff

Run checks proportional to the change. Before handing off a broad or release-facing change, run:

```bash
npm run typecheck
npm run lint
npm test
npm run build:web
npm run test:web
```

Also verify native bundling when touching shared application, routing, storage, or theme code:

```bash
npx expo export -p android --output-dir /tmp/qashy-android-export
```

Tests should cover money and rate calculations, balances, transfers, recurrence edge cases, rollover snapshots, filters, tombstone erasure, atomic failures, CSV escaping/deduplication, IndexedDB persistence, responsive navigation, and offline PWA reloads.

Do not use `npm audit fix --force` to resolve transitive Expo advisories; it can install incompatible SDK packages. Report unresolved advisories and upgrade through an intentional Expo SDK update instead.

## Change discipline

- Preserve unrelated user changes in a dirty worktree.
- Keep TypeScript strict and avoid `any` unless an external API makes it unavoidable and the boundary is documented.
- Prefer pure utilities for date, period, money, and CSV calculations.
- Use repository subscriptions rather than duplicating finance state in new global stores.
- Update `README.md` when setup, architecture, scripts, privacy behavior, or supported features change.
- Never commit `dist/`, `test-results/`, native generated folders, credentials, or local environment files.
