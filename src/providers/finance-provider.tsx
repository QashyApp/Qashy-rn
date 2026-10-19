import {
  createContext,
  startTransition,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  Text,
  View,
  useColorScheme,
} from "react-native";

import {
  storageFailureMessage,
  STORAGE_UNKNOWN_MESSAGE,
} from "@/data/storage-error";
import type { FinanceRepository } from "@/data/repository";
import { financeRepository } from "@/data/local-finance-repository";
import { ensurePendingRatesWithCap } from "@/providers/exchange-rate-provider";
import { QASHY_ACCENT } from "@/domain/defaults";
import {
  languageFromLocale,
  SYSTEM_PREFERENCE,
} from "@/localization/language-preference";
import {
  readDeviceLocales,
  readNativeRawPreference,
} from "@/localization/language-store";
import { lookupHebrew } from "@/localization/messages/he";
import type { AppSettings, FinanceState } from "@/domain/models";
import { classicTheme } from "@/theme/themes/classic";
import { readableTextColor } from "@/theme/tokens";

/** Resume events within this window of a finished reload are covered by it. */
const RECONCILE_MIN_INTERVAL_MS = 2000;

interface FinanceContextValue {
  repository: FinanceRepository;
  state: FinanceState;
}

const FinanceContext = createContext<FinanceContextValue | null>(null);

// The settings row on its own. Providers, the root navigator and the pager read nothing else, and
// the rest of the snapshot changes on every transaction save; a separate context lets them skip
// those renders. Its value is `state.settings`, whose identity only changes when a setting does.
const FinanceSettingsContext = createContext<AppSettings | null>(null);

interface FinanceReloadValue {
  /** Set when a resume-time reconcile failed. The snapshot on screen is stale. */
  error: string | null;
  retry: () => void;
  dismiss: () => void;
}

// Separate from FinanceContext so a failed background reload re-renders only the
// banner that reports it, not every screen subscribed to the finance snapshot.
const FinanceReloadContext = createContext<FinanceReloadValue | null>(null);

/**
 * Whether the startup failure screen should speak Hebrew. It cannot use the app's localization:
 * the database that holds the saved language, and the provider that reads it, are what failed.
 * So it reads what survives without them. On Android that is the native per-app locale, which the
 * system Settings picker and the in-app picker both write and which reads synchronously; a
 * device with no per-app choice, and the web, fall back to the device's own language. The legacy
 * `iw` code counts as Hebrew, as everywhere else (`languageFromLocale`).
 */
function startupIsHebrew() {
  try {
    const perApp = readNativeRawPreference()?.split(",")[0]?.trim();
    if (perApp && perApp !== SYSTEM_PREFERENCE)
      return languageFromLocale(perApp) === "he";
    const [device] = readDeviceLocales();
    return device ? languageFromLocale(device) === "he" : false;
  } catch {
    return false;
  }
}

/**
 * The failure's message in English, for the reload banner (which translates it) and the startup
 * screen (which looks it up). A storage engine's own diagnostic never reaches the user: it
 * becomes one of Qashy's sentences. A Qashy message the dictionary knows is kept, and anything
 * else is replaced by a generic sentence, because a message nobody translated would show as
 * English in every language.
 */
function failureMessage(reason: unknown, fallback: string) {
  const known = storageFailureMessage(reason);
  if (known) return known;
  if (
    reason instanceof Error &&
    reason.message &&
    lookupHebrew(reason.message) !== null
  ) {
    return reason.message;
  }
  if (reason instanceof Error) console.error(reason);
  return reason instanceof Error ? STORAGE_UNKNOWN_MESSAGE : fallback;
}

export function FinanceProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);
  // This component renders above QashyThemeProvider, so it themes its own
  // loading and error states from the static token sets.
  const scheme = useColorScheme();
  // Settings are not loaded yet, so the user's theme is unknown: classic is the only truthful choice.
  const tokens = classicTheme.palette[scheme === "dark" ? "dark" : "light"];
  // Re-render the tree as a transition so a mutation (e.g. saving a budget)
  // doesn't block the UI while every mounted screen recomputes its projections.
  const subscribe = useCallback(
    (listener: () => void) =>
      financeRepository.subscribe(() => startTransition(listener)),
    [],
  );
  const state = useSyncExternalStore(
    subscribe,
    financeRepository.getSnapshot,
    financeRepository.getSnapshot,
  );
  const contextValue = useMemo(
    () => ({ repository: financeRepository, state }),
    [state],
  );

  useEffect(() => {
    financeRepository
      .initialize()
      // Idempotent after a sweeping `initialize()`. `initialize()` is memoized, so if a headless
      // widget task ran it first in this process (no sweep, no generation), this is what sweeps.
      // It never rejects, so it cannot fail startup.
      .then(() => financeRepository.sweepArchived())
      .then(() => financeRepository.generateRecurring())
      // Best-effort and capped: a slow or failed rate fetch must never delay the app's first
      // render. `ensurePendingRatesWithCap` already swallows every failure into the service's own
      // status, so nothing here needs a `.catch` of its own.
      .then(() => ensurePendingRatesWithCap())
      // The generation above ran before this refresh landed, so any rule that had no rate yet
      // skipped that occurrence. Re-running it here is a no-op for everything that already posted
      // (idempotent via occurrence keys) and retries only what was blocked on a missing rate. A
      // failure here is reported the same way `reconcile` reports one below — in place, not as a
      // fatal startup error — since the app has already rendered a usable snapshot by this point.
      .then(() => financeRepository.generateRecurring())
      .catch((reason: unknown) => {
        if (financeRepository.getSnapshot().ready) {
          setReloadError(
            failureMessage(
              reason,
              "Qashy could not reload its local database.",
            ),
          );
          return;
        }
        setError(
          failureMessage(reason, "Qashy could not open its local database."),
        );
      });
  }, []);

  const reconciling = useRef(false);
  const lastReconcile = useRef(0);
  const reconcile = useCallback(() => {
    if (!financeRepository.getSnapshot().ready) return;
    // Returning to a tab fires `visibilitychange`, `focus` and `pageshow` together. Each used
    // to run a full reload; one in flight (or one that just finished) already covers the rest.
    if (reconciling.current) return;
    if (Date.now() - lastReconcile.current < RECONCILE_MIN_INTERVAL_MS) return;
    reconciling.current = true;
    financeRepository
      .refresh()
      // Refreshed before `generateRecurring()` so a rule that auto-posts today snapshots the
      // rate this refresh just fetched, rather than yesterday's stored one. Capped the same way
      // as the initial load, so a slow network on resume doesn't stall the reconcile either.
      .then(() => ensurePendingRatesWithCap())
      .then(() => financeRepository.generateRecurring())
      .then(() => setReloadError(null))
      .catch((reason: unknown) => {
        lastReconcile.current = 0;
        // Storage can become unusable while the app is backgrounded — an evicted
        // native handle, or IndexedDB hitting its quota. Discarding this left the app
        // showing stale figures with no sign anything had failed. Reporting it as a
        // startup error was the opposite mistake: a *background* refresh would then
        // unmount the whole tree and take any half-filled form down with it, and a
        // rule that throws during generation would repeat that on every resume.
        // Report it in place so the user can retry, or keep working and ignore it.
        setReloadError(
          failureMessage(reason, "Qashy could not reload its local database."),
        );
      })
      .finally(() => {
        reconciling.current = false;
        if (lastReconcile.current !== 0) lastReconcile.current = Date.now();
      });
    lastReconcile.current = Date.now();
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      const onVisibilityChange = () => {
        if (document.visibilityState === "visible") reconcile();
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
      globalThis.addEventListener("focus", reconcile);
      globalThis.addEventListener("pageshow", reconcile);
      return () => {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        globalThis.removeEventListener("focus", reconcile);
        globalThis.removeEventListener("pageshow", reconcile);
      };
    }
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (previousState !== "active" && nextState === "active") reconcile();
      previousState = nextState;
    });
    return () => subscription.remove();
  }, [reconcile]);

  const reloadValue = useMemo(
    () => ({
      error: reloadError,
      retry: () => {
        setReloadError(null);
        reconcile();
      },
      dismiss: () => setReloadError(null),
    }),
    [reloadError, reconcile],
  );

  if (error) {
    // The database, and with it the saved language, failed to open, so this screen cannot use
    // the app's localization; see `startupIsHebrew` for what it follows instead.
    const hebrew = startupIsHebrew();
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
          gap: 12,
          backgroundColor: tokens.background,
        }}
      >
        <Text
          selectable
          style={{ fontSize: 20, fontWeight: "700", color: tokens.text }}
        >
          {hebrew ? "לא ניתן לפתוח את Qashy" : "Couldn’t open Qashy"}
        </Text>
        <Text
          selectable
          style={{ textAlign: "center", color: tokens.textMuted }}
        >
          {hebrew ? (lookupHebrew(error) ?? error) : error}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setError(null);
            financeRepository
              .initialize()
              .catch((reason: unknown) =>
                setError(failureMessage(reason, "Database error")),
              );
          }}
          style={{
            backgroundColor: QASHY_ACCENT,
            borderRadius: 999,
            paddingHorizontal: 20,
            paddingVertical: 12,
          }}
        >
          <Text
            style={{
              color: readableTextColor(QASHY_ACCENT),
              fontWeight: "700",
            }}
          >
            {hebrew ? "נסו שוב" : "Try again"}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (!state.ready) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: tokens.background,
        }}
      >
        <ActivityIndicator color={QASHY_ACCENT} />
      </View>
    );
  }

  return (
    <FinanceContext value={contextValue}>
      <FinanceSettingsContext value={state.settings}>
        <FinanceReloadContext value={reloadValue}>
          {children}
        </FinanceReloadContext>
      </FinanceSettingsContext>
    </FinanceContext>
  );
}

/**
 * Reports a failed resume-time reload. Returns null outside the provider so the
 * banner can be rendered from the root navigator without asserting ordering.
 */
export function useFinanceReload() {
  return use(FinanceReloadContext);
}

export function useFinanceRepository() {
  const context = use(FinanceContext);
  if (!context)
    throw new Error(
      "useFinanceRepository must be used inside FinanceProvider.",
    );
  return context.repository;
}

export function useFinanceState(): FinanceState {
  const context = use(FinanceContext);
  if (!context)
    throw new Error("useFinanceState must be used inside FinanceProvider.");
  return context.state;
}

/**
 * Just the settings row. Prefer this to `useFinanceState()` when settings are all a component
 * reads: it re-renders only when a setting changes, not on every finance mutation.
 */
export function useFinanceSettings(): AppSettings {
  const settings = use(FinanceSettingsContext);
  if (!settings)
    throw new Error("useFinanceSettings must be used inside FinanceProvider.");
  return settings;
}
