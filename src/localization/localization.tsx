import {
  createContext,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";

import {
  appLanguageFromLocale,
  isAndroid,
  isCanonicalPreference,
  isRtlLocale,
  languageFromLocale,
  normalizePreference,
  resolveLocale,
  resolveSystemLocale,
  SYSTEM_PREFERENCE,
  type AppLanguage,
  type LanguagePreference,
} from "@/localization/language-preference";
import { createDynamicPatterns, HEBREW } from "@/localization/messages/he";
import {
  EMPTY_NATIVE_TABLE,
  getNativeTable,
  NATIVE_LOAD_TIMEOUT_MS,
  setNativeTable,
  translateWithTable,
  type NativeTable,
  withTimeout,
} from "@/localization/native-table";
import { loadNativeTable } from "@/localization/native-table-loader";
import {
  loadStoredRawPreference,
  migrateLegacyLanguage,
  persistPreference,
  readDeviceLocales,
  readNativeRawPreference,
  usesNativeLocale,
} from "@/localization/language-store";
import {
  useFinanceRepository,
  useFinanceSettings,
} from "@/providers/finance-provider";

export type { AppLanguage };
export { languageFromLocale };

// Built once: the table is static, and every non-dictionary string in Hebrew walks it.
const DYNAMIC_PATTERNS = createDynamicPatterns(translateMessage);

// One cache per language: the same English message has a different result in each. The
// Hebrew one is a plain map; a Play-translated language's lives with its table, so a table
// swapped in starts with an empty cache and no result can outlive the table it came from.
const hebrewCache = new Map<string, string>();
const tableCaches = new WeakMap<NativeTable, Map<string, string>>();
const DYNAMIC_CACHE_LIMIT = 500;

function cached(
  cache: Map<string, string>,
  message: string,
  compute: () => string,
): string {
  const hit = cache.get(message);
  if (hit !== undefined) return hit;
  const result = compute();
  if (cache.size >= DYNAMIC_CACHE_LIMIT) cache.clear();
  cache.set(message, result);
  return result;
}

function translateHebrewDynamic(message: string) {
  return cached(hebrewCache, message, () => {
    for (const [pattern, replacement] of DYNAMIC_PATTERNS) {
      const match = message.match(pattern);
      if (match) return replacement(...match.slice(1));
    }
    return message;
  });
}

/**
 * Puts a loaded Play-translated table in use. The English
 * fallback (an empty table) never replaces a table that holds real translations.
 */
function installNativeTable(localeTag: string, table: NativeTable) {
  const existing = getNativeTable(localeTag);
  // The first real table of a locale stays: a later or superseded read of the same resources
  // changes nothing, and the empty fallback of a failed read must not replace it.
  if (existing && existing !== EMPTY_NATIVE_TABLE) return;
  setNativeTable(localeTag, table);
}

/** Settles with the first of `loads` to succeed, or rejects once every one has failed. */
function firstSuccess<T>(loads: readonly Promise<T>[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let failed = 0;
    for (const load of loads) {
      load.then(resolve, (reason: unknown) => {
        if (++failed === loads.length) reject(reason);
      });
    }
  });
}

/**
 * Loads a locale's table. A failed read, or one that has not settled within the timeout, is
 * retried once, and only a second failure leaves the locale English (an empty table), so one
 * transient error does not cost the whole session. The timeout only stops the waiting: when the
 * first attempt times out, it keeps running beside the retry, and whichever succeeds first wins.
 * The wait is bounded: at most two attempts of `NATIVE_LOAD_TIMEOUT_MS` (5 s), so a first launch
 * into a Play locale whose reads both hang renders nothing for up to about 10 s, then shows
 * English. A result arriving after that is ignored.
 */
async function loadTableWithRetry(localeTag: string): Promise<NativeTable> {
  // An empty table from the loader means nothing was read (no module, or every value null).
  const read = async () => {
    const table = await loadNativeTable(localeTag);
    if (table === EMPTY_NATIVE_TABLE) throw new Error("No translations read");
    return table;
  };
  const first = read();
  try {
    return await withTimeout(first, NATIVE_LOAD_TIMEOUT_MS);
  } catch {
    const second = read();
    return withTimeout(
      firstSuccess([first, second]),
      NATIVE_LOAD_TIMEOUT_MS,
    ).catch(() => EMPTY_NATIVE_TABLE);
  }
}

/**
 * Makes a Play-translated locale's table available outside the provider (home-screen widgets
 * build their text from a headless task, with no React tree). A table that already holds real
 * translations is kept; a failed load leaves the locale English. Never rejects.
 */
export async function ensureNativeTable(localeTag: string): Promise<void> {
  const existing = getNativeTable(localeTag);
  if (existing && existing !== EMPTY_NATIVE_TABLE) return;
  installNativeTable(localeTag, await loadTableWithRetry(localeTag));
}

export function translateMessage(message: string, language: AppLanguage) {
  if (language === "en" || !message) return message;
  const leading = message.match(/^\s*/)?.[0] ?? "";
  const trailing = message.match(/\s*$/)?.[0] ?? "";
  const core = message.slice(
    leading.length,
    message.length - trailing.length || undefined,
  );
  // Whitespace only: nothing to translate, and the message must come back as it was.
  if (core === "") return message;
  let translated: string;
  if (language === "he") {
    // `hasOwn`, not a bare lookup: HEBREW is an object literal, so a message that
    // happens to name an Object.prototype member ("constructor", "toString", a
    // user-entered account called "valueOf") would resolve to the inherited function
    // and interpolate it into the UI. Nothing reaches this with free-form text today,
    // but the dictionary should not be able to answer for keys it does not hold.
    translated = Object.hasOwn(HEBREW, core)
      ? HEBREW[core]
      : translateHebrewDynamic(core);
  } else {
    // Any other language reads the native table of its own locale tag, and English until that
    // has loaded or where it has no entry. Never the Hebrew dictionary.
    const table = getNativeTable(language);
    if (table) {
      let cache = tableCaches.get(table);
      if (!cache) tableCaches.set(table, (cache = new Map()));
      translated = cached(cache, core, () => translateWithTable(core, table));
    } else {
      translated = core;
    }
  }
  return `${leading}${translated}${trailing}`;
}

type LocalizationValue = {
  language: AppLanguage;
  /** The resolved supported tag (`en-US`, `he-IL`): what all number, money and date formatting uses. */
  locale: string;
  isRtl: boolean;
  t: (message: string) => string;
  /**
   * This device's choice: `"system"` or an explicit supported tag. It changes the moment it is
   * chosen; `language`, `locale` and `isRtl` follow it at once for a bundled language, and once
   * its translations have loaded for a Play-translated one.
   */
  preference: LanguagePreference;
  /** What `"system"` resolves to on this device right now. */
  systemLocale: string;
  /**
   * Switches the language and persists it on this device (see `preference` for when the UI follows). Rejects only when its write fails
   * and no later choice is queued (the UI then shows what is persisted); a failure superseded by
   * a later choice resolves, because that later choice decides the outcome.
   */
  setPreference: (preference: LanguagePreference) => Promise<void>;
};

const LocalizationContext = createContext<LocalizationValue | null>(null);
let currentLanguage: AppLanguage = "en";

function setCurrentLanguage(language: AppLanguage) {
  if (currentLanguage !== language) currentLanguage = language;
}

type DeviceLanguage = {
  /**
   * The stored or native value as read, not normalized: an unsupported tag reads as "system"
   * but still has to be reset when the user picks "System default".
   */
  raw: string;
  deviceLocales: readonly string[];
  /**
   * Set when the native per-app locale could not be read, so `raw` is only the "system"
   * fallback shown meanwhile. Nothing is persisted because of it, and a later successful read
   * (or a user choice, even "System default") replaces it.
   */
  unverified?: true;
};

/** Android's per-app locale is readable synchronously, so its first render is already correct. */
function readInitial(): DeviceLanguage | null {
  try {
    const raw = readNativeRawPreference();
    return raw === null ? null : { raw, deviceLocales: readDeviceLocales() };
  } catch {
    // The native read failed: show the device language, and write nothing.
    return {
      raw: SYSTEM_PREFERENCE,
      deviceLocales: readDeviceLocales(),
      unverified: true,
    };
  }
}

/** The native per-app locale, or `undefined` when reading it failed (so nothing should change). */
function readNativeOrUndefined(): string | null | undefined {
  try {
    return readNativeRawPreference();
  } catch {
    return undefined;
  }
}

const sameLocales = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((tag, index) => tag === b[index]);

export function LocalizationProvider({ children }: { children: ReactNode }) {
  const repository = useFinanceRepository();
  const settings = useFinanceSettings();
  const android = isAndroid();
  const [device, setDevice] = useState<DeviceLanguage | null>(readInitial);
  // The value on screen, kept in a ref too so callbacks never read a stale render.
  const deviceRef = useRef(device);
  // What the store holds, as far as this provider knows: updated only when a write succeeds (or
  // a read adopts a newer value), and what the UI falls back to when a write fails.
  const persisted = useRef(device);
  const mounted = useRef(true);
  const settingsRef = useRef(settings);
  useLayoutEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const show = useCallback((next: DeviceLanguage | null) => {
    deviceRef.current = next;
    if (mounted.current) setDevice(next);
  }, []);

  // Every write to the preference store (a user's choice, the migration, a resume re-read) is a
  // job on one queue, so they run strictly in the order they were made and never interleave.
  // `queued` counts jobs not yet settled, the running one included. When the queue drains the
  // screen shows what is persisted, whichever way the last jobs went. On native that is the OS
  // per-app locale itself, the source of truth, which the drain re-reads.
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  const queued = useRef(0);
  const enqueue = useCallback(
    <T,>(job: () => Promise<T>): Promise<T> => {
      queued.current++;
      const run = tail.current.then(job);
      tail.current = run
        .catch(() => undefined)
        .then(() => {
          if (--queued.current > 0) return;
          const raw = readNativeOrUndefined();
          if (raw === undefined) {
            // The read failed, so the native value is unknown: show what this provider knows
            // is persisted, so a choice whose write failed does not stay on screen.
            if (deviceRef.current !== persisted.current)
              show(persisted.current);
            return;
          }
          const known = persisted.current;
          // A successful read also clears `unverified`: the value is now known.
          if (
            raw !== null &&
            (known?.unverified ||
              normalizePreference(raw, android) !==
                normalizePreference(known?.raw, android))
          )
            persisted.current = {
              raw,
              deviceLocales: known?.deviceLocales ?? readDeviceLocales(),
            };
          if (deviceRef.current !== persisted.current) show(persisted.current);
        })
        // The drain reads the native module and the device locales; if that throws, `tail` must
        // still settle, or every later job would wait behind a rejected promise and never run.
        .catch(() => undefined);
      return run;
    },
    [show, android],
  );

  // A value read from the store: it becomes the fallback, and is shown right away when no job
  // is queued (otherwise the drain above shows it).
  const adopt = useCallback(
    (next: DeviceLanguage) => {
      persisted.current = next;
      if (queued.current === 0) show(next);
    },
    [show],
  );

  // Web (and Android without the native module) reads `sync_meta`, which is async. Children
  // render only once it has loaded, so the first frame is never in the wrong language.
  useEffect(() => {
    if (deviceRef.current) return;
    loadStoredRawPreference()
      .then(
        (raw) => ({ raw, unverified: false }),
        // A failed read shows the device language but is not "system": nothing is known about
        // what is stored, so the next choice must always write.
        () => ({ raw: SYSTEM_PREFERENCE, unverified: true }),
      )
      .then(({ raw, unverified }) => {
        // The device locales are read only when the load is still wanted.
        if (!mounted.current) return;
        adopt({
          raw,
          deviceLocales: readDeviceLocales(),
          ...(unverified ? { unverified: true as const } : {}),
        });
      });
  }, [adopt]);

  // The user can change the app language in system Settings while Qashy is backgrounded.
  const rereadNative = useCallback(async () => {
    const raw = readNativeOrUndefined();
    const known = persisted.current;
    if (raw === undefined) {
      // A failed read: nothing is known about the native value, so fall back to what is
      // persisted. Inside a queued job the drain does this once the queue is empty.
      if (queued.current === 0 && deviceRef.current !== persisted.current)
        show(persisted.current);
      return;
    }
    // `null` is not native at all.
    if (raw === null) return;
    const deviceLocales = readDeviceLocales();
    if (
      known &&
      !known.unverified &&
      known.raw === raw &&
      sameLocales(known.deviceLocales, deviceLocales)
    )
      return;
    adopt({ raw, deviceLocales });
  }, [adopt, show]);
  useEffect(() => {
    if (!usesNativeLocale()) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      // Behind a write in flight the native value may still be the old one, so wait for it.
      // A rejection is dropped: the drain after a queued job already shows what is persisted.
      void (
        queued.current === 0 ? rereadNative() : enqueue(rereadNative)
      ).catch(() => undefined);
    });
    return () => subscription.remove();
  }, [enqueue, rereadNative]);

  // One-time: keep the language that was showing before the app followed the device, for
  // someone who had already set Qashy up. A job like any other, so it decides what to write
  // when it runs, after every earlier choice has landed.
  const migrationStarted = useRef(false);
  const loaded = device !== null;
  useEffect(() => {
    if (!loaded || migrationStarted.current) return;
    migrationStarted.current = true;
    enqueue(async () => {
      const { onboardingComplete, locale: legacyLocale } = settingsRef.current;
      const known = persisted.current;
      const written = await migrateLegacyLanguage({
        onboardingComplete,
        legacyLocale,
        deviceLocales: known?.deviceLocales ?? readDeviceLocales(),
      });
      if (written && known)
        adopt({ raw: written, deviceLocales: known.deviceLocales });
    })
      // A failed write leaves `languageMigrated` unset, so the next launch retries it. Until
      // then this session shows what is persisted (the device language), like any other.
      .catch(() => undefined);
  }, [loaded, enqueue, adopt]);

  const preference = normalizePreference(device?.raw, android);
  const deviceLocales = device?.deviceLocales;
  const systemLocale = useMemo(
    () => resolveSystemLocale(deviceLocales ?? [], android),
    [deviceLocales, android],
  );
  const resolvedLocale = useMemo(
    () => resolveLocale(preference, deviceLocales ?? [], android),
    [preference, deviceLocales, android],
  );
  // A Play-translated language (Android only) reads its strings from native resources, loaded
  // once per locale change. Rendering waits for them, so there is no flash of English; a failed
  // load falls back to English and renders anyway. After the first render the screen keeps
  // showing the previous locale until the next one is ready, so a live switch never blinks.
  const targetLanguage = appLanguageFromLocale(resolvedLocale, android);
  const needsTable = targetLanguage !== "en" && targetLanguage !== "he";
  // A new object per finished load, so a table swapped in under an unchanged locale still
  // re-renders the screen.
  const [loadedTable, setLoadedTable] = useState<{ locale: string } | null>(
    null,
  );
  useEffect(() => {
    if (!loaded || !needsTable) return;
    // A table that already loaded is kept: revisiting a locale never reloads it, and so can
    // never replace real translations with the English fallback of a failed read.
    const existing = getNativeTable(resolvedLocale);
    if (existing && existing !== EMPTY_NATIVE_TABLE) return;
    let cancelled = false;
    loadTableWithRetry(resolvedLocale).then((table) => {
      // A read that finished after the user left this locale is still a good read: cache it, so
      // a later visit (whose own load may fail) shows it. Only the state update is gated.
      installNativeTable(resolvedLocale, table);
      if (cancelled) return;
      setLoadedTable({ locale: resolvedLocale });
    });
    return () => {
      cancelled = true;
      // Leaving this locale forgets that its load settled. A failed one left an empty table,
      // and without this a revisit would count as ready at once, show English, and flip when
      // the reload finishes; now the gate holds the previous locale until the reload settles.
      setLoadedTable(null);
    };
  }, [loaded, needsTable, resolvedLocale]);
  const existingTable = needsTable ? getNativeTable(resolvedLocale) : undefined;
  const hasTable =
    existingTable !== undefined && existingTable !== EMPTY_NATIVE_TABLE;
  const ready =
    loaded &&
    (!needsTable || hasTable || loadedTable?.locale === resolvedLocale);
  const [shownLocale, setShownLocale] = useState<string | null>(null);
  if (ready && shownLocale !== resolvedLocale) setShownLocale(resolvedLocale);
  // What the UI is formatted and translated with: the target once its table is in place.
  const locale = ready ? resolvedLocale : (shownLocale ?? resolvedLocale);
  const language = appLanguageFromLocale(locale, android);
  const isRtl = isRtlLocale(locale);
  // Module state read by `translateCurrent`, e.g. from the root error screen. Assigned while
  // rendering, so it is right before any child renders; idempotent, so a discarded render is
  // harmless.
  setCurrentLanguage(language);

  // The newest user choice still queued, so asking for the same thing again shares its outcome.
  const userSeq = useRef(0);
  const lastUser = useRef<{
    id: number;
    raw: string;
    promise: Promise<void>;
  } | null>(null);
  const setPreference = useCallback(
    (next: LanguagePreference) => {
      const normalized = normalizePreference(next, android);
      if (lastUser.current?.raw === normalized) return lastUser.current.promise;
      const known = persisted.current;
      if (
        queued.current === 0 &&
        known &&
        // What is on screen must be what is persisted, or the shortcut would leave an unpersisted
        // choice showing (a failed write followed by a failed read).
        deviceRef.current === known &&
        !known.unverified &&
        normalizePreference(known.raw, android) === normalized &&
        isCanonicalPreference(known.raw, normalized)
      )
        return Promise.resolve();
      const target: DeviceLanguage = {
        raw: normalized,
        deviceLocales: deviceRef.current?.deviceLocales ?? readDeviceLocales(),
      };
      // Shown first: the preference flips at once, and the UI with it for a bundled language.
      // A Play locale keeps the previous strings, locale and RTL until its table has loaded.
      show(target);
      const id = ++userSeq.current;
      const promise = enqueue(async () => {
        try {
          await persistPreference(normalized);
        } catch (reason) {
          // A later choice is already queued and decides the outcome: this one was superseded.
          if (id === userSeq.current) throw reason;
          return;
        }
        persisted.current = target;
      });
      lastUser.current = { id, raw: normalized, promise };
      const settled = () => {
        if (lastUser.current?.id === id) lastUser.current = null;
      };
      promise.then(settled, settled);
      return promise;
    },
    [android, enqueue, show],
  );

  const value = useMemo<LocalizationValue>(
    () => ({
      language,
      locale,
      isRtl,
      t: (message) => translateMessage(message, language),
      preference,
      systemLocale,
      setPreference,
    }),
    // `loadedTable` re-renders consumers when a table is swapped in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      language,
      locale,
      isRtl,
      preference,
      systemLocale,
      setPreference,
      loadedTable,
    ],
  );

  // Repository messages and exports format with the same locale the UI does.
  useLayoutEffect(() => {
    // Not before the preference has loaded: the placeholder locale would be told to the
    // repository for a moment and then corrected.
    if (loaded) repository.setDisplayLocale(locale);
  }, [repository, locale, loaded]);

  // Layout effect, so the document flips in the same commit as the UI.
  useLayoutEffect(() => {
    if (process.env.EXPO_OS === "web" && typeof document !== "undefined") {
      document.documentElement.lang = locale;
      document.documentElement.dir = isRtl ? "rtl" : "ltr";
    }
  }, [language, locale, isRtl]);

  if (!device || (!ready && shownLocale === null)) return null;
  return <LocalizationContext value={value}>{children}</LocalizationContext>;
}

export function translateCurrent(message: string) {
  return translateMessage(message, currentLanguage);
}

export function useLocalization() {
  const value = use(LocalizationContext);
  if (!value)
    throw new Error(
      "useLocalization must be used inside LocalizationProvider.",
    );
  return value;
}
