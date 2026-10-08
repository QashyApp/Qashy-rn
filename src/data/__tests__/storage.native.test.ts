import type { StoredEntity } from "@/data/storage-adapter";
import type { Account } from "@/domain/models";

/**
 * `openDatabaseAsync` builds a brand-new native handle on every call — there is no
 * connection cache — so these tests pin the lifecycle rules the adapter has to
 * enforce itself: open once, and never strand a handle when setup fails.
 *
 * Names are `mock`-prefixed because Jest hoists `jest.mock` above the imports and
 * only allows the factory to reach out-of-scope bindings that follow that convention.
 */
class MockDatabase {
  closed = false;
  statements: string[] = [];
  rows = new Map<string, Record<string, unknown>>();
  /** Survives `closeAsync`, the way a file on disk survives closing a connection. */
  userVersion = mockStartVersion;
  /** Table name to column names, as `PRAGMA table_info` would report them. Also survives close. */
  tables = new Map<string, string[]>(
    Object.entries(mockStartTables).map(([name, columns]) => [
      name,
      [...columns],
    ]),
  );

  private pendingVersion: number | null = null;
  private inTransaction = false;

  async execAsync(sql: string) {
    this.statements.push(sql);
    if (mockFailOnExec && sql.includes(mockFailOnExec))
      throw new Error("migration failed");

    // `CREATE TABLE IF NOT EXISTS` creates a table with the columns it declares, and does
    // nothing to a table that is already there, which is the behaviour the migration relies on.
    for (const create of sql.matchAll(
      /CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\s*\);/g,
    )) {
      if (this.tables.has(create[1])) continue;
      const columns = create[2]
        .split("\n")
        .map((line) => line.trim().split(/\s+/)[0])
        .filter((word) => word && !/^(PRIMARY|UNIQUE)$/.test(word))
        .map((word) => word.replace(/,$/, ""));
      this.tables.set(create[1], columns);
    }
    const alter = /ALTER TABLE (\w+) ADD COLUMN (\w+)/.exec(sql);
    if (alter) {
      const columns = this.tables.get(alter[1]);
      if (!columns) throw new Error(`no such table: ${alter[1]}`);
      if (columns.includes(alter[2]))
        throw new Error(`duplicate column name: ${alter[2]}`);
      columns.push(alter[2]);
    }

    const trimmed = sql.trim();
    if (trimmed === "BEGIN IMMEDIATE") {
      this.inTransaction = true;
      this.pendingVersion = null;
      return;
    }
    if (trimmed === "COMMIT") {
      // `user_version` lives in the database header and is transactional, so it only becomes
      // visible on commit. Modelling that is the whole point of this double — a ladder that
      // set it outside the transaction would pass a mock that applied it eagerly.
      if (this.pendingVersion !== null) this.userVersion = this.pendingVersion;
      this.pendingVersion = null;
      this.inTransaction = false;
      return;
    }
    if (trimmed === "ROLLBACK") {
      this.pendingVersion = null;
      this.inTransaction = false;
      return;
    }
    const version = /PRAGMA user_version\s*=\s*(\d+)/.exec(trimmed);
    if (version) {
      const next = Number(version[1]);
      if (this.inTransaction) this.pendingVersion = next;
      else this.userVersion = next;
    }
  }

  async getFirstAsync<T>(sql: string) {
    if (sql.includes("user_version"))
      return { user_version: this.userVersion } as T;
    return null as T;
  }

  async getAllAsync<T>(sql: string) {
    const info = /PRAGMA table_info\((\w+)\)/.exec(sql);
    if (info)
      return (this.tables.get(info[1]) ?? []).map((name) => ({ name })) as T[];
    return [...this.rows.values()] as T[];
  }

  runs: { sql: string; params: unknown[] }[] = [];

  async runAsync(sql: string, ...params: unknown[]) {
    this.runs.push({ sql, params });
  }

  async closeAsync() {
    this.closed = true;
  }
}

const mockOpened: MockDatabase[] = [];
let mockFailOnExec: string | null = null;
let mockStartVersion = 0;
let mockStartTables: Record<string, string[]> = {};

jest.mock("expo-sqlite", () => ({
  openDatabaseAsync: jest.fn(async () => {
    const database = new MockDatabase();
    mockOpened.push(database);
    return database;
  }),
}));

// eslint-disable-next-line import/first -- must be required after `jest.mock` above.
import {
  ADDED_COLUMNS,
  DATABASE_VERSION,
  missingAddedColumns,
  PlatformStorageAdapter,
} from "@/data/storage.native";

/** `sync_peers` as the version-3 ladder built it, before `revoked_seq` existed. */
const LEGACY_SYNC_PEERS = [
  "device_id",
  "name",
  "platform",
  "ed25519_pub",
  "x25519_pub",
  "epoch",
  "added_at",
  "revoked_at",
  "acked",
  "known",
  "last_seen_at",
];

const account = (id: string): Account => ({
  id,
  name: id,
  type: "checking",
  currency: "USD",
  openingBalanceMinor: 0,
  icon: "wallet.bifold",
  color: "#5966E9",
  archived: false,
  revision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
});

const stored = (id: string): StoredEntity => ({
  type: "accounts",
  entity: account(id),
});

describe("native storage adapter lifecycle", () => {
  beforeEach(() => {
    mockOpened.length = 0;
    mockFailOnExec = null;
    mockStartVersion = 0;
    mockStartTables = {};
  });

  it("opens the database exactly once across repeated and concurrent calls", async () => {
    const adapter = new PlatformStorageAdapter();
    await Promise.all([adapter.initialize(), adapter.initialize()]);
    await adapter.initialize();

    expect(mockOpened).toHaveLength(1);
    expect(mockOpened[0].closed).toBe(false);
  });

  it("closes the handle it opened when setup fails, and leaves none stranded on retry", async () => {
    const adapter = new PlatformStorageAdapter();
    mockFailOnExec = "CREATE TABLE";

    await expect(adapter.initialize()).rejects.toThrow("migration failed");
    expect(mockOpened).toHaveLength(1);
    // Without this the first connection leaks: the adapter used to assign
    // `this.database` before migrating and never called `closeAsync`.
    expect(mockOpened[0].closed).toBe(true);

    mockFailOnExec = null;
    await adapter.initialize();
    expect(mockOpened).toHaveLength(2);
    expect(mockOpened[1].closed).toBe(false);
  });

  it("enables WAL before running migrations", async () => {
    const adapter = new PlatformStorageAdapter();
    await adapter.initialize();

    expect(mockOpened[0].statements[0]).toContain("journal_mode = WAL");
  });

  it("refuses reads and writes before initialize()", async () => {
    const adapter = new PlatformStorageAdapter();
    await expect(adapter.readAll("accounts")).rejects.toThrow(
      "has not been initialized",
    );
  });

  it("skips the transaction entirely for an empty batch", async () => {
    const adapter = new PlatformStorageAdapter();
    await adapter.initialize();
    const listener = jest.fn();
    adapter.subscribe(listener);

    await adapter.putMany([]);
    expect(listener).not.toHaveBeenCalled();

    await adapter.putMany([stored("a")], {});
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("native storage migrations", () => {
  beforeEach(() => {
    mockOpened.length = 0;
    mockFailOnExec = null;
    mockStartVersion = 0;
    mockStartTables = {};
  });

  const versionBumps = (database: MockDatabase) =>
    database.statements
      .map((sql) => /PRAGMA user_version\s*=\s*(\d+)/.exec(sql.trim()))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number(match[1]));

  it("creates the whole schema on a fresh database in one step", async () => {
    await new PlatformStorageAdapter().initialize();

    expect(versionBumps(mockOpened[0])).toEqual([DATABASE_VERSION]);
    expect(mockOpened[0].userVersion).toBe(DATABASE_VERSION);
    const schema = mockOpened[0].statements.join(" ");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS sync_ops");
    expect(schema).toContain("revoked_seq");
  });

  it("does nothing at all once the database is current", async () => {
    mockStartVersion = DATABASE_VERSION;
    await new PlatformStorageAdapter().initialize();

    expect(versionBumps(mockOpened[0])).toEqual([]);
    expect(
      mockOpened[0].statements.some((sql) => sql.trim() === "BEGIN IMMEDIATE"),
    ).toBe(false);
  });

  it("leaves the version where it was when the schema fails, and retries cleanly", async () => {
    mockFailOnExec = "sync_ops";

    await expect(new PlatformStorageAdapter().initialize()).rejects.toThrow(
      "migration failed",
    );
    const failed = mockOpened[0];
    // The bump was issued inside the transaction that rolled back, so it never landed. A
    // database that reported itself current with no `sync_ops` table would never repair itself.
    expect(failed.userVersion).toBe(0);
    expect(failed.statements.some((sql) => sql.trim() === "ROLLBACK")).toBe(
      true,
    );
    expect(failed.closed).toBe(true);

    mockFailOnExec = null;
    await new PlatformStorageAdapter().initialize();
    expect(mockOpened[1].userVersion).toBe(DATABASE_VERSION);
  });

  it("adds revoked_seq to a version-3 database and backfills revoked peers, before the version bump", async () => {
    mockStartVersion = 3;
    mockStartTables = { sync_peers: LEGACY_SYNC_PEERS };
    const adapter = new PlatformStorageAdapter();
    await adapter.initialize();

    const database = mockOpened[0];
    expect(database.tables.get("sync_peers")).toContain("revoked_seq");
    const alter = database.statements.findIndex((sql) =>
      sql.includes("ALTER TABLE sync_peers ADD COLUMN revoked_seq INTEGER"),
    );
    const backfill = database.statements.findIndex((sql) =>
      sql.includes("SET revoked_seq = 0 WHERE revoked_at IS NOT NULL"),
    );
    const bump = database.statements.findIndex((sql) =>
      sql.includes("PRAGMA user_version = 4"),
    );
    expect(alter).toBeGreaterThan(-1);
    expect(backfill).toBeGreaterThan(alter);
    expect(bump).toBeGreaterThan(backfill);
    expect(database.userVersion).toBe(DATABASE_VERSION);
  });

  it("does not add or backfill a column that is already present", async () => {
    mockStartVersion = 3;
    mockStartTables = {
      sync_peers: [...LEGACY_SYNC_PEERS, "revoked_seq"],
    };
    await new PlatformStorageAdapter().initialize();

    const statements = mockOpened[0].statements.join("\n");
    expect(statements).not.toContain("ALTER TABLE");
    expect(statements).not.toContain("SET revoked_seq");
    expect(mockOpened[0].userVersion).toBe(DATABASE_VERSION);
  });

  it("creates revoked_seq from the schema on a fresh database without an ALTER", async () => {
    await new PlatformStorageAdapter().initialize();

    expect(
      mockOpened[0].statements.some((sql) => sql.includes("ALTER TABLE")),
    ).toBe(false);
    expect(mockOpened[0].tables.get("sync_peers")).toContain("revoked_seq");
  });

  it("rolls the added column back with the rest of a failed upgrade", async () => {
    mockStartVersion = 3;
    mockStartTables = { sync_peers: LEGACY_SYNC_PEERS };
    mockFailOnExec = "SET revoked_seq";

    await expect(new PlatformStorageAdapter().initialize()).rejects.toThrow(
      "migration failed",
    );
    expect(mockOpened[0].userVersion).toBe(3);
    expect(mockOpened[0].closed).toBe(true);
  });

  it("sets the connection pragmas before touching the schema", async () => {
    await new PlatformStorageAdapter().initialize();

    // All three are per-connection, and this adapter deliberately keeps one connection so a
    // transaction inherits them. `busy_timeout` is what stops a lock contended by the WAL
    // checkpointer from failing outright.
    const [pragmas] = mockOpened[0].statements;
    expect(pragmas).toContain("journal_mode = WAL");
    expect(pragmas).toContain("foreign_keys = ON");
    expect(pragmas).toContain("busy_timeout = 5000");
  });
});

describe("native storage transactions", () => {
  beforeEach(() => {
    mockOpened.length = 0;
    mockFailOnExec = null;
    mockStartVersion = DATABASE_VERSION;
  });

  const ready = async () => {
    const adapter = new PlatformStorageAdapter();
    await adapter.initialize();
    mockOpened[0].statements.length = 0;
    return adapter;
  };

  it("brackets the work in BEGIN IMMEDIATE and COMMIT", async () => {
    const adapter = await ready();
    await adapter.transact(async (tx) => {
      await tx.putMany([stored("a")]);
    });

    const bookends = mockOpened[0].statements.map((sql) => sql.trim());
    expect(bookends[0]).toBe("BEGIN IMMEDIATE");
    expect(bookends.at(-1)).toBe("COMMIT");
  });

  it("rolls back and notifies nobody when the work throws", async () => {
    const adapter = await ready();
    const listener = jest.fn();
    adapter.subscribe(listener);

    await expect(
      adapter.transact(async (tx) => {
        await tx.putMany([stored("a")]);
        throw new Error("batch rejected");
      }),
    ).rejects.toThrow("batch rejected");

    expect(mockOpened[0].statements.map((sql) => sql.trim())).toContain(
      "ROLLBACK",
    );
    expect(listener).not.toHaveBeenCalled();
  });

  it("commits silently when asked", async () => {
    const adapter = await ready();
    const listener = jest.fn();
    adapter.subscribe(listener);

    await adapter.transact(
      async (tx) => {
        await tx.putMany([stored("a")]);
      },
      { silent: true },
    );

    expect(mockOpened[0].statements.map((sql) => sql.trim())).toContain(
      "COMMIT",
    );
    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies nobody for a transaction that only read", async () => {
    const adapter = await ready();
    const listener = jest.fn();
    adapter.subscribe(listener);

    await adapter.transact((tx) => tx.readAll("accounts"));

    expect(mockOpened[0].statements.map((sql) => sql.trim())).toContain(
      "COMMIT",
    );
    expect(listener).not.toHaveBeenCalled();
  });

  it("serialises overlapping transactions rather than interleaving their statements", async () => {
    // One connection means an interleaved BEGIN would either error or silently join the
    // transaction already in flight, so both batches would commit or roll back together.
    const adapter = await ready();
    const order: string[] = [];

    await Promise.all([
      adapter.transact(async (tx) => {
        order.push("first:start");
        await tx.putMany([stored("a")]);
        order.push("first:end");
      }),
      adapter.transact(async (tx) => {
        order.push("second:start");
        await tx.putMany([stored("b")]);
        order.push("second:end");
      }),
    ]);

    expect(order).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });
});

describe("native storage adapter batched writes", () => {
  beforeEach(() => {
    mockOpened.length = 0;
    mockFailOnExec = null;
    mockStartVersion = 0;
    mockStartTables = {};
  });

  it("writes a batch in a few multi-row statements instead of one per record", async () => {
    const adapter = new PlatformStorageAdapter();
    await adapter.initialize();
    const inserts = () =>
      mockOpened[0].runs.filter(({ sql }) =>
        sql.includes("INSERT INTO records"),
      );
    const before = inserts().length;

    await adapter.putMany(
      Array.from({ length: 400 }, (_, index) => stored(`a${index}`)),
    );

    const batches = inserts().slice(before);
    // 900 parameters per statement, five per row: 180 rows each, so 400 rows is 3 statements.
    expect(batches).toHaveLength(3);
    expect(batches.map(({ params }) => params.length / 5)).toEqual([
      180, 180, 40,
    ]);
    expect(batches.every(({ params }) => params.length <= 900)).toBe(true);
    expect(batches[0].params.slice(0, 2)).toEqual(["accounts:a0", "accounts"]);
  });

  it("applies rows in order, so a key repeated in one batch ends on its last value", async () => {
    const adapter = new PlatformStorageAdapter();
    await adapter.initialize();
    const first = stored("same");
    const last = {
      ...stored("same"),
      entity: { ...account("same"), name: "last" },
    };
    await adapter.putMany([first, last]);

    const run = mockOpened[0].runs.filter(({ sql }) =>
      sql.includes("INSERT INTO records"),
    );
    const params = run[run.length - 1].params;
    expect(params).toHaveLength(10);
    expect(JSON.parse(params[2] as string).name).toBe("same");
    expect(JSON.parse(params[7] as string).name).toBe("last");
  });
});

describe("missingAddedColumns", () => {
  it("reports the ladder's ALTER-added column when a table lacks it", () => {
    expect(
      missingAddedColumns({ sync_peers: LEGACY_SYNC_PEERS }).map(
        ({ table, column }) => `${table}.${column}`,
      ),
    ).toEqual(["sync_peers.revoked_seq"]);
  });

  it("reports nothing when every added column is present", () => {
    expect(
      missingAddedColumns({
        sync_peers: [...LEGACY_SYNC_PEERS, "revoked_seq"],
      }),
    ).toEqual([]);
  });

  it("skips a table that is not in the map, because the schema has just created it", () => {
    expect(missingAddedColumns({})).toEqual([]);
  });

  it("returns the given entries rather than the built-in list when asked", () => {
    const extra = [
      { table: "sync_peers", column: "nickname", definition: "TEXT" },
    ];
    expect(
      missingAddedColumns({ sync_peers: LEGACY_SYNC_PEERS }, extra),
    ).toEqual(extra);
    expect(ADDED_COLUMNS.length).toBeGreaterThan(0);
  });
});
