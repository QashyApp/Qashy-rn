/**
 * The one place that turns configuration into a running sync.
 *
 * Everything below this file is deliberately incapable of starting itself. `SyncSession` is
 * handed transports and a key; `RelayTransport` is handed a bucket id it could not derive.
 * That is what makes each of them testable without a keystore, a network, or a clock — and it leaves exactly one file
 * that has to know how the pieces fit, which is this one.
 *
 * Three things it owns, and they are the three that were nobody else's job:
 *
 * 1. **Deriving the vault's public-facing identifiers** — bucket id, write token, route tags,
 *    from the root key, so no transport ever holds one. A transport that cannot reach a key
 *    cannot leak one.
 * 2. **Deciding which transports exist at all.** The drop-box exists only when an address is
 *    configured. A user who blanks the relay address gets a device that genuinely contacts
 *    nothing, and that has to be true of the object graph, not just the UI.
 * 3. **Keeping them alive between passes.** The transports are cached and only rebuilt when
 *    something they were built from actually changed — see `fingerprint`.
 *
 * There are still no timers here. `reconcile()` is called from the same lifecycle seam the
 * repository's own reconcile hangs on, and the relay is contacted then and at no other moment.
 */

import type { StorageAdapter } from "@/data/storage-adapter";
import type { FinanceRepository } from "@/data/repository";
import { fetch as expoFetch } from "expo/fetch";
import {
  SYNC_META,
  appendActivity,
  readMeta,
  writeMeta,
} from "@/data/sync-store";
import {
  deriveBucketId,
  deriveBucketToken,
  deriveContentKey,
  deriveRouteTag,
  routeDayOf,
  toBase64Url,
} from "@/sync/crypto";
import {
  KeystoreError,
  type StoredVault,
  type SyncKeystore,
} from "@/sync/keystore";
import {
  activityCode,
  activityEntry,
  transportDetail,
} from "@/sync/engine/activity";
import { activePeers, readRoster } from "@/sync/engine/roster";
import { SyncSession, type ReconcileOutcome } from "@/sync/engine/session";
import type { SyncTransport } from "@/sync/engine/transport";
import { readEndpoints, type SyncEndpoints } from "@/sync/transport/endpoints";
import {
  FileTransport,
  decodeBundle,
  encodeBundle,
} from "@/sync/transport/file";
import { RelayTransport } from "@/sync/transport/relay";
import {
  checkRelayHealth,
  noteRelayFailure,
  noteRelaySuccess,
  readRelayHealth,
  type RelayHealth,
} from "@/sync/transport/relay-health";
import { nowIso as defaultNowIso } from "@/utils/entity";

/**
 * UTC days a relay poll accepts, counting today: today's tag and yesterday's.
 *
 * Two, so that a sender whose clock has just crossed midnight is still heard by a receiver whose
 * clock has not yet done so. A blob older than that is addressed to a tag nobody polls for any
 * more, which is the point of rotating.
 */
const RELAY_ROUTE_DAYS = 2;

/**
 * UTC days a file import accepts, counting today: the last thirty.
 *
 * A file is carried by hand and may be opened weeks after it was written, so it is held to a
 * longer window than a relay blob. The window adds reach, not trust: every frame is still
 * authenticated against its own sender, recipient, epoch and sequence before it is applied.
 */
export const FILE_ROUTE_WINDOW_DAYS = 30;

/** The UTC day numbers ending at `today`, most recent first. */
const daysEndingAt = (today: number, count: number): number[] =>
  Array.from({ length: count }, (_, back) => today - back);

/** A device's route tag for one UTC day, under this vault's root key and epoch. */
const tagOn = (vault: StoredVault, deviceId: string, day: number): string =>
  deriveRouteTag(vault.vaultKey, vault.epoch, day, deviceId);

/**
 * Why a pass did nothing.
 *
 * Separated from "it ran and found nothing to do" because the two lead to opposite UI. A
 * device that is simply up to date should say so; one whose keystore is locked should be
 * offering an unlock, and one that was never paired should be offering to pair.
 */
export type SyncPassReason =
  /** The pass ran. */
  | "ok"
  /** Sync has not been switched on. The default, and not a problem. */
  | "disabled"
  /** Switched on, but this device holds no vault. Pairing was never completed. */
  | "unpaired"
  /** A vault is stored behind a passphrase gate that has not been opened this session. */
  | "locked"
  /** This platform cannot store a key safely, or what is stored is not readable. */
  | "unavailable";

export interface SyncPass {
  readonly reason: SyncPassReason;
  /** Null unless `reason` is `'ok'`. */
  readonly outcome: ReconcileOutcome | null;
  /** Always populated — the relay's status is worth showing even when sync did not run. */
  readonly health: RelayHealth;
}

export interface BundleExport {
  readonly reason: SyncPassReason;
  /** The `.qashysync` text, or `''` when the pass did not run. */
  readonly text: string;
  readonly frames: number;
  /** How many peers the file carries something for. Zero means everyone is already current. */
  readonly peers: number;
}

export interface BundleImport {
  readonly reason: SyncPassReason;
  /**
   * The device that wrote the file, resolved against this vault's roster. Empty when the file
   * was not written by a device this vault knows about.
   */
  readonly from: string;
  /** Frames in the file addressed to this device. */
  readonly accepted: number;
  /** Frames addressed to a different device. Not an error; a three-device vault makes several. */
  readonly skipped: number;
  readonly applied: number;
  readonly rejected: number;
}

export interface SyncRuntimeDeps {
  readonly storage: StorageAdapter;
  readonly repository: Pick<
    FinanceRepository,
    "applyRemoteOps" | "repairProjection"
  >;
  readonly keystore: SyncKeystore;
  /** Injected so the whole runtime can be exercised without a network. */
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly nowIso?: () => string;
  readonly requestTimeoutMs?: number;
  /** Relay upload jitter. Set to zero in tests so a pass is instant. */
  readonly uploadJitterMs?: number;
  /**
   * Told about anything that failed outside the activity log's reach.
   *
   * This layer must not log — `no-console` is enforced across `src/sync/**` — and a failure
   * swallowed here would be a device that quietly stops syncing. Everything the user needs to
   * see is already written to the activity table; this is the provider's hook for a banner.
   */
  readonly onError?: (error: unknown, peerId?: string) => void;
}

interface Wiring {
  /** What this wiring was built from. A change to any part of it invalidates the whole. */
  readonly fingerprint: string;
  readonly session: SyncSession;
  readonly transports: readonly SyncTransport[];
  readonly relay: RelayTransport | null;
}

export class SyncRuntime {
  private wiring: Wiring | null = null;

  /**
   * Health writes, serialised.
   *
   * Uploads finish concurrently across peers, and two `noteRelayFailure` transactions racing
   * each other would both read the same count and both write it plus one — turning three
   * consecutive failures into a total of two and never reaching the threshold that makes the
   * relay read as degraded.
   */
  private healthWrites: Promise<void> = Promise.resolve();

  /**
   * The last upload result written, so a clean pass writes once rather than once per frame.
   *
   * A twenty-batch first sync would otherwise open twenty transactions to record the same
   * "still fine". Failures always write, because each one carries a count.
   */
  private lastUpload: "ok" | "failed" | null = null;

  /**
   * The pass currently using the wiring, if any.
   *
   * Only one pass may run at a time. Triggers arrive in bursts — `visibilitychange`, `focus`
   * and `pageshow` fire together on web — and two passes at once would each wire, reuse, or
   * close the same transports, so one would tear a connection out from under the other.
   */
  private inFlight: Promise<SyncPass> | null = null;
  /** The one follow-up pass owed to triggers that arrived during `inFlight`. */
  private queuedPass: Promise<SyncPass> | null = null;

  constructor(private readonly deps: SyncRuntimeDeps) {}

  /**
   * The transports in use right now, in the order the session tries them.
   *
   * Empty until the first pass wires anything.
   */
  get transports(): readonly SyncTransport[] {
    return this.wiring?.transports ?? [];
  }

  /** The cached verdict, with no network access. Safe to call on every paint. */
  health(): Promise<RelayHealth> {
    return this.deps.storage.transact((tx) => readRelayHealth(tx));
  }

  /**
   * Measures the relay now. Backs the "Check now" button.
   *
   * Never throws; a health check that can fail is a health check that produces an error banner
   * every time a laptop is opened on a train.
   */
  checkRelay(signal?: AbortSignal): Promise<RelayHealth> {
    const { storage, nowIso = defaultNowIso, requestTimeoutMs } = this.deps;
    return checkRelayHealth({
      fetch: this.deps.fetch ?? expoFetch,
      timeoutMs: requestTimeoutMs,
      transact: (work) => storage.transact(work, { silent: true }),
      nowIso,
      signal,
    });
  }

  /**
   * One full pass: seal, reproject, exchange with every peer, then measure the relay.
   *
   * Health is measured *after* the exchange rather than before, and the order is the whole
   * point: a relay that answers `/health` while refusing every upload is exactly the case a
   * pre-flight probe reports as fine. Checking afterwards folds this pass's uploads into the
   * verdict, so "relay errors" appears on the launch it happened rather than the next one.
   */
  reconcile(signal?: AbortSignal): Promise<SyncPass> {
    if (this.inFlight) {
      // Coalesced: however many triggers arrive during a pass, exactly one more pass runs after
      // it, and every caller in the meantime shares that one promise.
      if (!this.queuedPass) {
        this.queuedPass = this.inFlight
          .then(
            () => undefined,
            () => undefined,
          )
          .then(() => {
            this.queuedPass = null;
            return this.reconcile(signal);
          });
      }
      return this.queuedPass;
    }
    const run = this.runPass(signal).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  private async runPass(signal?: AbortSignal): Promise<SyncPass> {
    const { storage } = this.deps;

    const [enabled, endpoints] = await storage.transact(async (tx) => {
      const meta = await readMeta(tx, [SYNC_META.enabled]);
      return [
        meta.get(SYNC_META.enabled) === "1",
        await readEndpoints(tx),
      ] as const;
    });

    if (!enabled) {
      // Closed rather than left wired. "Off" that keeps a transport live is not off.
      await this.dropWiring();
      return { reason: "disabled", outcome: null, health: await this.health() };
    }

    const vault = await this.readVault();
    if (typeof vault === "string") {
      await this.dropWiring();
      return { reason: vault, outcome: null, health: await this.health() };
    }

    const wiring = this.wire(vault, endpoints);
    const outcome = await wiring.session.reconcile(signal);

    // Drained before measuring, so the run of upload failures this pass produced is the run
    // the verdict is computed from.
    await this.healthWrites;
    const health =
      endpoints.relayUrl && endpoints.relayEnabled
        ? await this.checkRelay(signal)
        : await this.health();

    return { reason: "ok", outcome, health };
  }

  /**
   * Tears down every connection. Called on sign-out, reset, and when sync is switched off.
   *
   * Waits for a pass in flight first, because that pass is using these transports and closing
   * them under it would fail its exchange partway through. Pass errors are that pass's own.
   */
  async close(): Promise<void> {
    if (this.inFlight) await this.inFlight.catch(() => undefined);
    await this.dropWiring();
  }

  /**
   * Closes the cached transports without waiting. Used from inside a pass, which cannot wait
   * on itself.
   */
  private async dropWiring(): Promise<void> {
    const held = this.wiring;
    this.wiring = null;
    this.lastUpload = null;
    if (!held) return;
    await Promise.all(held.transports.map((transport) => transport.close()));
  }

  /**
   * Seals everything the peers are missing into one file the user carries themselves.
   *
   * The whole point of this path is that it involves nobody. No relay, no signaling,
   * export here, move the file by whatever means you like, import it there. It is
   * the answer when the relay is down, when two devices are never on the same network, and
   * when someone would simply rather no server existed at all.
   *
   * This runs a **full pass** rather than reaching into the outbox directly, so a bundle is
   * built from the same sealed, reprojected, repaired state a live sync would send. Doing it
   * by hand would be a second definition of "what does this peer still need", and the two
   * would drift.
   *
   * Exporting twice is harmless. Delivery is tracked by the peer's acknowledgement, not by
   * the act of sending, so ops stay queued until a peer confirms them and a file that is
   * never opened costs nothing but a second export.
   */
  async exportBundle(signal?: AbortSignal): Promise<BundleExport> {
    const wired = await this.fileWiring();
    if (typeof wired === "string")
      return { reason: wired, text: "", frames: 0, peers: 0 };

    try {
      const outcome = await wired.session.reconcile(signal);
      const bundle = wired.file.bundle();
      return {
        reason: "ok",
        text: encodeBundle(bundle),
        frames: bundle.frames.length,
        peers: outcome.pushed.filter(
          (push) => push.ops > 0 || push.needsFullState.length > 0,
        ).length,
      };
    } finally {
      await wired.file.close();
    }
  }

  /**
   * Applies a `.qashysync` file exported by another device in this vault.
   *
   * `bundle.from` is used to name the channel and for nothing else, and it does not need to be
   * trusted: every frame's sender, recipient, epoch, and sequence are bound into its associated
   * data, so a file claiming to come from the wrong device produces frames that do not open.
   * The failure is a rejection, not a bad merge.
   *
   * Frames are applied **one at a time, in file order**, which is the reason this does not
   * simply hand the channel to `session.attach`. That pump is fire-and-forget — right for a
   * live transport, where frames arrive spread over a connection — but here every frame is
   * present at once, and letting a dozen `absorb` calls interleave would offer batches to the
   * chain verifier out of order. Each would then be rejected as a gap, and the import would
   * fail wholesale on a file that is perfectly good.
   */
  async importBundle(text: string): Promise<BundleImport> {
    // Decoded before anything reaches for a key, so a file that is not a bundle at all is
    // refused instantly rather than after a Keychain or passphrase prompt.
    const bundle = decodeBundle(text);

    const wired = await this.fileWiring();
    if (typeof wired === "string") {
      return {
        reason: wired,
        from: "",
        accepted: 0,
        skipped: bundle.frames.length,
        applied: 0,
        rejected: 0,
      };
    }

    try {
      // The file names its sender only by route tag, so the sender is found by recomputing
      // each roster member's tag over the file window. A file from a device this vault does not
      // know is refused whole, which is also what the receive path would do frame by frame.
      const senderId = await this.resolveSender(bundle.from, wired.vault);
      if (!senderId) {
        // Nothing here can open these frames, so the ones addressed to this device are refused
        // and the rest are, as always, simply for somebody else.
        const addressed = bundle.frames.filter((held) =>
          wired.recipients.has(held.to),
        ).length;
        return {
          reason: "ok",
          from: "",
          accepted: 0,
          skipped: bundle.frames.length - addressed,
          applied: 0,
          rejected: addressed,
        };
      }
      const channel = await wired.file.connect({
        deviceId: senderId,
        name: "",
      });
      const collected: { frame: Uint8Array; seq: number }[] = [];
      const detach = channel.onFrame((frame, seq) => {
        collected.push({ frame, seq });
      });
      // `ingest` drops frames addressed to another device by comparing route tags, so what is
      // collected is exactly this device's share of the file.
      wired.file.ingest({ ...bundle, from: senderId });
      detach();

      let applied = 0;
      let rejected = 0;
      for (const held of collected) {
        const outcome = await wired.session.absorb(
          channel,
          held.frame,
          held.seq,
        );
        if (outcome) applied += outcome.applied;
        else rejected += 1;
      }

      return {
        reason: "ok",
        from: senderId,
        accepted: collected.length,
        skipped: bundle.frames.length - collected.length,
        applied,
        rejected,
      };
    } finally {
      await wired.file.close();
    }
  }

  /**
   * Empties this vault's drop-box.
   *
   * A courtesy rather than a security measure — the blobs expire on their own and are
   * unreadable regardless — but leaving a fortnight of undeliverable ciphertext on someone
   * else's server when the vault it belongs to no longer exists is untidy in a way this app
   * should not be. Silently does nothing when no relay is configured.
   */
  async purgeRelay(): Promise<void> {
    const endpoints = await this.deps.storage.transact((tx) =>
      readEndpoints(tx),
    );
    if (!endpoints.relayUrl) return;
    const vault = await this.readVault();
    if (typeof vault === "string") return;
    await this.buildRelay(vault, endpoints)?.purge();
  }

  /** The UTC day number now, from the same clock the rest of the runtime uses. */
  private today(): number {
    return routeDayOf((this.deps.now ?? Date.now)());
  }

  /**
   * The recipient tags a file import accepts for this device: its own tag on each day of the file
   * window. Built per call, so a file opened on a later day is still matched.
   */
  private fileRecipientTags(vault: StoredVault): ReadonlySet<string> {
    const self = vault.identity.deviceId;
    return new Set(
      daysEndingAt(this.today(), FILE_ROUTE_WINDOW_DAYS).map((day) =>
        tagOn(vault, self, day),
      ),
    );
  }

  /**
   * The roster device a bundle's `from` names, or `''` when none does.
   *
   * Compares route tags over the file window, which is how every other device addresses this one,
   * so a file reveals nothing a relay blob would not. A bare device id is also accepted, because
   * files exported before the sender was blinded carry one; the frames still have to open under
   * that id, so accepting it adds no trust.
   */
  private async resolveSender(
    claimed: string,
    vault: StoredVault,
  ): Promise<string> {
    const roster = await this.deps.storage.transact((tx) => readRoster(tx));
    const days = daysEndingAt(this.today(), FILE_ROUTE_WINDOW_DAYS);
    for (const peer of roster.values()) {
      if (peer.deviceId === vault.identity.deviceId) continue;
      if (claimed === peer.deviceId) return peer.deviceId;
      for (const day of days) {
        if (tagOn(vault, peer.deviceId, day) === claimed) return peer.deviceId;
      }
    }
    return "";
  }

  /** The vault, or the reason there isn't one. */
  private async readVault(): Promise<
    StoredVault | Exclude<SyncPassReason, "ok" | "disabled">
  > {
    try {
      const vault = await this.deps.keystore.read();
      return vault ?? "unpaired";
    } catch (error) {
      // Narrow rather than a blanket catch: a locked keystore is an ordinary state with an
      // obvious remedy, and a corrupt one is a bug. Swallowing anything else here would hide
      // a real failure behind "not paired yet" and send the user to re-pair a working vault.
      if (error instanceof KeystoreError) {
        return error.code === "locked" ? "locked" : "unavailable";
      }
      throw error;
    }
  }

  /**
   * The transports and session for this vault and configuration, reusing them when nothing
   * relevant has changed.
   *
   * The fingerprint is what makes reuse safe. Never rebuilding would leave a device uploading to a relay the user replaced
   * ten minutes ago, or sealing under a key that has since been rotated.
   */
  private wire(vault: StoredVault, endpoints: SyncEndpoints): Wiring {
    const fingerprint = [
      vault.identity.deviceId,
      vault.epoch,
      endpoints.relayUrl,
      endpoints.relayEnabled ? "1" : "0",
    ].join("\0");

    const held = this.wiring;
    if (held?.fingerprint === fingerprint) return held;
    // Not awaited: the caller wants a session now, and the old wiring's teardown is a set of
    // channel closes with nothing to report. Errors go to `onError` rather than nowhere.
    if (held) {
      void Promise.all(
        held.transports.map((transport) => transport.close()),
      ).catch((error: unknown) => this.deps.onError?.(error));
    }

    const relay = this.buildRelay(vault, endpoints);
    const transports: SyncTransport[] = relay ? [relay] : [];

    const built: Wiring = {
      fingerprint,
      session: this.buildSession(vault, transports),
      transports,
      relay,
    };
    this.wiring = built;
    this.lastUpload = null;
    return built;
  }

  /**
   * A session over the given transports.
   *
   * Shared by the cached wiring and the one-shot file path so the frame context is derived in
   * exactly one place. Two constructions of `{ key, deviceId, epoch }` could disagree about the
   * epoch after a rotation, and a bundle sealed under a stale epoch is one every peer refuses
   * for a reason nobody would think to look for in an export button.
   */
  private buildSession(
    vault: StoredVault,
    transports: readonly SyncTransport[],
  ): SyncSession {
    return new SyncSession({
      storage: this.deps.storage,
      repository: this.deps.repository,
      deviceId: vault.identity.deviceId,
      signingKey: vault.identity.signing.secretKey,
      frame: {
        key: deriveContentKey(vault.vaultKey),
        deviceId: vault.identity.deviceId,
        epoch: vault.epoch,
      },
      transports,
      now: this.deps.now ?? Date.now,
      nowIso: this.deps.nowIso ?? defaultNowIso,
      onError: this.deps.onError,
    });
  }

  /**
   * A throwaway file transport and the session that drives it, or why there isn't one.
   *
   * Deliberately not cached alongside `this.wiring`. A `FileTransport` accumulates the frames
   * it was handed so it can write them out, so a cached one would grow for the life of the app
   * and a second export would contain the first export's frames as well. It is also the one
   * transport with nothing to keep alive — there is no connection to preserve between passes.
   */
  private async fileWiring(): Promise<
    | {
        readonly file: FileTransport;
        readonly session: SyncSession;
        readonly vault: StoredVault;
        /** The tags this device accepts on import, over the file window. */
        readonly recipients: ReadonlySet<string>;
      }
    | Exclude<SyncPassReason, "ok">
  > {
    const enabled = await this.deps.storage.transact(async (tx) => {
      const meta = await readMeta(tx, [SYNC_META.enabled]);
      return meta.get(SYNC_META.enabled) === "1";
    });
    // Checked rather than inferred from an empty bundle. Change capture is armed only while
    // sync is on, so exporting with it off would produce a valid, empty, entirely misleading
    // file, and importing would apply frames this device has no op log to reconcile against.
    if (!enabled) return "disabled";

    const vault = await this.readVault();
    if (typeof vault === "string") return vault;

    const today = this.today();
    const recipients = this.fileRecipientTags(vault);
    const file = new FileTransport({
      deviceId: vault.identity.deviceId,
      selfTag: tagOn(vault, vault.identity.deviceId, today),
      recipientTags: recipients,
      tagFor: (peerId) => tagOn(vault, peerId, today),
    });
    return {
      file,
      session: this.buildSession(vault, [file]),
      vault,
      recipients,
    };
  }

  private buildRelay(
    vault: StoredVault,
    endpoints: SyncEndpoints,
  ): RelayTransport | null {
    if (!endpoints.relayUrl || !endpoints.relayEnabled) return null;
    const { storage, onError } = this.deps;
    const self = vault.identity.deviceId;
    // Tags are derived on each call, against the day that is current then. A channel or a
    // transport built before midnight therefore addresses and accepts the new day's tags after it.
    const today = () => this.today();

    return new RelayTransport({
      fetch: this.deps.fetch ?? expoFetch,
      timeoutMs: this.deps.requestTimeoutMs,
      baseUrl: endpoints.relayUrl,
      bucketId: deriveBucketId(vault.vaultKey),
      token: toBase64Url(deriveBucketToken(vault.vaultKey)),
      selfTag: () => tagOn(vault, self, today()),
      recipientTags: () =>
        new Set(
          daysEndingAt(today(), RELAY_ROUTE_DAYS).map((day) =>
            tagOn(vault, self, day),
          ),
        ),
      tagFor: (peerId) => tagOn(vault, peerId, today()),
      // Only active roster members may send to this device, each under today's and yesterday's
      // tag. Read per poll, so a device revoked since the last one stops being held for at once.
      senderTags: async () => {
        const roster = await storage.transact((tx) => readRoster(tx));
        const days = daysEndingAt(today(), RELAY_ROUTE_DAYS);
        const senders = new Map<string, string>();
        for (const peer of activePeers(roster)) {
          if (peer.deviceId === self) continue;
          for (const day of days) {
            senders.set(tagOn(vault, peer.deviceId, day), peer.deviceId);
          }
        }
        return senders;
      },
      onPollError: (error) => this.notePollFailure(error),
      onDropped: (error) => onError?.(error),
      // The cursor is device-local and non-secret: it counts slots in the bucket, and a
      // reader who knew it would learn how far behind this device is and nothing else.
      readCursor: () =>
        storage.transact(async (tx) => {
          const meta = await readMeta(tx, [SYNC_META.relayCursor]);
          const stored = Number(meta.get(SYNC_META.relayCursor));
          return Number.isSafeInteger(stored) && stored > 0 ? stored : 0;
        }),
      writeCursor: (slot) =>
        storage.transact(
          (tx) => writeMeta(tx, { [SYNC_META.relayCursor]: String(slot) }),
          {
            silent: true,
          },
        ),
      onUpload: (error) => this.noteUpload(error),
      jitterMs: this.deps.uploadJitterMs,
    });
  }

  /**
   * A bucket that could not be read, recorded like any other relay failure.
   *
   * Counted toward the same degraded verdict as failed uploads, and logged so the user can see
   * *why* the relay reads as broken. Written through the same serial chain as health so two
   * failures cannot both read the same count.
   */
  private notePollFailure(error: unknown): void {
    const { storage, nowIso = defaultNowIso, onError } = this.deps;
    onError?.(error);
    this.healthWrites = this.healthWrites
      .then(async () => {
        const at = nowIso();
        await storage.transact(
          async (tx) => {
            await noteRelayFailure(tx, error, at);
            await appendActivity(tx, [
              activityEntry({
                kind: "relay",
                recordedAt: at,
                code: activityCode(error),
                detail: transportDetail(error),
              }),
            ]);
          },
          { silent: true },
        );
      })
      .catch((failure: unknown) => {
        onError?.(failure);
      });
  }

  private noteUpload(error: unknown | null): void {
    const result = error ? "failed" : "ok";
    if (result === "ok" && this.lastUpload === "ok") return;
    this.lastUpload = result;

    const { storage, nowIso = defaultNowIso, onError } = this.deps;
    this.healthWrites = this.healthWrites
      .then(async () => {
        const at = nowIso();
        await storage.transact(
          async (tx) => {
            if (error) await noteRelayFailure(tx, error, at);
            else await noteRelaySuccess(tx, at);
          },
          { silent: true },
        );
      })
      .catch((failure: unknown) => {
        // Not rethrown: this chain is shared by every subsequent upload, and a rejection left
        // on it would make each later one fail for a reason that has nothing to do with it.
        onError?.(failure);
      });
  }
}
