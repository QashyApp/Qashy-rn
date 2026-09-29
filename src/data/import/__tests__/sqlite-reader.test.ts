import { readSqliteTables, readSqliteUserVersion } from '../cashew/sqlite-reader';
import { ImportError } from '../types';
import {
  INTEGER_EDGE_VALUES,
  NODE_SQLITE_AVAILABLE,
  REAL_EDGE_VALUES,
  SKIP_MESSAGE,
  SYNTHETIC_EXPECTATIONS,
  buildCashewFixtureWithExpected,
  buildEdgeCaseFixture,
  buildDatabase,
} from './cashew-fixture';

const describeIfSqlite = NODE_SQLITE_AVAILABLE ? describe : describe.skip;
if (!NODE_SQLITE_AVAILABLE) {
  console.warn(SKIP_MESSAGE);
}

function expectImportError(action: () => unknown, code: string) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError);
    expect((error as ImportError).code).toBe(code);
    return;
  }
  throw new Error(`Expected an ImportError with code ${code}`);
}

describeIfSqlite('sqlite reader', () => {
  // 512 is the smallest legal page (heavy overflow chains), 65536 is stored as the value 1.
  describe.each([512, 1024, 4096, 65536])('page size %i', (pageSize) => {
    test('reads every table of the Cashew-shaped fixture identically to node:sqlite', () => {
      const { bytes, expected } = buildCashewFixtureWithExpected(pageSize);
      const tables = readSqliteTables(bytes);
      expect(Object.keys(tables).sort()).toEqual(Object.keys(expected).sort());
      for (const [name, rows] of Object.entries(expected)) {
        expect(tables[name]).toHaveLength(rows.length);
        expect(tables[name]).toEqual(rows);
      }
      expect(readSqliteUserVersion(bytes)).toBe(SYNTHETIC_EXPECTATIONS.userVersion);
    });

    test('decodes integer widths, floats, blobs, rowid aliases and ALTER TABLE rows', () => {
      const { bytes, expected } = buildEdgeCaseFixture(pageSize);
      const tables = readSqliteTables(bytes);
      for (const [name, rows] of Object.entries(expected)) {
        expect(tables[name]).toEqual(rows);
      }
    });
  });

  test('fixture exercises overflow pages, an interior b-tree page and the expected counts', () => {
    const { bytes, expected } = buildCashewFixtureWithExpected(1024);
    const tables = readSqliteTables(bytes);
    expect(tables.transactions).toHaveLength(SYNTHETIC_EXPECTATIONS.transactions);
    expect(tables.wallets).toHaveLength(SYNTHETIC_EXPECTATIONS.wallets);
    expect(tables.categories).toHaveLength(SYNTHETIC_EXPECTATIONS.categories);
    expect(tables.budgets).toHaveLength(SYNTHETIC_EXPECTATIONS.budgets);
    expect(tables.tags).toHaveLength(SYNTHETIC_EXPECTATIONS.tags);
    // Page 1 alone is 1 KiB, so 300 transactions can only fit with an interior page above leaves.
    expect(bytes.length).toBeGreaterThan(1024 * 20);
    expect(expected.transactions).toHaveLength(300);
  });

  test('keeps a long multi-page note and Hebrew text intact', () => {
    const { bytes } = buildCashewFixtureWithExpected(1024);
    const { transactions, wallets, app_settings: settings } = readSqliteTables(bytes);
    const long = transactions.find((row) => row.transaction_pk === 't-0001');
    expect(typeof long?.note).toBe('string');
    expect((long?.note as string).length).toBe(SYNTHETIC_EXPECTATIONS.longNoteLength);
    expect((long?.note as string).endsWith('END')).toBe(true);
    expect((long?.note as string).startsWith('שלום world')).toBe(true);
    expect(wallets[1].name).toBe(SYNTHETIC_EXPECTATIONS.hebrewWalletName);
    const hebrew = transactions.find((row) => row.transaction_pk === 't-0002');
    expect(hebrew?.note).toBe(SYNTHETIC_EXPECTATIONS.hebrewNote);
    expect((settings[0].settings_j_s_o_n as string).length).toBe(SYNTHETIC_EXPECTATIONS.settingsJsonLength);
    expect(settings[0].settings_pk).toBe(1);
  });

  test('preserves REAL amounts and NULLs', () => {
    const { bytes } = buildCashewFixtureWithExpected();
    const { transactions, wallets } = readSqliteTables(bytes);
    expect(transactions[0].amount).toBe(SYNTHETIC_EXPECTATIONS.realAmount);
    expect(transactions.some((row) => typeof row.amount === 'number' && row.amount < 0)).toBe(true);
    expect(wallets[1].colour).toBeNull();
    expect(wallets[1].currency).toBeNull();
    expect(transactions[3].date_created).toBe(4102444800);
  });

  test('returns exact values for every integer width and edge float', () => {
    const { bytes } = buildEdgeCaseFixture();
    const { int_edges: ints, real_edges: reals, blobs, evolved, odd_names: odd } = readSqliteTables(bytes);
    expect(ints.slice(0, INTEGER_EDGE_VALUES.length).map((row) => row.value)).toEqual(INTEGER_EDGE_VALUES);
    // INTEGER PRIMARY KEY AUTOINCREMENT is stored as NULL and must come back as the rowid.
    expect(ints.map((row) => row.id)).toEqual(ints.map((_, index) => index + 1));
    expect(ints[ints.length - 1].value).toBeNull();
    expect(reals.map((row) => row.value)).toEqual(REAL_EDGE_VALUES);
    expect(reals.map((row) => row.id)).toEqual(reals.map((_, index) => index + 1));
    // Blobs are dropped but must not shift the columns after them.
    expect(blobs).toEqual([
      { id: 1, data: null, after: 'kept' },
      { id: 2, data: null, after: 'empty' },
    ]);
    // Rows written before ALTER TABLE ADD COLUMN have fewer values than columns.
    expect(evolved).toEqual([
      { a: 'old row', b: 7, c: null, d: null },
      { a: 'new row', b: 8, c: 'added', d: 1.5 },
    ]);
    // Quoting styles, commas inside names, and table-level constraints in the column list.
    expect(odd).toEqual([{ bracketed: 'x', tick: 'y', 'with, comma (x)': 'z', plain: 'p' }]);
  });

  test('empty tables read as empty arrays', () => {
    const { bytes } = buildDatabase((db) => {
      db.exec('CREATE TABLE empty_one (a TEXT, b INTEGER)');
    });
    expect(readSqliteTables(bytes)).toEqual({ empty_one: [] });
  });

  test('skips sqlite_ internal tables', () => {
    const { bytes } = buildEdgeCaseFixture();
    expect(Object.keys(readSqliteTables(bytes))).not.toContain('sqlite_sequence');
  });

  test('rejects input that is not a SQLite database', () => {
    expectImportError(() => readSqliteTables(new TextEncoder().encode('id,amount\n1,2\n')), 'not-sqlite');
    expectImportError(() => readSqliteTables(new Uint8Array(0)), 'not-sqlite');
    expectImportError(() => readSqliteUserVersion(new Uint8Array(200)), 'not-sqlite');
  });

  test('rejects a truncated file as corrupt', () => {
    const { bytes } = buildCashewFixtureWithExpected(1024);
    expectImportError(() => readSqliteTables(bytes.subarray(0, Math.floor(bytes.length / 2))), 'corrupt');
    expectImportError(() => readSqliteTables(bytes.subarray(0, 60)), 'corrupt');
  });

  test('rejects a file whose pages are garbage as corrupt, never crashing', () => {
    const { bytes } = buildCashewFixtureWithExpected(1024);
    const damaged = new Uint8Array(bytes);
    // Keep the 100-byte header intact but scramble the rest of page 1 and every later page.
    for (let i = 100; i < damaged.length; i += 1) damaged[i] = (i * 31) & 0xff;
    expectImportError(() => readSqliteTables(damaged), 'corrupt');
  });

  test('rejects UTF-16 databases as unsupported', () => {
    const { bytes } = buildDatabase((db) => {
      db.exec('PRAGMA encoding = "UTF-16le"');
      db.exec('CREATE TABLE t (a TEXT)');
      db.exec("INSERT INTO t VALUES ('x')");
    });
    expectImportError(() => readSqliteTables(bytes), 'unsupported');
  });
});
