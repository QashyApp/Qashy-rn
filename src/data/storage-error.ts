/**
 * Turns a failure of the platform's storage engine (expo-sqlite on Android, IndexedDB through Dexie
 * on the web) into one of a few sentences Qashy owns and translates. The engines' own messages
 * ("database is locked", "QuotaExceededError") are English diagnostics that no dictionary knows,
 * and they would otherwise reach the screen as written.
 *
 * Pure: it reads only the error's `name` and `message`, and never returns any part of them.
 */

export const STORAGE_BUSY_MESSAGE =
  "The local database is busy. Close other Qashy windows and try again.";
export const STORAGE_FULL_MESSAGE =
  "There is no room left on this device for Qashy’s data. Free some space and try again.";
export const STORAGE_DAMAGED_MESSAGE =
  "The local database is damaged and can’t be opened.";
export const STORAGE_READ_ONLY_MESSAGE =
  "The local database can’t be written to. Check the device storage and try again.";
export const STORAGE_NEWER_VERSION_MESSAGE =
  "The local database was written by a newer version of Qashy. Update the app and try again.";
export const STORAGE_UNAVAILABLE_MESSAGE =
  "Qashy could not open its local database.";
export const STORAGE_UNKNOWN_MESSAGE =
  "Something went wrong with the local database. Restart Qashy and try again.";

/** The error names IndexedDB and Dexie raise, which are matched exactly. */
const NAME_RULES: readonly [RegExp, string][] = [
  [/^(?:QuotaExceededError|Dexie\.QuotaExceededError)$/, STORAGE_FULL_MESSAGE],
  [/^(?:VersionError|Dexie\.VersionError)$/, STORAGE_NEWER_VERSION_MESSAGE],
  [/^(?:BlockedError|Dexie\.BlockedError)$/, STORAGE_BUSY_MESSAGE],
  [
    /^(?:InvalidStateError|UnknownError|AbortError|DatabaseClosedError|OpenFailedError|Dexie\.(?:DatabaseClosedError|OpenFailedError))$/,
    STORAGE_UNAVAILABLE_MESSAGE,
  ],
];

/** The phrases SQLite uses in its result messages, which expo-sqlite passes on as written. */
const MESSAGE_RULES: readonly [RegExp, string][] = [
  [/database or disk is full|SQLITE_FULL/i, STORAGE_FULL_MESSAGE],
  [
    /database disk image is malformed|file is not a database|SQLITE_CORRUPT|SQLITE_NOTADB/i,
    STORAGE_DAMAGED_MESSAGE,
  ],
  [
    /attempt to write a readonly database|SQLITE_READONLY/i,
    STORAGE_READ_ONLY_MESSAGE,
  ],
  [
    /database (?:table )?is locked|SQLITE_BUSY|SQLITE_LOCKED/i,
    STORAGE_BUSY_MESSAGE,
  ],
  [
    /unable to open database file|SQLITE_CANTOPEN|disk I\/O error|SQLITE_IOERR/i,
    STORAGE_UNAVAILABLE_MESSAGE,
  ],
];

/** The sentence for a known storage failure, or `null` when `reason` is not one. */
export function storageFailureMessage(reason: unknown): string | null {
  if (typeof reason !== "object" || reason === null) return null;
  const { name, message } = reason as { name?: unknown; message?: unknown };
  if (typeof name === "string") {
    const byName = NAME_RULES.find(([pattern]) => pattern.test(name));
    if (byName) return byName[1];
  }
  if (typeof message === "string") {
    return (
      MESSAGE_RULES.find(([pattern]) => pattern.test(message))?.[1] ?? null
    );
  }
  return null;
}
