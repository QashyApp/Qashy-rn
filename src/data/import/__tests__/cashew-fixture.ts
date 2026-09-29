import type { RawRow, RawValue } from '../types';

/**
 * Builds small SYNTHETIC SQLite files for the import tests using Node's built-in
 * `node:sqlite`. Nothing here is derived from a real backup.
 */

interface NodeStatement {
  run(...params: unknown[]): unknown;
  all(): Record<string, unknown>[];
}

export interface NodeDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeStatement;
  close(): void;
}

interface NodeSqliteModule {
  DatabaseSync: new (path: string) => NodeDatabase;
}

/** `node:sqlite` needs Node 22.5+; older runtimes make the suites skip rather than fail. */
export function loadNodeSqlite(): NodeSqliteModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('node:sqlite') as NodeSqliteModule;
    return typeof loaded.DatabaseSync === 'function' ? loaded : null;
  } catch {
    return null;
  }
}

export const NODE_SQLITE_AVAILABLE = loadNodeSqlite() !== null;
export const SKIP_MESSAGE = 'node:sqlite is unavailable in this Node version; SQLite fixture tests are skipped.';

export interface BuiltDatabase {
  bytes: Uint8Array;
  /** Every user table read back through `node:sqlite` with `SELECT *`, blobs as null. */
  expected: Record<string, RawRow[]>;
}

/**
 * Runs `setup` against a fresh on-disk database, reads the file back, and returns it along
 * with what `node:sqlite` itself reports for every table (the oracle the reader is compared to).
 */
export function buildDatabase(setup: (db: NodeDatabase) => void): BuiltDatabase {
  const sqlite = loadNodeSqlite();
  if (!sqlite) throw new Error(SKIP_MESSAGE);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('node:os') as typeof import('node:os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qashy-import-fixture-'));
  const file = path.join(dir, 'fixture.db');
  try {
    const db = new sqlite.DatabaseSync(file);
    const expected: Record<string, RawRow[]> = {};
    try {
      setup(db);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all();
      for (const { name } of tables) {
        const rows = db.prepare(`SELECT * FROM "${String(name)}" ORDER BY rowid`).all();
        expected[String(name)] = rows.map((row) => {
          const copy: RawRow = {};
          for (const [key, value] of Object.entries(row)) {
            copy[key] = typeof value === 'string' || typeof value === 'number' ? (value as RawValue) : null;
          }
          return copy;
        });
      }
    } finally {
      db.close();
    }
    const bytes = new Uint8Array(fs.readFileSync(file));
    return { bytes, expected };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const NOW_DEFAULT = "DEFAULT (CAST(strftime('%s', CURRENT_TIMESTAMP) AS INTEGER))";

// Column lists follow Cashew's schema (drift-generated, quoted identifiers, defaults that
// contain nested parentheses and commas). NOT NULL / defaults are simplified.
const CASHEW_DDL = [
  `CREATE TABLE "wallets" ("wallet_pk" TEXT NOT NULL, "name" TEXT NOT NULL, "colour" TEXT NULL, "icon_name" TEXT NULL, "emoji_icon_name" TEXT NULL, "date_created" INTEGER NOT NULL ${NOW_DEFAULT}, "date_time_modified" INTEGER NULL ${NOW_DEFAULT}, "order" INTEGER NOT NULL, "currency" TEXT NULL, "currency_format" TEXT NULL, "decimals" INTEGER NOT NULL DEFAULT 2, "archived" INTEGER NOT NULL DEFAULT 0, "home_page_widget_display" TEXT NULL, PRIMARY KEY ("wallet_pk"))`,
  `CREATE TABLE "categories" ("category_pk" TEXT NOT NULL, "name" TEXT NOT NULL, "colour" TEXT NULL, "icon_name" TEXT NULL, "emoji_icon_name" TEXT NULL, "date_created" INTEGER NOT NULL ${NOW_DEFAULT}, "date_time_modified" INTEGER NULL ${NOW_DEFAULT}, "order" INTEGER NOT NULL, "income" INTEGER NOT NULL DEFAULT 0, "method_added" INTEGER NULL, "main_category_pk" TEXT NULL, "archived" INTEGER NOT NULL DEFAULT 0, PRIMARY KEY ("category_pk"))`,
  `CREATE TABLE "transactions" ("transaction_pk" TEXT NOT NULL, "paired_transaction_fk" TEXT NULL, "name" TEXT NOT NULL, "amount" REAL NOT NULL, "note" TEXT NOT NULL, "category_fk" TEXT NOT NULL, "sub_category_fk" TEXT NULL, "wallet_fk" TEXT NOT NULL DEFAULT '0', "date_created" INTEGER NOT NULL ${NOW_DEFAULT}, "date_time_modified" INTEGER NULL ${NOW_DEFAULT}, "original_date_due" INTEGER NULL, "income" INTEGER NOT NULL DEFAULT 0, "period_length" INTEGER NULL, "reoccurrence" INTEGER NULL, "end_date" INTEGER NULL, "upcoming_transaction_notification" INTEGER NULL DEFAULT 1, "type" INTEGER NULL, "paid" INTEGER NOT NULL DEFAULT 0, "created_another_future_transaction" INTEGER NULL DEFAULT 0, "skip_paid" INTEGER NOT NULL DEFAULT 0, "method_added" INTEGER NULL, "transaction_owner_email" TEXT NULL, "transaction_original_owner_email" TEXT NULL, "shared_key" TEXT NULL, "shared_old_key" TEXT NULL, "shared_status" INTEGER NULL, "shared_date_updated" INTEGER NULL, "shared_reference_budget_pk" TEXT NULL, "objective_fk" TEXT NULL, "objective_loan_fk" TEXT NULL, "budget_fks_exclude" TEXT NULL, PRIMARY KEY ("transaction_pk"))`,
  `CREATE TABLE "budgets" ("budget_pk" TEXT NOT NULL, "name" TEXT NOT NULL, "amount" REAL NOT NULL, "colour" TEXT NULL, "start_date" INTEGER NOT NULL, "end_date" INTEGER NOT NULL, "wallet_fks" TEXT NULL, "category_fks" TEXT NULL, "category_fks_exclude" TEXT NULL, "income" INTEGER NOT NULL DEFAULT 0, "archived" INTEGER NOT NULL DEFAULT 0, "added_transactions_only" INTEGER NOT NULL DEFAULT 0, "period_length" INTEGER NOT NULL, "reoccurrence" INTEGER NULL, "date_created" INTEGER NOT NULL ${NOW_DEFAULT}, "date_time_modified" INTEGER NULL ${NOW_DEFAULT}, "pinned" INTEGER NOT NULL DEFAULT 0, "order" INTEGER NOT NULL, "wallet_fk" TEXT NOT NULL DEFAULT '0', "budget_transaction_filters" TEXT NULL, "member_transaction_filters" TEXT NULL, "shared_key" TEXT NULL, "shared_owner_member" INTEGER NULL, "shared_date_updated" INTEGER NULL, "shared_members" TEXT NULL, "shared_all_members_ever" TEXT NULL, "is_absolute_spending_limit" INTEGER NOT NULL DEFAULT 0, PRIMARY KEY ("budget_pk"))`,
  `CREATE TABLE "category_budget_limits" ("category_limit_pk" TEXT NOT NULL, "category_fk" TEXT NOT NULL, "budget_fk" TEXT NOT NULL, "amount" REAL NOT NULL, "date_time_modified" INTEGER NULL ${NOW_DEFAULT}, PRIMARY KEY ("category_limit_pk"))`,
  `CREATE TABLE "objectives" ("objective_pk" TEXT NOT NULL, "name" TEXT NOT NULL, "amount" REAL NOT NULL, "order" INTEGER NOT NULL, "colour" TEXT NULL, "date_created" INTEGER NOT NULL ${NOW_DEFAULT}, "end_date" INTEGER NULL, "date_time_modified" INTEGER NULL ${NOW_DEFAULT}, "icon_name" TEXT NULL, "emoji_icon_name" TEXT NULL, "income" INTEGER NOT NULL DEFAULT 0, "pinned" INTEGER NOT NULL DEFAULT 1, "archived" INTEGER NOT NULL DEFAULT 0, "wallet_fk" TEXT NOT NULL DEFAULT '0', PRIMARY KEY ("objective_pk"))`,
  `CREATE TABLE "tags" ("tag_pk" TEXT NOT NULL, "name" TEXT NOT NULL, "colour" TEXT NULL, "date_created" INTEGER NOT NULL ${NOW_DEFAULT}, "order" INTEGER NOT NULL DEFAULT 0, PRIMARY KEY ("tag_pk"))`,
  `CREATE TABLE "transaction_to_tag_links" ("transaction_pk" TEXT NOT NULL, "tag_pk" TEXT NOT NULL)`,
  `CREATE TABLE "associated_titles" ("associated_title_pk" TEXT NOT NULL, "title" TEXT NOT NULL, "category_fk" TEXT NOT NULL, "date_created" INTEGER NOT NULL ${NOW_DEFAULT}, "order" INTEGER NOT NULL, "is_exact_match" INTEGER NOT NULL DEFAULT 0, PRIMARY KEY ("associated_title_pk"))`,
  `CREATE TABLE "scanner_templates" ("scanner_template_pk" TEXT NOT NULL, "date_created" INTEGER NOT NULL ${NOW_DEFAULT}, "template_name" TEXT NOT NULL, "contains" TEXT NOT NULL, "title_transaction_before" TEXT NOT NULL, "title_transaction_after" TEXT NOT NULL, "amount_transaction_before" TEXT NOT NULL, "amount_transaction_after" TEXT NOT NULL, "default_category_fk" TEXT NOT NULL, "wallet_fk" TEXT NOT NULL DEFAULT '0', "ignore" INTEGER NOT NULL DEFAULT 0, PRIMARY KEY ("scanner_template_pk"))`,
  `CREATE TABLE "delete_logs" ("delete_log_pk" TEXT NOT NULL, "entry_pk" TEXT NOT NULL, "type" INTEGER NOT NULL, "date_time_modified" INTEGER NULL ${NOW_DEFAULT}, PRIMARY KEY ("delete_log_pk"))`,
  `CREATE TABLE "app_settings" ("settings_pk" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "settings_j_s_o_n" TEXT NOT NULL, "date_updated" INTEGER NOT NULL ${NOW_DEFAULT})`,
];

/** Integer edge values that straddle every SQLite serial-type width. */
export const INTEGER_EDGE_VALUES = [
  0, 1, 127, 128, 255, 256, 32767, 32768, 65535, 8388607, 8388608, 2147483647, 2147483648, 549755813887,
  549755813888, 140737488355327, 140737488355328, Number.MAX_SAFE_INTEGER, -1, -128, -129, -32768, -32769,
  -8388608, -8388609, -2147483648, -2147483649, -549755813888, -549755813889, -140737488355328,
  -140737488355329, -Number.MAX_SAFE_INTEGER,
];

export const REAL_EDGE_VALUES = [1454.35, -0.1, 1e-7, Math.PI, 1e21, -2.5, 5, 0.5, -1454.35, 123456789.123456];

export const SYNTHETIC_EXPECTATIONS = {
  userVersion: 48,
  timeZone: 'Asia/Jerusalem',
  transactions: 300,
  wallets: 2,
  categories: 6,
  budgets: 1,
  tags: 2,
  hebrewWalletName: 'ארנק משפחתי',
  hebrewNote: 'שלום עולם – קניות בסופר 🛒',
  realAmount: 1454.35,
  longNoteLength: 0,
  settingsJsonLength: 0,
};

const LONG_NOTE = 'שלום world — long note with mixed text. '.repeat(160) + 'END';
SYNTHETIC_EXPECTATIONS.longNoteLength = LONG_NOTE.length;

const SETTINGS_JSON = JSON.stringify({
  theme: 'dark',
  timeZone: 'Asia/Jerusalem',
  // Stands in for Cashew's cached exchange-rate blob: large enough to need overflow pages.
  cachedCurrencyExchange: Object.fromEntries(
    Array.from({ length: 700 }, (_, index) => [`cur${index}`, 1 + index / 1000]),
  ),
});
SYNTHETIC_EXPECTATIONS.settingsJsonLength = SETTINGS_JSON.length;

function insert(db: NodeDatabase, table: string, row: Record<string, unknown>): void {
  const columns = Object.keys(row);
  const sql = `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${columns
    .map(() => '?')
    .join(', ')})`;
  db.prepare(sql).run(...columns.map((c) => row[c]));
}

/** A synthetic, Cashew-shaped backup: every table, overflow rows, and a multi-page b-tree. */
export function buildCashewFixtureWithExpected(pageSize = 4096): BuiltDatabase {
  return buildDatabase((db) => {
    db.exec(`PRAGMA page_size = ${pageSize}`);
    for (const ddl of CASHEW_DDL) db.exec(ddl);

    insert(db, 'wallets', {
      wallet_pk: '0',
      name: 'Main wallet',
      colour: '0xff3366cc',
      icon_name: 'coins.png',
      emoji_icon_name: null,
      order: 0,
      currency: 'usd',
      decimals: 2,
    });
    insert(db, 'wallets', {
      wallet_pk: 'w-2',
      name: SYNTHETIC_EXPECTATIONS.hebrewWalletName,
      colour: null,
      icon_name: null,
      emoji_icon_name: null,
      order: 1,
      currency: null,
      decimals: 2,
      archived: 1,
    });

    const categories: [string, string, number, string | null][] = [
      ['c-food', 'Food', 0, null],
      ['c-cafe', 'קפה', 0, 'c-food'],
      ['c-home', 'Home', 0, null],
      ['c-salary', 'Salary', 1, null],
      ['c-bonus', 'Bonus', 1, 'c-salary'],
      ['c-misc', 'Misc', 0, null],
    ];
    categories.forEach(([pk, name, income, parent], order) =>
      insert(db, 'categories', {
        category_pk: pk,
        name,
        colour: order % 2 === 0 ? '0xffaa5500' : null,
        icon_name: 'icon.png',
        emoji_icon_name: null,
        order,
        income,
        main_category_pk: parent,
      }),
    );

    for (let i = 0; i < SYNTHETIC_EXPECTATIONS.transactions; i += 1) {
      const income = i % 5 === 0 ? 1 : 0;
      const magnitude = Math.round((i * 7.13 + 3.07) * 100) / 100;
      insert(db, 'transactions', {
        transaction_pk: `t-${String(i).padStart(4, '0')}`,
        paired_transaction_fk: null,
        name: i % 3 === 0 ? '' : `Synthetic ${i} ${i % 4 === 0 ? 'שלום' : 'hello'}`,
        amount: i === 0 ? SYNTHETIC_EXPECTATIONS.realAmount : income ? magnitude : -magnitude,
        note: i === 1 ? LONG_NOTE : i === 2 ? SYNTHETIC_EXPECTATIONS.hebrewNote : i % 7 === 0 ? '' : `note ${i}`,
        category_fk: income ? 'c-salary' : i % 2 ? 'c-food' : 'c-home',
        sub_category_fk: i % 9 === 0 ? (income ? 'c-bonus' : 'c-cafe') : null,
        wallet_fk: i % 11 === 0 ? 'w-2' : '0',
        // 4102444800 (year 2100) needs a 5-byte integer, unlike the 4-byte 2025-era values.
        date_created: i === 3 ? 4102444800 : 1735689600 + i * 86400,
        original_date_due: i % 4 === 0 ? null : 1735689600 + i * 86400,
        income,
        period_length: i % 13 === 0 ? 1 : null,
        reoccurrence: i % 13 === 0 ? 3 : null,
        end_date: null,
        type: i % 13 === 0 ? 1 : null,
        paid: i % 10 === 4 ? 0 : 1,
        skip_paid: i % 10 === 4 ? 1 : 0,
        objective_fk: null,
        budget_fks_exclude: null,
      });
    }

    insert(db, 'budgets', {
      budget_pk: 'b-1',
      name: 'Monthly',
      amount: 2500.5,
      colour: '0xff00aa55',
      start_date: 1735689600,
      end_date: 1738368000,
      wallet_fks: null,
      category_fks: '[]',
      category_fks_exclude: '[]',
      period_length: 1,
      reoccurrence: 3,
      order: 0,
      budget_transaction_filters: '[0,1]',
    });
    insert(db, 'category_budget_limits', {
      category_limit_pk: 'l-1',
      category_fk: 'c-food',
      budget_fk: 'b-1',
      amount: 400,
    });
    insert(db, 'tags', { tag_pk: 'g-1', name: 'Trip', colour: '0xffff0000', order: 0 });
    insert(db, 'tags', { tag_pk: 'g-2', name: 'חופשה', colour: null, order: 1 });
    insert(db, 'transaction_to_tag_links', { transaction_pk: 't-0001', tag_pk: 'g-1' });
    insert(db, 'transaction_to_tag_links', { transaction_pk: 't-0002', tag_pk: 'g-2' });
    for (let i = 0; i < 5; i += 1) {
      insert(db, 'associated_titles', {
        associated_title_pk: `a-${i}`,
        title: `title ${i}`,
        category_fk: 'c-food',
        order: i,
        is_exact_match: i % 2,
      });
    }
    insert(db, 'delete_logs', { delete_log_pk: 'd-1', entry_pk: 't-9999', type: 0 });
    insert(db, 'app_settings', { settings_j_s_o_n: SETTINGS_JSON });

    db.exec('PRAGMA user_version = 48');
  });
}

/** Same as {@link buildCashewFixtureWithExpected} but only the file bytes. */
export function buildCashewFixture(): Uint8Array {
  return buildCashewFixtureWithExpected().bytes;
}

/** Tables that stress the value decoder: integer widths, floats, blobs, rowid alias, ALTER TABLE. */
export function buildEdgeCaseFixture(pageSize = 4096): BuiltDatabase {
  return buildDatabase((db) => {
    db.exec(`PRAGMA page_size = ${pageSize}`);
    db.exec(
      'CREATE TABLE "int_edges" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "value" INTEGER, "note" TEXT)',
    );
    db.exec('CREATE TABLE "real_edges" ("id" INTEGER PRIMARY KEY, "value" REAL, "label" TEXT NULL)');
    db.exec('CREATE TABLE "blobs" ("id" INTEGER PRIMARY KEY, "data" BLOB, "after" TEXT)');
    db.exec('CREATE TABLE "evolved" ("a" TEXT, "b" INTEGER)');
    db.exec(
      'CREATE TABLE "odd_names" ([bracketed] TEXT, `tick` TEXT, "with, comma (x)" TEXT, plain TEXT DEFAULT (1 + (2)), CHECK (length(plain) < 9999), UNIQUE ([bracketed]))',
    );
    INTEGER_EDGE_VALUES.forEach((value, index) => {
      insert(db, 'int_edges', { value, note: `n${index}` });
    });
    insert(db, 'int_edges', { value: null, note: null });
    REAL_EDGE_VALUES.forEach((value) => insert(db, 'real_edges', { value, label: null }));
    db.prepare('INSERT INTO "blobs" ("data", "after") VALUES (?, ?)').run(new Uint8Array([1, 2, 3, 250]), 'kept');
    db.prepare('INSERT INTO "blobs" ("data", "after") VALUES (?, ?)').run(new Uint8Array(0), 'empty');
    insert(db, 'evolved', { a: 'old row', b: 7 });
    db.exec('ALTER TABLE "evolved" ADD COLUMN "c" TEXT');
    db.exec('ALTER TABLE "evolved" ADD COLUMN "d" REAL');
    insert(db, 'evolved', { a: 'new row', b: 8, c: 'added', d: 1.5 });
    insert(db, 'odd_names', {
      bracketed: 'x',
      tick: 'y',
      'with, comma (x)': 'z',
      plain: 'p',
    });
  });
}
