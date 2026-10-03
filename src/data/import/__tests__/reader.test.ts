import { readCashewBackup } from "../cashew/reader";
import { ImportError } from "../types";
import {
  NODE_SQLITE_AVAILABLE,
  SKIP_MESSAGE,
  SYNTHETIC_EXPECTATIONS,
  buildCashewFixture,
  buildDatabase,
} from "./cashew-fixture";

const describeIfSqlite = NODE_SQLITE_AVAILABLE ? describe : describe.skip;
if (!NODE_SQLITE_AVAILABLE) {
  console.warn(SKIP_MESSAGE);
}

function errorCodeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof ImportError) return error.code;
    throw error;
  }
  return "none";
}

describeIfSqlite("readCashewBackup", () => {
  test("reads the synthetic fixture with version, time zone and blanked settings", () => {
    const raw = readCashewBackup(buildCashewFixture());
    expect(raw.userVersion).toBe(SYNTHETIC_EXPECTATIONS.userVersion);
    expect(raw.detectedTimeZone).toBe(SYNTHETIC_EXPECTATIONS.timeZone);
    expect(raw.tables.wallets).toHaveLength(SYNTHETIC_EXPECTATIONS.wallets);
    expect(raw.tables.categories).toHaveLength(
      SYNTHETIC_EXPECTATIONS.categories,
    );
    expect(raw.tables.transactions).toHaveLength(
      SYNTHETIC_EXPECTATIONS.transactions,
    );
    expect(raw.tables.budgets).toHaveLength(SYNTHETIC_EXPECTATIONS.budgets);
    expect(raw.tables.app_settings).toHaveLength(1);
    expect(raw.tables.app_settings[0].settings_j_s_o_n).toBe("");
  });

  test("missing optional tables become empty arrays", () => {
    const bytes = buildDatabase((db) => {
      db.exec("CREATE TABLE wallets (wallet_pk TEXT, name TEXT)");
      db.exec("CREATE TABLE categories (category_pk TEXT, name TEXT)");
      db.exec("CREATE TABLE transactions (transaction_pk TEXT, amount REAL)");
      db.exec("PRAGMA user_version = 12");
    }).bytes;
    const raw = readCashewBackup(bytes);
    expect(raw.userVersion).toBe(12);
    expect(raw.detectedTimeZone).toBeNull();
    for (const name of [
      "budgets",
      "tags",
      "objectives",
      "app_settings",
      "delete_logs",
    ]) {
      expect(raw.tables[name]).toEqual([]);
    }
  });

  test("a SQLite file without a wallets table is not a Cashew backup", () => {
    const bytes = buildDatabase((db) => {
      db.exec("CREATE TABLE categories (category_pk TEXT)");
      db.exec("CREATE TABLE transactions (transaction_pk TEXT)");
      db.exec("PRAGMA user_version = 48");
    }).bytes;
    expect(errorCodeOf(() => readCashewBackup(bytes))).toBe("not-cashew");
  });

  test("implausible schema versions are unsupported", () => {
    const build = (version: number) =>
      buildDatabase((db) => {
        db.exec("CREATE TABLE wallets (wallet_pk TEXT)");
        db.exec("CREATE TABLE categories (category_pk TEXT)");
        db.exec("CREATE TABLE transactions (transaction_pk TEXT)");
        db.exec(`PRAGMA user_version = ${version}`);
      }).bytes;
    expect(errorCodeOf(() => readCashewBackup(build(0)))).toBe("unsupported");
    expect(errorCodeOf(() => readCashewBackup(build(201)))).toBe("unsupported");
    expect(errorCodeOf(() => readCashewBackup(build(200)))).toBe("none");
  });

  test("ignores invalid or non-string time zones and malformed settings", () => {
    const build = (json: string) =>
      buildDatabase((db) => {
        db.exec("CREATE TABLE wallets (wallet_pk TEXT)");
        db.exec("CREATE TABLE categories (category_pk TEXT)");
        db.exec("CREATE TABLE transactions (transaction_pk TEXT)");
        db.exec(
          "CREATE TABLE app_settings (settings_pk INTEGER PRIMARY KEY, settings_j_s_o_n TEXT)",
        );
        db.prepare(
          "INSERT INTO app_settings (settings_j_s_o_n) VALUES (?)",
        ).run(json);
        db.exec("PRAGMA user_version = 48");
      }).bytes;
    expect(
      readCashewBackup(build('{"timeZone":"Not/AZone"}')).detectedTimeZone,
    ).toBeNull();
    expect(
      readCashewBackup(build('{"timeZone":5}')).detectedTimeZone,
    ).toBeNull();
    expect(readCashewBackup(build("not json")).detectedTimeZone).toBeNull();
    expect(
      readCashewBackup(build('{"nested":{"timeZone":"Asia/Tokyo"}}'))
        .detectedTimeZone,
    ).toBeNull();
    expect(
      readCashewBackup(build('{"a":1,"Time_Zone":"Europe/Paris"}'))
        .detectedTimeZone,
    ).toBe("Europe/Paris");
  });

  test("non-SQLite input is rejected", () => {
    expect(
      errorCodeOf(() => readCashewBackup(new TextEncoder().encode("hello"))),
    ).toBe("not-sqlite");
  });
});

// Optional check against a real backup on the developer's machine. Nothing about its
// contents is asserted beyond table sizes, and the file is never copied into the repo.
const realBackupPath = process.env.CASHEW_BACKUP_PATH;
(realBackupPath ? describe : describe.skip)(
  "readCashewBackup on a real backup (CASHEW_BACKUP_PATH)",
  () => {
    test("reads all tables", () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("node:fs") as typeof import("node:fs");
      const raw = readCashewBackup(
        new Uint8Array(fs.readFileSync(realBackupPath as string)),
      );
      expect(raw.userVersion).toBeGreaterThan(0);
      for (const rows of Object.values(raw.tables)) {
        expect(rows.length).toBeGreaterThanOrEqual(0);
      }
      for (const row of raw.tables.app_settings)
        expect(row.settings_j_s_o_n).toBe("");
      // Counts only, so a run against a private file can be checked without printing content.
      console.log(
        JSON.stringify(
          Object.fromEntries(
            Object.entries(raw.tables).map(([name, rows]) => [
              name,
              rows.length,
            ]),
          ),
        ),
      );
    });
  },
);
