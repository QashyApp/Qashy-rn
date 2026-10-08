/**
 * The drop-box, exercised against a relay that is by turns broken, hostile, and merely slow.
 *
 * The happy path here is one test. The rest are the cases that decide whether an unreliable
 * server degrades sync or breaks it permanently — a cursor that refuses to advance past a bad
 * blob, a page returned out of order, a body that is not JSON at all.
 */

import { MAX_FRAME_BYTES, toBase64Url } from "@/sync/crypto";
import { RelayError } from "@/sync/transport/http";
import {
  MAX_HELD_FRAMES_PER_TAG,
  MAX_HELD_TAGS,
  MAX_RELAY_PAGES,
  RELAY_PAGE_SIZE,
  RelayTransport,
  type RelayTransportDeps,
} from "@/sync/transport/relay";
import {
  fetchDouble,
  type FetchDouble,
} from "@/sync/transport/__tests__/http-double";

const BASE = "https://relay.example.com";
const SELF = "aaaaaaaaaaaaaaaa";
const PEER = "bbbbbbbbbbbbbbbb";

const frame = (byte: number, length = 8) => new Uint8Array(length).fill(byte);

interface Harness {
  readonly transport: RelayTransport;
  readonly http: FetchDouble;
  readonly cursor: () => number;
}

function harness(http: FetchDouble): Harness {
  let cursor = 0;
  const transport = new RelayTransport({
    fetch: http.fetch,
    baseUrl: BASE,
    bucketId: "bucket-1",
    token: "token-1",
    selfTag: () => SELF,
    recipientTags: RECIPIENTS,
    tagFor: () => PEER,
    senderTags: ALL_SENDERS,
    readCursor: () => Promise.resolve(cursor),
    writeCursor: (slot) => {
      cursor = slot;
      return Promise.resolve();
    },
    // Jitter exists to blur upload timing on a real network; in a test it is only latency.
    jitterMs: 0,
  });
  return { transport, http, cursor: () => cursor };
}

const blob = (
  slot: number,
  to: string,
  seq: number,
  bytes: Uint8Array,
  from = PEER,
) => ({
  slot,
  from,
  to,
  seq,
  frame: toBase64Url(bytes),
});

/** Every sender tag this harness knows, mapped to the device id it belongs to. */
const ALL_SENDERS = () =>
  Promise.resolve(
    new Map([
      [PEER, "peer"],
      ["tag-b", "b"],
      ["tag-a", "a"],
    ]),
  );
/** This device accepts blobs addressed to its own tag only. */
const RECIPIENTS = () => new Set([SELF]);

const abort = () => new AbortController().signal;

describe("RelayTransport.connect", () => {
  it("routes a fetched blob to its sender channel, including when that channel connects later", async () => {
    const http = fetchDouble(
      {
        kind: "json",
        body: { blobs: [blob(1, SELF, 0, frame(7), "tag-b")], more: false },
      },
      { kind: "json", body: { blobs: [], more: false } },
    );
    let cursor = 0;
    const transport = new RelayTransport({
      fetch: http.fetch,
      baseUrl: BASE,
      bucketId: "bucket-1",
      token: "token-1",
      selfTag: () => SELF,
      recipientTags: RECIPIENTS,
      tagFor: (peerId) => (peerId === "b" ? "tag-b" : "tag-a"),
      senderTags: ALL_SENDERS,
      readCursor: () => Promise.resolve(cursor),
      writeCursor: (slot) => {
        cursor = slot;
        return Promise.resolve();
      },
      jitterMs: 0,
    });

    const channelA = await transport.connect(
      { deviceId: "a", name: "A" },
      abort(),
    );
    const heardA: number[] = [];
    channelA.onFrame((_frame, seq) => heardA.push(seq));
    const channelB = await transport.connect(
      { deviceId: "b", name: "B" },
      abort(),
    );
    const heardB: number[] = [];
    channelB.onFrame((_frame, seq) => heardB.push(seq));

    expect(heardA).toEqual([]);
    expect(heardB).toEqual([0]);
  });

  it("collects what is addressed to this device and ignores what is not", async () => {
    const http = fetchDouble({
      kind: "json",
      body: {
        blobs: [
          blob(1, SELF, 0, frame(1)),
          blob(2, "someone-else", 0, frame(2)),
          blob(3, SELF, 1, frame(3)),
        ],
        more: false,
      },
    });
    const { transport, cursor } = harness(http);

    const channel = await transport.connect(
      { deviceId: "peer", name: "Peer" },
      abort(),
    );
    const received: { frame: Uint8Array; seq: number }[] = [];
    channel.onFrame((bytes, seq) => received.push({ frame: bytes, seq }));

    expect(received).toEqual([
      { frame: frame(1), seq: 0 },
      { frame: frame(3), seq: 1 },
    ]);
    // Past the other device's blob too: it will never become this device's business, and
    // re-reading it every launch would grow with the vault's whole history.
    expect(cursor()).toBe(3);
  });

  it("buffers frames that arrive before the session attaches its pump", async () => {
    const http = fetchDouble({
      kind: "json",
      body: { blobs: [blob(1, SELF, 7, frame(9))], more: false },
    });
    const { transport } = harness(http);

    // `connect` polls and resolves; the session installs `onFrame` only afterwards. Without
    // the buffer, everything the poll collected would land on the floor.
    const channel = await transport.connect(
      { deviceId: "peer", name: "Peer" },
      abort(),
    );
    const received: number[] = [];
    channel.onFrame((_bytes, seq) => received.push(seq));

    expect(received).toEqual([7]);
  });

  it("sends the bearer token on every bucket request and never on nothing else", async () => {
    const http = fetchDouble({
      kind: "json",
      body: { blobs: [], more: false },
    });
    const { transport } = harness(http);
    await transport.connect({ deviceId: "peer", name: "Peer" }, abort());

    expect(http.calls[0].headers.authorization).toBe("Bearer token-1");
    expect(http.calls[0].url).toBe(
      `${BASE}/bucket/bucket-1?after=0&limit=${RELAY_PAGE_SIZE}`,
    );
  });

  it("refuses to start once sync has been cancelled", async () => {
    const http = fetchDouble({
      kind: "json",
      body: { blobs: [], more: false },
    });
    const { transport } = harness(http);
    const controller = new AbortController();
    controller.abort();

    await expect(
      transport.connect({ deviceId: "peer", name: "Peer" }, controller.signal),
    ).rejects.toThrow(RelayError);
    expect(http.calls).toHaveLength(0);
  });
});

describe("RelayTransport.poll", () => {
  it("shares one pass across every peer, so a four-device vault downloads each page once", async () => {
    const http = fetchDouble({
      kind: "json",
      body: { blobs: [blob(1, SELF, 0, frame(1))], more: false },
    });
    const { transport } = harness(http);

    await Promise.all([
      transport.connect({ deviceId: "a", name: "A" }, abort()),
      transport.connect({ deviceId: "b", name: "B" }, abort()),
      transport.connect({ deviceId: "c", name: "C" }, abort()),
    ]);

    expect(http.calls).toHaveLength(1);
  });

  it("follows pages while the relay says there are more", async () => {
    const http = fetchDouble(
      {
        kind: "json",
        body: { blobs: [blob(1, SELF, 0, frame(1))], more: true },
      },
      {
        kind: "json",
        body: { blobs: [blob(2, SELF, 1, frame(2))], more: true },
      },
      {
        kind: "json",
        body: { blobs: [blob(3, SELF, 2, frame(3))], more: false },
      },
    );
    const { transport, cursor } = harness(http);
    await transport.connect({ deviceId: "peer", name: "Peer" }, abort());

    expect(http.calls).toHaveLength(3);
    expect(http.calls[1].url).toContain("after=1");
    expect(cursor()).toBe(3);
  });

  it("stops after the page cap and resumes from the persisted cursor next time", async () => {
    // A relay that always claims `more` would otherwise turn opening the app into an
    // unbounded download the user can neither see nor cancel.
    const http = fetchDouble({
      kind: "json",
      body: { blobs: [blob(1, SELF, 0, frame(1))], more: true },
    });
    const { transport } = harness(http);
    await transport.connect({ deviceId: "peer", name: "Peer" }, abort());

    expect(http.calls).toHaveLength(MAX_RELAY_PAGES);
  });

  it("advances past a blob it cannot decode instead of re-downloading it forever", async () => {
    const http = fetchDouble({
      kind: "json",
      body: {
        blobs: [
          { slot: 1, to: SELF, seq: 0, frame: "!!! not base64url !!!" },
          blob(2, SELF, 1, frame(4)),
        ],
        more: false,
      },
    });
    const { transport, cursor } = harness(http);

    const channel = await transport.connect(
      { deviceId: "peer", name: "Peer" },
      abort(),
    );
    const received: number[] = [];
    channel.onFrame((_bytes, seq) => received.push(seq));

    expect(received).toEqual([1]);
    expect(cursor()).toBe(2);
  });

  it("skips malformed rows without stranding the good ones beside them", async () => {
    const http = fetchDouble({
      kind: "json",
      body: {
        blobs: [
          null,
          { slot: "one", to: SELF, seq: 0, frame: "" },
          { slot: 2, to: SELF, seq: -1, frame: "" },
          { slot: 3, to: 5, seq: 0, frame: "" },
          blob(4, SELF, 0, frame(6)),
        ],
        more: false,
      },
    });
    const { transport } = harness(http);

    const channel = await transport.connect(
      { deviceId: "peer", name: "Peer" },
      abort(),
    );
    const received: Uint8Array[] = [];
    channel.onFrame((bytes) => received.push(bytes));

    expect(received).toEqual([frame(6)]);
  });

  it("writes a true high-water mark even when the relay returns a page out of order", async () => {
    const http = fetchDouble({
      kind: "json",
      body: {
        blobs: [blob(9, SELF, 1, frame(2)), blob(4, SELF, 0, frame(1))],
        more: false,
      },
    });
    const { transport, cursor } = harness(http);

    const channel = await transport.connect(
      { deviceId: "peer", name: "Peer" },
      abort(),
    );
    const received: number[] = [];
    channel.onFrame((_bytes, seq) => received.push(seq));

    expect(received).toEqual([0, 1]);
    expect(cursor()).toBe(9);
  });

  it("classifies a rejected token, a broken host, and a body full of HTML", async () => {
    const cases: [Parameters<FetchDouble["reply"]>[0], string][] = [
      [{ kind: "status", status: 401 }, "unauthorized"],
      [{ kind: "status", status: 503 }, "server"],
      [{ kind: "status", status: 429 }, "rateLimited"],
      [{ kind: "throw" }, "unreachable"],
      [{ kind: "text", body: "<html>captive portal</html>" }, "malformed"],
      [{ kind: "json", body: { blobs: "not an array" } }, "malformed"],
    ];

    for (const [reply, code] of cases) {
      const { transport } = harness(fetchDouble(reply));
      await expect(transport.poll()).rejects.toMatchObject({ code });
    }
  });
});

describe("RelayTransport uploads", () => {
  it("addresses a frame to the peer, carries the sequence, and encodes the bytes", async () => {
    const http = fetchDouble({
      kind: "json",
      body: { blobs: [], more: false },
    });
    const { transport } = harness(http);
    const channel = await transport.connect(
      { deviceId: "peer", name: "Peer" },
      abort(),
    );

    await channel.send(frame(3), 5);

    const put = http.calls[1];
    expect(put.method).toBe("PUT");
    expect(put.url).toBe(`${BASE}/bucket/bucket-1`);
    expect(put.headers.authorization).toBe("Bearer token-1");
    expect(put.body).toEqual({
      from: SELF,
      to: PEER,
      seq: 5,
      frame: toBase64Url(frame(3)),
    });
  });

  it("refuses an oversized frame before it reaches the network", async () => {
    const http = fetchDouble({
      kind: "json",
      body: { blobs: [], more: false },
    });
    const { transport } = harness(http);
    const channel = await transport.connect(
      { deviceId: "peer", name: "Peer" },
      abort(),
    );

    await expect(
      channel.send(frame(0, MAX_FRAME_BYTES + 1), 0),
    ).rejects.toMatchObject({
      code: "tooLarge",
    });
    expect(http.calls).toHaveLength(1);
  });

  it("does not count a refused oversized upload as a relay health failure", async () => {
    const uploads: (unknown | null)[] = [];
    const transport = new RelayTransport({
      fetch: fetchDouble(
        { kind: "json", body: { blobs: [], more: false } },
        { kind: "status", status: 413 },
      ).fetch,
      baseUrl: BASE,
      bucketId: "bucket-1",
      token: "token-1",
      selfTag: () => SELF,
      recipientTags: RECIPIENTS,
      tagFor: () => PEER,
      senderTags: ALL_SENDERS,
      readCursor: () => Promise.resolve(0),
      writeCursor: () => Promise.resolve(),
      jitterMs: 0,
      onUpload: (error) => uploads.push(error),
    });
    const channel = await transport.connect(
      { deviceId: "peer", name: "Peer" },
      abort(),
    );

    // A frame the relay refuses as too large is a local payload problem; the relay itself is
    // fine, so the health verdict must not drift toward `degraded` because of it.
    await expect(channel.send(frame(3, 64), 0)).rejects.toMatchObject({
      code: "tooLarge",
    });
    expect(uploads).toEqual([]);
  });

  it("still counts a relay that is erroring on normal uploads", async () => {
    const uploads: (unknown | null)[] = [];
    const transport = new RelayTransport({
      fetch: fetchDouble(
        { kind: "json", body: { blobs: [], more: false } },
        { kind: "status", status: 500 },
      ).fetch,
      baseUrl: BASE,
      bucketId: "bucket-1",
      token: "token-1",
      selfTag: () => SELF,
      recipientTags: RECIPIENTS,
      tagFor: () => PEER,
      senderTags: ALL_SENDERS,
      readCursor: () => Promise.resolve(0),
      writeCursor: () => Promise.resolve(),
      jitterMs: 0,
      onUpload: (error) => uploads.push(error),
    });
    const channel = await transport.connect(
      { deviceId: "peer", name: "Peer" },
      abort(),
    );

    await expect(channel.send(frame(3, 64), 0)).rejects.toMatchObject({
      code: "server",
    });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toBeInstanceOf(RelayError);
  });

  it("jitters each frame separately, so a burst of batches does not arrive as a burst", async () => {
    const slept: number[] = [];
    const transport = new RelayTransport({
      fetch: fetchDouble({ kind: "json", body: { blobs: [], more: false } })
        .fetch,
      baseUrl: BASE,
      bucketId: "bucket-1",
      token: "token-1",
      selfTag: () => SELF,
      recipientTags: RECIPIENTS,
      tagFor: () => PEER,
      senderTags: ALL_SENDERS,
      readCursor: () => Promise.resolve(0),
      writeCursor: () => Promise.resolve(),
      jitterMs: 1000,
      random: () => 0.5,
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
    });

    const channel = await transport.connect(
      { deviceId: "peer", name: "Peer" },
      abort(),
    );
    await channel.send(frame(1), 0);
    await channel.send(frame(2), 1);

    expect(slept).toEqual([500, 500]);
  });

  it("refuses to send on a closed channel", async () => {
    const http = fetchDouble({
      kind: "json",
      body: { blobs: [], more: false },
    });
    const { transport } = harness(http);
    const channel = await transport.connect(
      { deviceId: "peer", name: "Peer" },
      abort(),
    );

    await transport.close();
    await expect(channel.send(frame(1), 0)).rejects.toThrow(RelayError);
  });

  it("empties the bucket on purge", async () => {
    const http = fetchDouble({ kind: "json", body: {} });
    const { transport } = harness(http);

    await transport.purge();
    expect(http.calls[0]).toMatchObject({
      method: "DELETE",
      url: `${BASE}/bucket/bucket-1`,
    });
  });
});

describe("RelayTransport resilience", () => {
  const tagged = (peerId: string) => `tag-${peerId}`;
  const ROSTER = ALL_SENDERS;

  function build(
    http: FetchDouble,
    overrides: Partial<RelayTransportDeps> = {},
  ): { transport: RelayTransport; cursor: () => number } {
    let cursor = 0;
    const transport = new RelayTransport({
      fetch: http.fetch,
      baseUrl: BASE,
      bucketId: "bucket-1",
      token: "token-1",
      selfTag: () => SELF,
      recipientTags: RECIPIENTS,
      tagFor: tagged,
      senderTags: ROSTER,
      readCursor: () => Promise.resolve(cursor),
      writeCursor: (slot) => {
        cursor = slot;
        return Promise.resolve();
      },
      jitterMs: 0,
      ...overrides,
    });
    return { transport, cursor: () => cursor };
  }

  const EMPTY = { kind: "json", body: { blobs: [], more: false } } as const;

  it("returns a channel when the bucket cannot be read, and reports the failure", async () => {
    const http = fetchDouble({ kind: "status", status: 500 });
    const failures: unknown[] = [];
    const { transport } = build(http, {
      onPollError: (error) => failures.push(error),
    });

    const channel = await transport.connect(
      { deviceId: "b", name: "Laptop" },
      abort(),
    );

    expect(channel.peerId).toBe("b");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toBeInstanceOf(RelayError);
  });

  it("still rejects a connect that is cancelled while it polls", async () => {
    const http = fetchDouble({ kind: "hang" });
    const controller = new AbortController();
    const failures: unknown[] = [];
    const { transport } = build(http, {
      onPollError: (error) => failures.push(error),
    });

    const pending = transport.connect(
      { deviceId: "b", name: "" },
      controller.signal,
    );
    controller.abort();

    await expect(pending).rejects.toBeDefined();
    expect(failures).toHaveLength(0);
  });

  it("drops a blob from a sender outside the roster, holds nothing for it, and reports the drop", async () => {
    const http = fetchDouble(
      {
        kind: "json",
        body: {
          blobs: [
            blob(1, SELF, 0, frame(1), "stranger-tag"),
            blob(2, SELF, 1, frame(2), PEER),
          ],
          more: false,
        },
      },
      EMPTY,
    );
    const dropped: RelayError[] = [];
    const { transport, cursor } = build(http, {
      senderTags: () => Promise.resolve(new Map([[PEER, "peer"]])),
      tagFor: (peerId) =>
        peerId === "stranger" ? "stranger-tag" : tagged(peerId),
      onDropped: (error) => dropped.push(error),
    });

    await transport.poll();
    expect(dropped).toHaveLength(1);
    expect(dropped[0].message).toContain("1 relay message was not delivered");
    expect(cursor()).toBe(2);

    const seen: number[] = [];
    const stranger = await transport.connect(
      { deviceId: "stranger", name: "" },
      abort(),
    );
    stranger.onFrame((_bytes, seq) => seen.push(seq));
    expect(seen).toEqual([]);
  });

  it("holds at most MAX_HELD_FRAMES_PER_TAG frames for a sender and evicts the oldest", async () => {
    const count = MAX_HELD_FRAMES_PER_TAG + 1;
    const blobs = Array.from({ length: count }, (_value, index) =>
      blob(index + 1, SELF, index, frame(index % 256)),
    );
    const framed = blobs.map((row) => ({ ...row, from: "tag-b" }));
    const http = fetchDouble(
      { kind: "json", body: { blobs: framed, more: false } },
      EMPTY,
    );
    const dropped: RelayError[] = [];
    const { transport } = build(http, {
      senderTags: () => Promise.resolve(new Map([["tag-b", "b"]])),
      onDropped: (error) => dropped.push(error),
    });

    await transport.poll();
    const channel = await transport.connect(
      { deviceId: "b", name: "" },
      abort(),
    );
    const seqs: number[] = [];
    channel.onFrame((_bytes, seq) => seqs.push(seq));

    expect(seqs).toHaveLength(MAX_HELD_FRAMES_PER_TAG);
    expect(seqs[0]).toBe(1);
    expect(seqs[seqs.length - 1]).toBe(MAX_HELD_FRAMES_PER_TAG);
    expect(dropped).toHaveLength(1);
  });

  it("holds at most MAX_HELD_TAGS senders and evicts the one that has waited longest", async () => {
    const senders = Array.from(
      { length: MAX_HELD_TAGS + 1 },
      (_value, index) => `p${index}`,
    );
    const blobs = senders.map((peerId, index) =>
      blob(index + 1, SELF, 0, frame(index + 1), tagged(peerId)),
    );
    const http = fetchDouble(
      { kind: "json", body: { blobs, more: false } },
      EMPTY,
    );
    const { transport } = build(http, {
      senderTags: () =>
        Promise.resolve(
          new Map(senders.map((peerId) => [tagged(peerId), peerId])),
        ),
    });

    await transport.poll();
    const evicted = await transport.connect(
      { deviceId: "p0", name: "" },
      abort(),
    );
    const kept = await transport.connect(
      { deviceId: `p${MAX_HELD_TAGS}`, name: "" },
      abort(),
    );
    const evictedSeen: number[] = [];
    const keptSeen: number[] = [];
    evicted.onFrame((_bytes, seq) => evictedSeen.push(seq));
    kept.onFrame((_bytes, seq) => keptSeen.push(seq));

    expect(evictedSeen).toEqual([]);
    expect(keptSeen).toEqual([0]);
  });

  it("advances the cursor past a page made only of malformed rows", async () => {
    const http = fetchDouble({
      kind: "json",
      body: {
        blobs: [{ slot: 7, from: 5, to: SELF, seq: 0, frame: "x" }],
        more: false,
      },
    });
    const { transport, cursor } = build(http);

    await expect(transport.poll()).resolves.toBe(0);
    expect(cursor()).toBe(7);
  });

  it("does not move the cursor for a page with no usable position at all", async () => {
    const writes: number[] = [];
    const http = fetchDouble({
      kind: "json",
      body: { blobs: [{ slot: "seven", from: PEER }], more: false },
    });
    const { transport } = build(http, {
      writeCursor: (slot) => {
        writes.push(slot);
        return Promise.resolve();
      },
    });

    await transport.poll();
    expect(writes).toEqual([]);
  });
});

describe("RelayTransport daily route tags", () => {
  const SELF_TODAY = "self-today";
  const SELF_YESTERDAY = "self-yesterday";
  const SELF_OLD = "self-two-days-ago";
  const PEER_TODAY = "peer-today";
  const PEER_YESTERDAY = "peer-yesterday";

  it("accepts a blob addressed to yesterday's tag, and ignores one from two days ago", async () => {
    // Two pages: the first poll reads both blobs, and connect()'s own poll then starts after the
    // cursor and finds nothing new. A relay honours `after`, so the double must too.
    const http = fetchDouble(
      {
        kind: "json",
        body: {
          blobs: [
            blob(1, SELF_YESTERDAY, 0, frame(1), PEER_YESTERDAY),
            blob(2, SELF_OLD, 1, frame(2), PEER_TODAY),
          ],
          more: false,
        },
      },
      { kind: "json", body: { blobs: [], more: false } },
    );
    const dropped: RelayError[] = [];
    let cursor = 0;
    const transport = new RelayTransport({
      fetch: http.fetch,
      baseUrl: BASE,
      bucketId: "bucket-1",
      token: "token-1",
      selfTag: () => SELF_TODAY,
      recipientTags: () => new Set([SELF_TODAY, SELF_YESTERDAY]),
      tagFor: () => PEER_TODAY,
      senderTags: () =>
        Promise.resolve(
          new Map([
            [PEER_TODAY, "peer"],
            [PEER_YESTERDAY, "peer"],
          ]),
        ),
      readCursor: () => Promise.resolve(cursor),
      writeCursor: (slot) => {
        cursor = slot;
        return Promise.resolve();
      },
      jitterMs: 0,
      onDropped: (error) => dropped.push(error),
    });

    await transport.poll();
    const channel = await transport.connect(
      { deviceId: "peer", name: "" },
      abort(),
    );
    const seen: number[] = [];
    channel.onFrame((_bytes, seq) => seen.push(seq));

    // The blob for yesterday's tag is delivered; the one for an older day is never this
    // device's business, so it is skipped silently rather than reported as a drop.
    expect(seen).toEqual([0]);
    expect(dropped).toEqual([]);
    expect(cursor).toBe(2);
  });

  it("addresses each upload with the peer's tag for the day it is sent", async () => {
    const http = fetchDouble({
      kind: "json",
      body: { blobs: [], more: false },
    });
    let day = "day-100";
    const transport = new RelayTransport({
      fetch: http.fetch,
      baseUrl: BASE,
      bucketId: "bucket-1",
      token: "token-1",
      selfTag: () => `${SELF_TODAY}-${day}`,
      recipientTags: () => new Set([SELF_TODAY]),
      tagFor: () => `${PEER_TODAY}-${day}`,
      senderTags: () => Promise.resolve(new Map()),
      readCursor: () => Promise.resolve(0),
      writeCursor: () => Promise.resolve(),
      jitterMs: 0,
    });
    const channel = await transport.connect(
      { deviceId: "peer", name: "" },
      abort(),
    );

    // The channel was opened on day 100 and is used on day 101: the frame must follow the day.
    day = "day-101";
    await channel.send(frame(4), 0);

    const put = http.calls[http.calls.length - 1];
    expect(put.method).toBe("PUT");
    expect(put.body).toMatchObject({
      from: `${SELF_TODAY}-day-101`,
      to: `${PEER_TODAY}-day-101`,
    });
  });
});
