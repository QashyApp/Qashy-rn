# Qashy architecture

A map of the codebase for a developer reading it without AI help. For the rules that must not be
broken, see [`AGENTS.md`](../AGENTS.md); for sync's security design, see
[`sync-threat-model.md`](sync-threat-model.md).

## Overview

Qashy is a local-first budget app (Expo + React Native + Expo Router) for Android and an
installable PWA. All finance data lives on the device: in SQLite on Android and in IndexedDB on
the web. A single in-memory snapshot is the source of truth for the UI, and every change is written
to storage first and only then published to that snapshot. Optional end-to-end encrypted sync
between a user's own devices is layered underneath, as a storage decorator that turns every write
into a signed op, so the finance rules never know sync exists.

Layers, from the bottom up (an arrow means "is used by"):

```
domain  →  data  →  providers  →  features  →  app (routes)
```

| Folder              | Role                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `src/domain/`       | Entity types (`models.ts`), defaults, erasure rules (`erasure.ts`), pure rules (`rules.ts`).       |
| `src/data/`         | The repository, storage adapters, device-local stores, exchange rates, importers.                  |
| `src/providers/`    | React context over the repository (`finance-provider.tsx`), sync and exchange-rate providers.      |
| `src/features/`     | Product screens and their hooks, one folder per area (transactions, plan, more, sync, widgets...). |
| `src/app/`          | Thin Expo Router route files that export a feature screen. Real public paths such as `/overview`.  |
| `src/utils/`        | Pure helpers: money, dates, periods, CSV, naming, deterministic ids.                               |
| `src/sync/`         | Everything about sync: crypto, op log, engine, transport, keystore. See below.                     |
| `src/theme/`        | Semantic tokens, built-in and custom themes, fonts, icon sets. Read through `useQashyTheme()`.     |
| `src/localization/` | Message tables (`messages/he.ts`), language stores, generated Android string catalog.              |
| `src/components/`   | `ui/` (semantic controls), `finance/` (charts, keypad), `navigation/`, `sync/`.                    |
| `src/hooks/`        | Small shared hooks (`use-now.ts`).                                                                 |
| `src/services/`     | Device services with no finance logic: `haptics.ts`, `web-dialog-store.ts`.                        |
| `modules/`          | Local native Android Expo modules: `qashy-widgets`, `qashy-locale`, `qashy-dynamic-colors`, ...    |
| `server/`           | The blind relay (a small Cloudflare worker, `server/src/worker.ts`). See `server/README.md`.       |

## Data flow

```
 screen (src/features/...)
   │  useFinanceRepository()                 src/providers/finance-provider.tsx
   ▼
 LocalFinanceRepository                      src/data/local-finance-repository.ts
   │  snapshot + mutation queue; rules from src/data/finance/*.ts
   │  storage.putMany(records, source)
   ▼
 SyncingStorageAdapter                       src/data/syncing-storage-adapter.ts
   │  inside ONE transaction: diff old vs new rows → ops → op log + chain head,
   │  then writes the rows (unarmed: passes straight through)
   ▼
 storage.native.ts (Expo SQLite)  or  storage.web.ts (Dexie / IndexedDB)

 Reads:   repository snapshot ──emit()──► listeners ──► FinanceProvider ──► screens re-render
 Sync:    op log ──► src/sync/engine (seal, send, receive) ──► repository.applyRemoteOps
```

The provider subscribes to the repository with `useSyncExternalStore`, so a change reaches the UI
only through `emit()`. Screens never keep their own copy of finance state.

## What happens when you tap Save on a transaction

1. `src/app/transaction.tsx` renders `TransactionFormScreen`
   (`src/features/transactions/transaction-form-screen.tsx`). Its primary `ActionButton` has
   `onPress={save}`.
2. `save` comes from `useTransactionForm()` (`src/features/transactions/form/use-transaction-form.ts`).
   It returns early if the form is busy or invalid, sets `busy`, parses the amount strings into
   minor units with `parseMoney`, resolves the foreign leg, fee and transfer destination into a
   `TransactionInput`, then awaits `repository.saveTransaction(input, existing?.id, expectedRevision)`.
3. `saveTransaction` (`LocalFinanceRepository`) only calls `enqueueMutation(() => this.saveTransactionNow(...))`.
   The queue runs mutations strictly one after another.
4. `saveTransactionNow` calls `buildTransaction` (`src/data/finance/transactions.ts`, reached
   through `this.buildTransaction`). It validates the input, checks the account, category and tag
   references and the expected revision, applies the fee, takes the exchange-rate snapshots, and
   returns the `TransactionRecord` it would write. It changes nothing.
5. `assertTransactionSetSafe` (`src/data/finance/safety.ts`) checks that balances, totals and net
   worth stay representable with the new row in place. It throws before anything is written.
6. `commitOne("transactions", transaction)` calls `persist`, which calls
   `storage.putMany(asRecords(...), this)`. In `SyncingStorageAdapter.putMany`, one storage
   transaction reads the previous rows, diffs them into ops (`diffRecords` in `src/sync/oplog/`),
   records the ops, advances the chain head, and writes the rows. If it throws, nothing changed.
7. Only after the write succeeds, `commitOne` swaps the row into the snapshot (`replaceInList`,
   which replaces the array so derived-read caches miss) and calls `emit()`.
8. `FinanceProvider` receives the notification through its `useSyncExternalStore` subscription
   (inside `startTransition`) and re-renders the screens reading the new snapshot.
9. Back in the hook: `hapticSuccess()`, `announceSavedTransaction` for the ledger flash, and
   `closeToOwner(...)` returns to the owning section. If any step threw, the `catch` shows the
   message through `setSaveError` and `finally` clears `busy`.

## The `foo()` / `fooNow()` pattern

Every public mutation on `LocalFinanceRepository` is a pair:

```ts
saveTransaction(input, id?, expectedRevision?) {
  return this.enqueueMutation(() => this.saveTransactionNow(input, id, expectedRevision));
}
private async saveTransactionNow(...) { /* validate, persist, swap snapshot, emit */ }
```

`enqueueMutation` chains each operation onto `mutationQueue`, so two mutations never interleave
their reads and writes. Inside a `...Now` method, call other `...Now` methods or the private
helpers, never another public mutation: it would queue behind the one that is waiting and
deadlock. Each `...Now` follows the same order: validate the whole operation, persist with a
single `putMany`, then update the snapshot and `emit()`. The queue also drains any external
refresh (another tab wrote) between mutations.

## `src/data/finance/`

The rules are plain functions that read the live snapshot through a `FinanceContext`
(`context.ts`) and never write; the repository does the writing.

| File                     | Topic                                                                        |
| ------------------------ | ---------------------------------------------------------------------------- |
| `context.ts`             | `FinanceContext`: the live view of state and locale that rules read.         |
| `validation.ts`          | Field checks, normalizers, whole-input validators for budgets and goals.     |
| `settings.ts`            | Planning a settings save.                                                    |
| `entity-saves.ts`        | Plans for saving accounts, categories, goals, contributions, exchange rates. |
| `records.ts`             | Small helpers over entity lists and `putMany` records.                       |
| `rates.ts`               | Exchange-rate lookup, reciprocal checks, pricing snapshots of unpriced rows. |
| `transactions.ts`        | `buildTransaction`, transfer conversion, the CSV duplicate key.              |
| `budgets.ts`             | Period snapshots, rollover, adjustments, budget statuses.                    |
| `recurring.ts`           | Schedule walking, generation planning, rule validation, the save plan.       |
| `analytics.ts`           | Dashboard, net-worth series, goal progress.                                  |
| `queries.ts`             | Transaction search and filtering.                                            |
| `safety.ts`              | Overflow gate for a local change.                                            |
| `merge-safety.ts`        | Pure checks that gate a merged (remote) set.                                 |
| `deletion.ts`            | What deleting an entity takes with it (dependent rules, transfers).          |
| `csv.ts`                 | CSV row parsing, import staging, export.                                     |
| `import-bundle.ts`       | Importing another app's backup (`runExternalImport`).                        |
| `import-bundle-steps.ts` | The per-entity steps `import-bundle.ts` runs.                                |

`src/data/import/` holds the source-specific parsing (for example `cashew/`) that produces the
`ImportBundle` which `import-bundle.ts` commits.

## `src/sync/`

Crypto and the op log are pure and offline; the engine is the first layer that reads a clock,
opens a transaction or talks to a peer.

- `crypto/`: the only code allowed to import `@noble/*` and `@scure/*`. Primitives, the sealed
  envelope (context-bound, length-padded), the handshake, recovery phrase and key derivation.
  Every HKDF label lives in `labels.ts`; `index.ts` is the single public surface.
- `oplog/`: turns record changes into ops (`diff.ts`), hash-chains them (`chain.ts`), merges them
  into per-field causal state (`merge.ts`, driven by `registry.ts`), orders them (`hlc.ts`) and
  repairs merged state so it is valid (`repair.ts`, pure, emits no ops).
- `engine/`: runs a pass: seal unsigned ops (`sealer.ts`), build and send batches (`send.ts`),
  verify and apply received ones (`receive.ts`, `roster.ts`), compaction, duplicate merging.
  `session.ts` is the one entry point, `reconcile()`; there are no timers.
- `transport/`: how bytes move. The encrypted drop-box (`relay.ts`), a `.qashysync` file bundle
  (`file.ts`), pairing signaling, relay health. Transports never hold a key.
- `keystore/`: where key material lives (Android keystore, IndexedDB non-extractable key, memory
  for tests), with an optional passphrase gate. Key material never reaches `sync_meta`.

Top-level files:

- `runtime.ts`: the one place that turns configuration into a running sync: derives bucket ids
  and tags from the root key, decides which transports exist, caches them between passes.
- `setup.ts`: whole state transitions: enable, join (adopt), leave, rotate the key. Each leaves
  the device in exactly one state `readSyncStatus` can describe.
- `pairing.ts`: the QR + handshake + six-word comparison that turns two devices into one vault.
- `backup.ts`: the whole vault as one encrypted file, and restoring a device from it.
- `background.ts`: the opt-in Android background check-in; one `reconcile` per wake, fails closed.
  Wiring is in `src/features/background-sync/`.
- `revocation.ts`: signed, hash-chained membership-control events for removing a device.
- `pass-lock.ts`: a promise-chain queue so a foreground and a background pass never overlap.

## Glossary

- **Minor units**: money as a safe integer in the currency's smallest unit (cents). Never floats.
- **Tombstone**: what a deleted record leaves behind. `src/domain/erasure.ts` lists the only
  fields kept (id, `deletedAt`, kinds, a few links). Needed so sync and recurrence know it was deleted.
- **Occurrence key**: the id of one generated occurrence of a recurring rule; makes generation
  idempotent and lets a deleted occurrence stay deleted.
- **Budget period snapshot**: `BudgetPeriodSnapshot`, one budget period's frozen limit, filters,
  category caps and rollover, so later edits to the budget do not rewrite history.
- **Rollover**: carrying unspent (or overspent) budget from one period into the next
  (`rolloverMinor` on the snapshot).
- **Field group**: fields of an entity that merge as one register (for example `amountMinor` with
  `currency`), so a merge never produces a combination no device held.
- **Merge registry**: `src/sync/oplog/registry.ts`, the table saying how each field of each entity
  merges. A field missing from it never syncs.
- **HLC**: hybrid logical clock; a fixed-width string whose lexicographic order is the causal order.
- **Op log**: the append-only, hash-chained list of ops a device authored or received.
- **Vault**: the set of devices sharing one root key; the unit of sync.
- **Roster**: the vault's list of member devices and their public keys, consulted for every batch.
- **Epoch**: a counter bumped when the vault key is rotated or reset; frames from an older epoch stop opening.
- **Device-local vs synced**: `AppSettings` replicates to peers. Device-local settings (theme,
  language, widgets, background sync, rate fetching) live in the `sync_meta` table via the stores in
  `src/data/device-local/`, or are marked `deviceLocal` in the registry, and never leave the device.

## Suggested reading order

1. `src/domain/models.ts`: the entities and their shared fields.
2. `src/data/repository.ts`: the public `FinanceRepository` contract.
3. `src/providers/finance-provider.tsx`: how the snapshot reaches React.
4. One full flow: the Save walkthrough above, then a read such as the dashboard in
   `src/data/finance/analytics.ts`.
5. `src/utils/`: `money.ts`, `date.ts`, `period.ts`, `entity.ts`.
6. `src/sync/`, last: start with the header comments of `oplog/index.ts`, `engine/index.ts`,
   then `runtime.ts`.

Tip: `src/data/__tests__/repository.test.ts` documents the repository's behavior by example. When a
rule is unclear, find its test.
