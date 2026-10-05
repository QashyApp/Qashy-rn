import { ImportError, type CashewRawData, type RawRow } from "../types";
import { readSqliteTables, readSqliteUserVersion } from "./sqlite-reader";

const REQUIRED_TABLES = ["wallets", "categories", "transactions"] as const;
const OPTIONAL_TABLES = [
  "budgets",
  "category_budget_limits",
  "objectives",
  "tags",
  "transaction_to_tag_links",
  "associated_titles",
  "scanner_templates",
  "delete_logs",
  "app_settings",
] as const;

// Cashew's schema version starts at 1 and is a small integer. Anything outside this window
// is some other application's database that happens to have tables with similar names.
const MAX_PLAUSIBLE_USER_VERSION = 200;

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// The settings blob carries a time zone in some Cashew versions; most do not record one.
// Only top-level string values under a key that looks like a time zone are considered.
function detectTimeZone(settingsRows: RawRow[]): string | null {
  for (const row of settingsRows) {
    const json = row.settings_j_s_o_n;
    if (typeof json !== "string" || !json) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      continue;
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (
        /time.?zone/i.test(key) &&
        typeof value === "string" &&
        isValidTimeZone(value)
      )
        return value;
    }
  }
  return null;
}

/**
 * Whether Cashew pays subscriptions and repeating transactions on its own once they are due. It
 * does so by default, and on the next launch it pays every one that came due meanwhile and creates
 * the following entry, so an overdue unpaid entry usually means Cashew was not opened, not that the
 * series was abandoned. The preference lives in the same settings blob as the time zone.
 */
function detectAutoPay(settingsRows: RawRow[]) {
  const result: { subscriptions: boolean | null; repetitive: boolean | null } =
    {
      subscriptions: null,
      repetitive: null,
    };
  for (const row of settingsRows) {
    const json = row.settings_j_s_o_n;
    if (typeof json !== "string" || !json) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      continue;
    const settings = parsed as Record<string, unknown>;
    if (typeof settings.automaticallyPaySubscriptions === "boolean")
      result.subscriptions = settings.automaticallyPaySubscriptions;
    if (typeof settings.automaticallyPayRepetitive === "boolean")
      result.repetitive = settings.automaticallyPayRepetitive;
  }
  return result;
}

/**
 * Reads a Cashew backup (a raw SQLite file) into plain rows. It validates only that the
 * file is recognisably Cashew; interpreting the rows is the mapper's job.
 */
export function readCashewBackup(bytes: Uint8Array): CashewRawData {
  const tables = readSqliteTables(bytes);
  const userVersion = readSqliteUserVersion(bytes);

  for (const name of REQUIRED_TABLES) {
    if (!tables[name]) {
      throw new ImportError(
        "not-cashew",
        "This SQLite file does not look like a Cashew backup.",
      );
    }
  }
  if (userVersion === 0 || userVersion > MAX_PLAUSIBLE_USER_VERSION) {
    throw new ImportError(
      "unsupported",
      "This SQLite file does not look like a supported Cashew backup version.",
    );
  }

  const result: Record<string, RawRow[]> = {};
  for (const name of REQUIRED_TABLES) result[name] = tables[name];
  for (const name of OPTIONAL_TABLES) result[name] = tables[name] ?? [];
  // Keep any other tables the backup carries; the mapper simply ignores them.
  for (const [name, rows] of Object.entries(tables)) {
    if (!(name in result)) result[name] = rows;
  }

  const settings = result.app_settings;
  const detectedTimeZone = detectTimeZone(settings);
  const autoPay = detectAutoPay(settings);
  // The settings JSON holds a large cached-currency blob and personal preferences the
  // import never uses, so it is dropped here rather than carried through the app.
  result.app_settings = settings.map((row) => ({
    ...row,
    settings_j_s_o_n: "",
  }));

  return { userVersion, detectedTimeZone, autoPay, tables: result };
}
