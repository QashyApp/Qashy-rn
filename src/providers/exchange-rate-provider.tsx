/**
 * The app-wide exchange-rate service and the hooks that read it.
 *
 * A sibling to `FinanceProvider` rather than a field on it: the service has its own lifecycle
 * (an in-memory negative cache and in-flight de-duplication that live for the process, not for
 * a component's mount) and its own subscription, so giving it a second `useSyncExternalStore`
 * store here keeps a status update from re-rendering every screen that only reads finance state.
 *
 * `fetch` is the one thing that differs by platform: on web this is `globalThis.fetch`, the
 * platform's own implementation; everywhere else it is `expo/fetch`, the same choice
 * `src/sync/runtime.ts` makes for the relay, for the same reason (a fetch implementation that
 * behaves consistently across iOS, Android, and Expo Go). Nothing here reads `window` or any
 * other browser-only global directly — only `Platform.OS`, which is safe on every platform.
 */

import { useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { fetch as expoFetch } from "expo/fetch";

import {
  createExchangeRateService,
  type EnsureRatesResult,
  type ExchangeRateStatus,
  type RatePair,
} from "@/data/exchange-rates/rate-service";
import {
  financeRepository,
  syncingStorage,
} from "@/data/local-finance-repository";

const fetchImpl: typeof globalThis.fetch =
  Platform.OS === "web" ? globalThis.fetch : expoFetch;

/**
 * The one instance for the app's lifetime, exactly like `financeRepository` and
 * `syncingStorage` in `local-finance-repository.ts`. Constructed eagerly (module scope) rather
 * than inside a component so a background refresh started before any screen mounts — or a test
 * that imports this module directly — sees the same object a hook would.
 */
export const exchangeRateService = createExchangeRateService({
  storage: syncingStorage,
  repository: financeRepository,
  getState: () => financeRepository.getSnapshot(),
  fetch: fetchImpl,
});

/**
 * How long `FinanceProvider` is willing to let a rate lookup delay startup or a foreground
 * resume. The lookup itself keeps running after this if it hasn't settled — this only stops it
 * from being on the critical path, since the service already reports its own outcome to `status`
 * rather than throwing.
 */
export const EXCHANGE_RATE_STARTUP_CAP_MS = 4_000;

/**
 * Looks up the rates the vault is about to use (today's rate for foreign accounts, and every
 * rate a due recurring rule needs), but never makes a caller wait longer than the cap for it.
 * Exported so `FinanceProvider` can call it before `generateRecurring()` without inlining the
 * race there.
 */
export function ensurePendingRatesWithCap(): Promise<void> {
  return Promise.race([
    exchangeRateService.ensureRatesForPending().then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) =>
      setTimeout(resolve, EXCHANGE_RATE_STARTUP_CAP_MS),
    ),
  ]);
}

export function useExchangeRateService() {
  return exchangeRateService;
}

export function useExchangeRateStatus(): ExchangeRateStatus {
  return useSyncExternalStore(
    exchangeRateService.subscribe,
    exchangeRateService.getStatus,
    exchangeRateService.getStatus,
  );
}

export type { EnsureRatesResult, ExchangeRateStatus, RatePair };
