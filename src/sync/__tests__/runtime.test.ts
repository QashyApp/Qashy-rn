/**
 * What the runtime decides, which is a different question from what the pieces do.
 *
 * `session.test.ts` proves a pass; the transport suites prove each wire. What is left — and
 * what only exists here — is the wiring itself, and every one of its decisions is one a user
 * would notice if it went the other way:
 *
 * - **A device that has not been paired must not act as if it had.** "Sync is on" with an
 *   empty keystore is a screen that says everything is fine while nothing has ever left the
 *   device, and it is indistinguishable from working until the day you need the other copy.
 * - **Switching sync off has to close things.** An "off" that keeps polling a relay is not
 *   off.
 * - **Blanking the relay address has to contact nothing.** That claim is the reason the field
 *   is editable at all, so it is asserted against the actual object graph rather than the UI.
 * - **A transport has to survive a pass.** A runtime that rebuilt its transports every
 *   foreground would throw away the relay's backoff and health state each time.
 * - **…but not survive a change it was built from.** Reuse that outlived a rotated key or a
 *   replaced relay address would sync to the wrong place under the wrong key, silently.
 *
 * The keys, the derivations, the storage, and the health cache are all real. Only the network
 * and the finance repository are doubles.
 */

import { MemoryStorageAdapter } from "@/data/memory-storage";
import {
  SYNC_META,
  readMeta,
  writeMeta,
  type SyncMetaKey,
} from "@/data/sync-store";
import type { ApplyResult } from "@/data/repository";
import type { StoredEntity } from "@/data/storage-adapter";
import type { EntityType, FinanceEntity } from "@/domain/models";
import {
  createDeviceIdentity,
  createVaultRootKey,
  deriveBucketId,
  ROUTE_DAY_MS,
  deriveBucketToken,
  deriveRouteTag,
  routeDayOf,
  toBase64Url,
  type DeviceIdentity,
  type VaultRootKey,
} from "@/sync/crypto";
import { MemoryKeystore } from "@/sync/keystore";
import { toPeerRow, type Peer } from "@/sync/engine/roster";
import type { SyncOpBody } from "@/sync/oplog";
import { account, settings, transaction } from "@/sync/oplog/__tests__/helpers";
import { SyncRuntime, type SyncRuntimeDeps } from "@/sync/runtime";
import {
  INITIAL_EPOCH,
  adoptVault,
  enableSync,
  recordPairedPeer,
  type SyncSetupDeps,
} from "@/sync/setup";
import {
  fetchDouble,
  type FetchDouble,
  type Reply,
} from "@/sync/transport/__tests__/http-double";

const RELAY = "https://relay.example.com";
const NOW = Date.parse("2026-06-01T12:00:00.000Z");
const NOW_ISO = new Date(NOW).toISOString();

/**
 * One pass's worth of relay traffic: an empty bucket, an accepted upload, a healthy probe.
 *
 * The bucket read has to answer with a `blobs` array specifically — anything else is a
 * malformed-response rejection and the pass never reaches its upload. The double serves
 * replies in order and then repeats the last one, so a two-pass test queues two of these and
 * the trailing probe covers whatever follows.
 */
const PASS: readonly Reply[] = [
  { kind: "json", body: { blobs: [] } },
  { kind: "status", status: 200 },
  { kind: "json", body: { ok: true, version: 2 } },
];

/**
 * Nothing to merge and nothing to repair.
 *
 * The finance core's behaviour on a merge is `convergence.test.ts`'s subject; here it would
 * only add a second reason for a failure and make the first one harder to find.
 */
const repository = {
  applyRemoteOps: (): Promise<ApplyResult> =>
    Promise.resolve({ applied: 0, changedTypes: [], repairs: [] }),
  repairProjection: (): Promise<ApplyResult> =>
    Promise.resolve({ applied: 0, changedTypes: [], repairs: [] }),
};

interface Rig {
  readonly runtime: SyncRuntime;
  readonly storage: MemoryStorageAdapter;
  readonly keystore: MemoryKeystore;
  readonly http: FetchDouble;
  readonly vaultKey: VaultRootKey;
  readonly deviceId: string;
  readonly peerIds: readonly string[];
  /** The first peer, for the tests that only have one. */
  readonly peerId: string;
  /** Rewrites `sync_meta` the way the settings screen will. */
  set(entries: Partial<Record<SyncMetaKey, string>>): Promise<void>;
}

interface RigOptions {
  readonly enabled?: boolean;
  readonly relayUrl?: string;
  readonly paired?: boolean;
  readonly peers?: number;
  readonly replies?: readonly Reply[];
  readonly over?: Partial<SyncRuntimeDeps>;
}

/** A roster entry whose `deviceId` really is the fingerprint of its own signing key. */
const peerAt = (index: number): Peer => {
  const identity = createDeviceIdentity();
  return {
    deviceId: identity.deviceId,
    name: `Device ${index + 1}`,
    platform: "test",
    signingKey: identity.signing.publicKey,
    agreementKey: identity.agreement.publicKey,
    epoch: 1,
    addedAt: NOW_ISO,
    revokedAt: null,
    revokedSeq: null,
    acked: {},
    known: {},
    lastSeenAt: null,
  };
};

const rig = async ({
  enabled = true,
  relayUrl = RELAY,
  paired = true,
  peers = 1,
  replies = PASS,
  over = {},
}: RigOptions = {}): Promise<Rig> => {
  const storage = new MemoryStorageAdapter();
  await storage.initialize();

  const vaultKey = createVaultRootKey();
  const identity = createDeviceIdentity();
  const keystore = new MemoryKeystore();
  if (paired) await keystore.write({ vaultKey, identity, epoch: 1 });

  const roster = Array.from({ length: peers }, (_unused, index) =>
    peerAt(index),
  );
  await storage.transact(async (tx) => {
    await writeMeta(tx, {
      [SYNC_META.deviceId]: identity.deviceId,
      [SYNC_META.epoch]: "1",
      [SYNC_META.baseCurrency]: "USD",
      [SYNC_META.relayUrl]: relayUrl,
      ...(enabled ? { [SYNC_META.enabled]: "1" } : {}),
    });
    await tx.table("syncPeers").put(roster.map(toPeerRow));
  });

  const http = fetchDouble(...replies);
  const runtime = new SyncRuntime({
    storage,
    repository,
    keystore,
    fetch: http.fetch,
    now: () => NOW,
    nowIso: () => NOW_ISO,
    uploadJitterMs: 0,
    ...over,
  });

  return {
    runtime,
    storage,
    keystore,
    http,
    vaultKey,
    deviceId: identity.deviceId,
    peerIds: roster.map((peer) => peer.deviceId),
    peerId: roster[0]?.deviceId ?? "",
    set: (entries) =>
      storage.transact((tx) => writeMeta(tx, entries), { silent: true }),
  };
};

/** Every URL the runtime asked for, so a test can assert on what was *not* contacted. */
const urls = (http: FetchDouble) => http.calls.map((call) => call.url);
const bucketCalls = (http: FetchDouble) =>
  urls(http).filter((url) => url.includes("/bucket/"));

describe("a pass that does not run", () => {
  it("does nothing at all when sync is switched off", async () => {
    const target = await rig({ enabled: false });

    const pass = await target.runtime.reconcile();

    expect(pass.reason).toBe("disabled");
    expect(pass.outcome).toBeNull();
    // Not one request, not even the health check. "Off" that still pings a server every time
    // the app is opened is a claim the settings screen would be making falsely.
    expect(target.http.calls).toHaveLength(0);
    expect(target.runtime.transports).toHaveLength(0);
  });

  it("reports an unpaired device rather than pretending to sync", async () => {
    const target = await rig({ paired: false });

    const pass = await target.runtime.reconcile();

    expect(pass.reason).toBe("unpaired");
    expect(target.http.calls).toHaveLength(0);
  });

  it("reports a locked keystore as locked, not as unpaired", async () => {
    // The two states lead to opposite UI — one offers an unlock, the other offers to pair —
    // and conflating them is how a user gets talked into a fresh pairing that orphans the
    // vault they already have.
    const target = await rig();
    await target.keystore.setPassphrase("marigold teapot lantern");
    target.keystore.lock();

    expect(await target.runtime.reconcile()).toMatchObject({
      reason: "locked",
      outcome: null,
    });
  });

  it("still reports the relay status when it could not sync", async () => {
    const target = await rig({ enabled: false });
    await target.set({
      [SYNC_META.relayStatus]: "unreachable",
      [SYNC_META.relayDetail]: "getaddrinfo ENOTFOUND",
      [SYNC_META.relayCheckedAt]: NOW_ISO,
    });

    // The cached verdict survives sync being off, because "is the server down?" is a question
    // worth answering on a screen where sync is not currently running.
    const pass = await target.runtime.reconcile();
    expect(pass.health.status).toBe("unreachable");
    expect(pass.health.detail).toBe("getaddrinfo ENOTFOUND");
  });
});

describe("what gets wired", () => {
  it("contacts nothing when the relay address is blank", async () => {
    const target = await rig({ relayUrl: "" });

    const pass = await target.runtime.reconcile();

    // A blank address is a real "contact nothing", which is the whole reason the field is
    // editable.
    expect(target.runtime.transports).toHaveLength(0);
    expect(target.http.calls).toHaveLength(0);
    expect(pass.reason).toBe("ok");
    expect(pass.health.status).toBe("disabled");
  });

  it("contacts nothing when the drop-box is switched off", async () => {
    const target = await rig();
    await target.set({ [SYNC_META.relayEnabled]: "0" });

    const pass = await target.runtime.reconcile();

    expect(target.runtime.transports).toHaveLength(0);
    expect(bucketCalls(target.http)).toHaveLength(0);
    expect(pass.health.status).toBe("disabled");
  });
});

describe("what the relay is told", () => {
  it("addresses the bucket by a derived id and authorizes with a derived token", async () => {
    const target = await rig();
    await target.runtime.reconcile();

    const bucket = target.http.calls.find((call) =>
      call.url.includes("/bucket/"),
    );
    expect(bucket).toBeDefined();
    expect(bucket?.url).toContain(`/bucket/${deriveBucketId(target.vaultKey)}`);
    expect(bucket?.headers.authorization).toBe(
      `Bearer ${toBase64Url(deriveBucketToken(target.vaultKey))}`,
    );

    // The one assertion the privacy claim rests on: nothing the relay receives names a device.
    const wire = JSON.stringify(target.http.calls);
    expect(wire).not.toContain(target.deviceId);
    expect(wire).not.toContain(target.peerId);
  });

  it("addresses uploads to a route tag rather than to the peer", async () => {
    const target = await rig();
    await target.runtime.reconcile();

    const upload = target.http.calls.find((call) => call.method === "PUT");
    expect(upload).toBeDefined();
    // Epoch 1 (the rig's vault), and the UTC day of the rig's fixed clock.
    expect(upload?.body).toMatchObject({
      to: deriveRouteTag(target.vaultKey, 1, routeDayOf(NOW), target.peerId),
    });
  });

  it("moves uploads to the next day's tag when the UTC day turns", async () => {
    let clock = NOW;
    const target = await rig({
      replies: [...PASS, ...PASS],
      over: { now: () => clock },
    });
    await target.runtime.reconcile();
    clock += ROUTE_DAY_MS;
    await target.runtime.reconcile();

    const tags = target.http.calls
      .filter((call) => call.method === "PUT")
      .map((call) => (call.body as { to: string }).to);
    expect(tags.length).toBeGreaterThanOrEqual(2);
    expect(tags[0]).toBe(
      deriveRouteTag(target.vaultKey, 1, routeDayOf(NOW), target.peerId),
    );
    expect(tags[tags.length - 1]).toBe(
      deriveRouteTag(target.vaultKey, 1, routeDayOf(NOW) + 1, target.peerId),
    );
  });

  it("hears a peer whose tag is yesterday's, and still drops a stranger", async () => {
    // The bucket reply is built up after the rig exists, because the tags depend on its key. The
    // double serves the reply object it was given, so the blobs added here are the ones it sends.
    const bucket: { kind: "json"; body: { blobs: unknown[]; more: boolean } } =
      { kind: "json", body: { blobs: [], more: false } };
    const errors: unknown[] = [];
    const target = await rig({
      replies: [bucket, { kind: "status", status: 200 }],
      over: { onError: (error) => errors.push(error) },
    });
    const selfToday = deriveRouteTag(
      target.vaultKey,
      1,
      routeDayOf(NOW),
      target.deviceId,
    );
    const peerYesterday = deriveRouteTag(
      target.vaultKey,
      1,
      routeDayOf(NOW) - 1,
      target.peerId,
    );
    bucket.body.blobs.push(
      { slot: 5, from: peerYesterday, to: selfToday, seq: 0, frame: "AA" },
      { slot: 6, from: "stranger-tag", to: selfToday, seq: 0, frame: "AA" },
    );

    await target.runtime.reconcile();

    const notDelivered = errors.filter(
      (error) =>
        error instanceof Error && error.message.includes("not delivered"),
    );
    // Exactly one: the stranger. The peer's yesterday-tagged blob reaches its channel.
    expect(notDelivered).toHaveLength(1);
  });

  it("resumes the drop-box from the stored cursor and advances it", async () => {
    const target = await rig({
      replies: [
        {
          kind: "json",
          body: {
            blobs: [
              {
                slot: 41,
                from: "sender-tag",
                to: "somebody-else",
                seq: 0,
                frame: "AA",
              },
            ],
          },
        },
        { kind: "status", status: 200 },
        { kind: "json", body: { ok: true, version: 2 } },
      ],
    });
    await target.set({ [SYNC_META.relayCursor]: "17" });

    await target.runtime.reconcile();

    expect(
      bucketCalls(target.http).some((url) => url.includes("after=17")),
    ).toBe(true);
    const meta = await target.storage.transact((tx) =>
      readMeta(tx, [SYNC_META.relayCursor]),
    );
    // Past a blob addressed to another device, because it will never become this one's
    // business and re-reading it every launch would grow with the vault's whole history.
    expect(meta.get(SYNC_META.relayCursor)).toBe("41");
  });
});

describe("reuse between passes", () => {
  it("keeps its transports when nothing they were built from changed", async () => {
    const target = await rig({ replies: [...PASS, ...PASS] });
    await target.runtime.reconcile();
    const first = target.runtime.transports;

    await target.runtime.reconcile();

    // Identity, not shape: a rebuilt transport would have dropped its backoff and health state.
    expect(target.runtime.transports[0]).toBe(first[0]);
  });

  it("rebuilds when the relay address is replaced", async () => {
    const target = await rig({ replies: [...PASS, ...PASS] });
    await target.runtime.reconcile();
    const first = target.runtime.transports;

    await target.set({ [SYNC_META.relayUrl]: "https://other.example.com" });
    await target.runtime.reconcile();

    expect(target.runtime.transports[0]).not.toBe(first[0]);
    expect(
      bucketCalls(target.http).some((url) =>
        url.startsWith("https://other.example.com"),
      ),
    ).toBe(true);
  });

  it("rebuilds when the vault key is rotated", async () => {
    const target = await rig({ replies: [...PASS, ...PASS] });
    await target.runtime.reconcile();
    const first = target.runtime.transports;

    // A rotation bumps the epoch beside the key. Reuse that outlived it would seal batches
    // under a key every peer has retired while labelling them with the old epoch — which each
    // peer would then reject for entirely the wrong reason.
    const held = await target.keystore.read();
    const rotated = createVaultRootKey();
    await target.keystore.write({
      vaultKey: rotated,
      identity: held!.identity,
      epoch: 2,
    });
    await target.runtime.reconcile();

    expect(target.runtime.transports[0]).not.toBe(first[0]);
    expect(
      bucketCalls(target.http).some((url) =>
        url.includes(deriveBucketId(rotated)),
      ),
    ).toBe(true);
  });

  it("drops everything when sync is switched off mid-life", async () => {
    const target = await rig();
    await target.runtime.reconcile();
    expect(target.runtime.transports).toHaveLength(1);

    await target.set({ [SYNC_META.enabled]: "0" });
    await target.runtime.reconcile();

    expect(target.runtime.transports).toHaveLength(0);
  });

  it("closes on demand and can be wired again", async () => {
    const target = await rig({ replies: [...PASS, ...PASS] });
    await target.runtime.reconcile();

    await target.runtime.close();
    expect(target.runtime.transports).toHaveLength(0);

    await target.runtime.reconcile();
    expect(target.runtime.transports).toHaveLength(1);
  });
});

describe("relay health", () => {
  it("measures the relay after the pass, not before it", async () => {
    const target = await rig();

    const pass = await target.runtime.reconcile();

    expect(pass.health.status).toBe("reachable");
    // Ordering, asserted directly: a relay that answers `/health` while refusing every upload
    // is exactly the case a pre-flight probe reports as fine.
    const health = urls(target.http).lastIndexOf(`${RELAY}/health`);
    expect(health).toBeGreaterThan(
      urls(target.http).findIndex((url) => url.includes("/bucket/")),
    );
  });

  it("calls a relay that answers but refuses uploads degraded", async () => {
    // Three peers in one pass rather than three passes, because a probe that succeeds *ends*
    // the run: the verdict is about consecutive upload failures, and any reachable answer in
    // between resets the count to zero. Three refusals therefore have to happen before the
    // pass's single probe, which is exactly one bucket read and one upload per peer.
    const target = await rig({
      peers: 3,
      replies: [
        { kind: "json", body: { blobs: [] } },
        { kind: "status", status: 500 },
        { kind: "json", body: { blobs: [] } },
        { kind: "status", status: 500 },
        { kind: "json", body: { blobs: [] } },
        { kind: "status", status: 500 },
        { kind: "json", body: { ok: true, version: 2 } },
      ],
    });

    const pass = await target.runtime.reconcile();

    // A run of refused uploads is a different claim from one — a network changing hands
    // mid-request produces one of those every week — and it is the one worth making.
    expect(pass.health.status).toBe("degraded");
    expect(pass.health.detail).toContain("uploads failed");
  });

  it("clears the run as soon as one upload lands", async () => {
    const target = await rig({
      peers: 3,
      replies: [
        { kind: "json", body: { blobs: [] } },
        { kind: "status", status: 500 },
        { kind: "json", body: { blobs: [] } },
        { kind: "status", status: 500 },
        { kind: "json", body: { blobs: [] } },
        { kind: "status", status: 200 },
        { kind: "json", body: { ok: true, version: 2 } },
      ],
    });

    const pass = await target.runtime.reconcile();

    // Two failures and then a success is a relay that works, and saying "relay errors" about
    // it would send the user to check a server that is fine.
    expect(pass.health.status).toBe("reachable");
    expect(pass.health.failures).toBe(0);
  });

  it("says a host that never answered is unreachable, with the reason", async () => {
    const target = await rig({
      replies: [{ kind: "throw", message: "ENOTFOUND relay.example" }],
    });

    const pass = await target.runtime.reconcile();

    expect(pass.health.status).toBe("unreachable");
    // Shown verbatim to whoever runs the relay, who needs to know whether it was DNS, TLS, a
    // 502, or a rejected token. Which is also why nothing derived from a record may reach it.
    expect(pass.health.detail).toContain("ENOTFOUND");
  });

  it("checks on demand without running a pass", async () => {
    const target = await rig({
      replies: [{ kind: "json", body: { ok: true, version: 2 } }],
    });

    const health = await target.runtime.checkRelay();

    expect(health.status).toBe("reachable");
    expect(urls(target.http)).toEqual([`${RELAY}/health`]);
    expect(target.runtime.transports).toHaveLength(0);
  });

  it("reads the cached verdict without touching the network", async () => {
    const target = await rig({
      replies: [{ kind: "json", body: { ok: true, version: 2 } }],
    });
    await target.runtime.checkRelay();
    const before = target.http.calls.length;

    const cached = await target.runtime.health();

    expect(cached.status).toBe("reachable");
    expect(cached.endpoint).toBe(RELAY);
    expect(target.http.calls).toHaveLength(before);
  });
});

describe("purging the drop-box", () => {
  it("deletes the bucket", async () => {
    const target = await rig();

    await target.runtime.purgeRelay();

    expect(target.http.calls).toHaveLength(1);
    expect(target.http.calls[0]).toMatchObject({
      method: "DELETE",
      url: `${RELAY}/bucket/${deriveBucketId(target.vaultKey)}`,
    });
  });

  it("does nothing when there is no relay to purge", async () => {
    const target = await rig({ relayUrl: "" });
    await target.runtime.purgeRelay();
    expect(target.http.calls).toHaveLength(0);
  });

  it("does nothing when this device holds no vault", async () => {
    const target = await rig({ paired: false });
    await target.runtime.purgeRelay();
    expect(target.http.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Hand-carried files
// ---------------------------------------------------------------------------

/**
 * `file.test.ts` proves the transport and the wire format. What is only provable here is that
 * the *runtime* wires it to a real session on both sides — that a file written by one paired
 * device is a file another paired device accepts, verifies, and applies.
 *
 * The claim being tested is narrow and it is the reason this path exists: **this involves
 * nobody.** So both devices are given a relay address they never use, and a `fetch` that fails
 * the test if it is called at all. A round-trip that quietly contacted a server would still
 * pass an assertion about the ops arriving, and would have lost the only property that makes
 * the feature worth having.
 */
const CARRIER_PROFILE = { name: "Phone", platform: "ios" } as const;

const stored = (type: EntityType, entity: FinanceEntity): StoredEntity => ({
  type,
  entity,
});

/** Enough for genesis to produce a chain rather than an empty one. */
const carried = (): StoredEntity[] => [
  stored("settings", settings({ baseCurrency: "ILS" })),
  stored("accounts", account({ id: "acc-1" })),
  stored("transactions", transaction({ id: "txn-1", accountId: "acc-1" })),
];

/** A roster row for a device whose identity actually exists, so signatures verify. */
const peerFor = (identity: DeviceIdentity, name: string): Peer => ({
  deviceId: identity.deviceId,
  name,
  platform: "test",
  signingKey: identity.signing.publicKey,
  agreementKey: identity.agreement.publicKey,
  epoch: INITIAL_EPOCH,
  addedAt: NOW_ISO,
  revokedAt: null,
  revokedSeq: null,
  acked: {},
  known: {},
  lastSeenAt: null,
});

interface Carrier {
  readonly runtime: SyncRuntime;
  readonly storage: MemoryStorageAdapter;
  readonly keystore: MemoryKeystore;
  readonly deps: SyncSetupDeps;
  /** Every batch `applyRemoteOps` was handed, so a test can see what actually arrived. */
  readonly received: SyncOpBody[][];
  readonly opRows: () => Promise<readonly { deviceId: string; seq: number }[]>;
}

const carrier = async (
  records: readonly StoredEntity[] = [],
): Promise<Carrier> => {
  const storage = new MemoryStorageAdapter();
  await storage.initialize();
  if (records.length) await storage.putMany([...records]);

  const keystore = new MemoryKeystore();
  const received: SyncOpBody[][] = [];

  const runtime = new SyncRuntime({
    storage,
    repository: {
      applyRemoteOps: (ops) => {
        received.push([...ops]);
        return Promise.resolve({
          applied: ops.length,
          changedTypes: [],
          repairs: [],
        });
      },
      repairProjection: () =>
        Promise.resolve({ applied: 0, changedTypes: [], repairs: [] }),
    },
    keystore,
    // The assertion, not a stub. Nothing on this path may reach a network, and a `fetch` that
    // returned something plausible would let a regression through unnoticed.
    fetch: () =>
      Promise.reject(new Error("the file path must not contact a server")),
    now: () => NOW,
    nowIso: () => NOW_ISO,
  });

  return {
    runtime,
    storage,
    keystore,
    deps: { storage, keystore, nowIso: () => NOW_ISO },
    received,
    opRows: () =>
      storage.transact(async (tx) =>
        (await tx.table("syncOps").all()).map((row) => ({
          deviceId: row.deviceId,
          seq: row.seq,
        })),
      ),
  };
};

/** Two devices in one vault, each holding a roster row for the other. Only A has any data. */
const carriers = async () => {
  const a = await carrier(carried());
  const host = await enableSync(a.deps, CARRIER_PROFILE);
  const vault = await a.keystore.read();
  if (!vault) throw new Error("the rig failed to create a vault");

  const b = await carrier();
  const joiner = createDeviceIdentity();
  await adoptVault(b.deps, {
    identity: joiner,
    vaultKey: vault.vaultKey,
    epoch: vault.epoch,
    baseCurrency: "ILS",
    peers: [peerFor(vault.identity, "Phone")],
    profile: { name: "Laptop", platform: "web" },
  });
  await recordPairedPeer(a.deps, peerFor(joiner, "Laptop"));

  // Configured but unusable: the point is that neither side reaches for it.
  for (const device of [a, b]) {
    await device.storage.transact((tx) =>
      writeMeta(tx, { [SYNC_META.relayUrl]: RELAY }),
    );
  }

  return {
    a,
    b,
    hostId: host.deviceId,
    joinerId: joiner.deviceId,
    vaultKey: vault.vaultKey,
  };
};

describe("a bundle carried between two devices", () => {
  it("writes a file the other device accepts, verifies, and applies", async () => {
    const { a, b, hostId } = await carriers();

    const exported = await a.runtime.exportBundle();
    expect(exported).toMatchObject({ reason: "ok", frames: 1, peers: 1 });
    expect(exported.text).not.toBe("");

    const imported = await b.runtime.importBundle(exported.text);

    expect(imported).toEqual({
      reason: "ok",
      from: hostId,
      accepted: 1,
      skipped: 0,
      applied: 3,
      rejected: 0,
    });
    // Reached the finance core, not merely the op table — the ops are useless to the user until
    // something projects them.
    expect(b.received.flat().map((op) => op.entityId)).toEqual([
      "settings",
      "acc-1",
      "txn-1",
    ]);
    // And landed in B's own log under A's chain, which is what lets B forward them to a third
    // device that never sees this file.
    expect(await b.opRows()).toEqual([
      { deviceId: hostId, seq: 1 },
      { deviceId: hostId, seq: 2 },
      { deviceId: hostId, seq: 3 },
      { deviceId: hostId, seq: 4 },
    ]);
  });

  it("contacts nothing to do it", async () => {
    // Asserted by construction — the `fetch` in this rig throws — so reaching
    // the end of a successful round trip *is* the proof. Stated as its own test because it is
    // the claim the feature is sold on, and a future refactor that added a health probe to
    // `exportBundle` would otherwise look like an unrelated failure.
    const { a, b } = await carriers();

    const exported = await a.runtime.exportBundle();
    await expect(b.runtime.importBundle(exported.text)).resolves.toMatchObject({
      reason: "ok",
    });
    expect(a.runtime.transports).toHaveLength(0);
  });

  it("is idempotent, because delivery is acknowledged rather than assumed", async () => {
    const { a, b } = await carriers();
    const exported = await a.runtime.exportBundle();

    await b.runtime.importBundle(exported.text);
    const again = await b.runtime.importBundle(exported.text);

    // A file that was already opened must not double-apply, and must not be rejected either —
    // a user who is unsure whether the import worked will simply do it again.
    expect(again).toMatchObject({
      reason: "ok",
      accepted: 1,
      applied: 0,
      rejected: 0,
    });
    expect(await b.opRows()).toHaveLength(4);
  });

  it("still has something to say after a second export, since nobody acked the first", async () => {
    const { a, b } = await carriers();

    const first = await a.runtime.exportBundle();
    const second = await a.runtime.exportBundle();

    // Exporting is not delivery. A device that dropped the ops on export would leave the peer
    // permanently behind if the file was lost, and the file being lost is the ordinary case
    // this transport exists for.
    expect(second).toMatchObject({ reason: "ok", frames: 1, peers: 1 });
    // Fresh transport per export, so the second file is not the first file plus more.
    expect(second.text).not.toBe("");
    await expect(b.runtime.importBundle(first.text)).resolves.toMatchObject({
      applied: 3,
    });
    await expect(b.runtime.importBundle(second.text)).resolves.toMatchObject({
      applied: 0,
    });
  });

  it("skips frames addressed to a different device rather than rejecting them", async () => {
    const { a, vaultKey } = await carriers();
    // A third device in the same vault that A has never paired with. It holds the vault key, so
    // it could open the frame if it were handed it — but the route tag says the frame is not
    // for it, and a three-device vault makes files like this all the time.
    const stranger = await carrier();
    await stranger.keystore.write({
      vaultKey,
      identity: createDeviceIdentity(),
      epoch: INITIAL_EPOCH,
    });
    await stranger.storage.transact((tx) =>
      writeMeta(tx, {
        [SYNC_META.enabled]: "1",
        [SYNC_META.baseCurrency]: "ILS",
      }),
    );

    const exported = await a.runtime.exportBundle();
    const imported = await stranger.runtime.importBundle(exported.text);

    expect(imported).toMatchObject({
      reason: "ok",
      accepted: 0,
      skipped: 1,
      applied: 0,
      rejected: 0,
    });
    expect(stranger.received).toHaveLength(0);
  });

  it("refuses to export while sync is switched off", async () => {
    const { a } = await carriers();
    await a.storage.transact((tx) =>
      writeMeta(tx, { [SYNC_META.enabled]: "0" }),
    );

    // Not an empty bundle. Change capture is armed only while sync is on, so a file written
    // with it off would be valid, empty, and completely misleading.
    expect(await a.runtime.exportBundle()).toEqual({
      reason: "disabled",
      text: "",
      frames: 0,
      peers: 0,
    });
  });

  it("tells an unpaired device why it cannot import, without touching its keystore", async () => {
    const { a } = await carriers();
    const exported = await a.runtime.exportBundle();
    const fresh = await carrier();
    await fresh.storage.transact((tx) =>
      writeMeta(tx, { [SYNC_META.enabled]: "1" }),
    );

    const imported = await fresh.runtime.importBundle(exported.text);

    expect(imported).toMatchObject({
      reason: "unpaired",
      accepted: 0,
      skipped: 1,
    });
    expect(await fresh.keystore.read()).toBeNull();
  });

  it("rejects a file that is not a bundle before it reaches for a key", async () => {
    const { b } = await carriers();
    await expect(
      b.runtime.importBundle("id,date,amount\n1,2026-01-01,10"),
    ).rejects.toThrow();
  });
});

describe("sync runtime hardening", () => {
  it("writes a bundle that never names the sending device in plaintext", async () => {
    const { a, hostId } = await carriers();

    const exported = await a.runtime.exportBundle();

    expect(exported.frames).toBeGreaterThan(0);
    expect(exported.text).not.toContain(hostId);
  });

  it("runs one pass at a time, and coalesces triggers during it into exactly one follow-up", async () => {
    const { a } = await carriers();
    const reads = jest.spyOn(a.keystore, "read");

    const first = a.runtime.reconcile();
    const second = a.runtime.reconcile();
    const third = a.runtime.reconcile();

    // The second and third trigger share one queued follow-up pass.
    expect(third).toBe(second);
    await Promise.all([first, second, third]);

    // Each pass reads the vault exactly once when sync is on: the first pass, then the single
    // follow-up. Three triggers, two passes.
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it("lets a pass that arrives after the last one start a fresh pass", async () => {
    const { a } = await carriers();
    const reads = jest.spyOn(a.keystore, "read");

    await a.runtime.reconcile();
    await a.runtime.reconcile();

    expect(reads).toHaveBeenCalledTimes(2);
  });
});
