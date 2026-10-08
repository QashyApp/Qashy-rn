/**
 * Browser key storage: IndexedDB, with the record encrypted under a **non-extractable**
 * `CryptoKey` that itself lives in IndexedDB.
 *
 * Be precise about what this buys, because it is easy to oversell. A browser has no
 * Keychain, so the vault record has to live in origin storage one way or another. Wrapping
 * it under a key generated with `extractable: false` means the raw key bytes never exist
 * as JavaScript-reachable data: a script that runs in this origin can *use* the key while
 * it runs, but it cannot serialise it, post it to a server, or carry it away. Neither can
 * anything reading the profile directory off a stolen laptop, since what is on disk is a
 * browser-internal key handle plus ciphertext.
 *
 * What it does **not** stop is script executing in this origin right now — that script can
 * simply ask the key to decrypt. The defences against that are the ones in the plan's
 * §1.6: a strict CSP, no third-party scripts, no analytics, no remote code, and an empty
 * `runtimeCaching`. The optional passphrase gate (`setPassphrase`) is the answer to the
 * other half of the problem — a laptop stolen while logged in — and it is a second,
 * independent layer over this one rather than a replacement for it.
 */

import { BaseKeystore } from "@/sync/keystore/base";
import { KeystoreError, type SyncKeystore } from "@/sync/keystore/types";

const DB_NAME = "qashy-keystore";
const DB_VERSION = 1;
const STORE = "vault";
const WRAP_ID = "wrap";
const CONTAINER_ID = "container";

/** AES-GCM rather than XChaCha20 here only because this layer must use WebCrypto — a key
 *  the browser refuses to export can only be driven through `crypto.subtle`. The IV is
 *  fresh per write and 96 bits, which is exactly the case GCM's nonce size is safe for:
 *  one key, one writer, one nonce per write. */
const WRAP_ALGORITHM = { name: "AES-GCM", length: 256 } as const;
const IV_BYTES = 12;

interface ContainerRow {
  readonly id: typeof CONTAINER_ID;
  readonly iv: Uint8Array;
  readonly data: Uint8Array;
}

interface WrapRow {
  readonly id: typeof WRAP_ID;
  readonly key: CryptoKey;
}

/**
 * WebCrypto's `BufferSource` insists on an `ArrayBuffer`-backed view, while a `Uint8Array`
 * read back out of IndexedDB is typed over the wider `ArrayBufferLike`. Copying settles it
 * at a cost that does not register on a 105-byte record.
 */
const bufferSource = (bytes: Uint8Array) => Uint8Array.from(bytes);

const corruptVault = () =>
  new KeystoreError(
    "The vault stored on this device is damaged and cannot be opened. Erase sync data on this device and pair it again.",
    "corrupt",
  );

const request = <T>(source: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    source.onsuccess = () => resolve(source.result);
    source.onerror = () =>
      reject(source.error ?? new Error("IndexedDB request failed."));
  });

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) {
        open.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    open.onsuccess = () => {
      // A second tab that ships a newer schema must not be blocked indefinitely waiting
      // for this one to go away — that is a hang with no visible cause.
      open.result.onversionchange = () => open.result.close();
      resolve(open.result);
    };
    open.onerror = () =>
      reject(open.error ?? new Error("Could not open the Qashy keystore."));
    open.onblocked = () =>
      reject(
        new KeystoreError(
          "Close other Qashy tabs and try again.",
          "unavailable",
        ),
      );
  });

async function withStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => Promise<T>,
) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, mode);
    const result = await work(transaction.objectStore(STORE));
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Keystore transaction aborted."));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Keystore transaction failed."));
    });
    return result;
  } finally {
    database.close();
  }
}

class BrowserKeystore extends BaseKeystore {
  readonly kind: SyncKeystore["kind"] = "browser";

  /** A browser profile has no OS-level unlock, so the gate is worth offering here. */
  readonly supportsPassphrase = true;

  protected override async available() {
    return (
      typeof indexedDB !== "undefined" &&
      typeof globalThis.crypto?.subtle !== "undefined"
    );
  }

  protected async readContainer() {
    const row = await withStore("readonly", (store) =>
      request<ContainerRow | undefined>(store.get(CONTAINER_ID)),
    );
    if (!row) return null;
    // A read must never mint a wrapping key. A container with no key beside it is damage, not
    // a fresh start: minting one here would make the damage look like a clean vault that simply
    // fails to decrypt, and would never tell the user what happened.
    const key = await this.existingWrappingKey();
    if (!key) throw corruptVault();
    try {
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bufferSource(row.iv) },
        key,
        bufferSource(row.data),
      );
      return new Uint8Array(plain);
    } catch {
      // WebCrypto reports a failed AEAD as a bare DOMException, which is not something to show
      // a user or to branch on. Translated to the module's taxonomy; the ciphertext is untouched.
      throw corruptVault();
    }
  }

  protected async writeContainer(bytes: Uint8Array) {
    const key = await this.wrappingKey();
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const sealed = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      bufferSource(bytes),
    );
    const row: ContainerRow = {
      id: CONTAINER_ID,
      iv,
      data: new Uint8Array(sealed),
    };
    await withStore("readwrite", (store) => request(store.put(row)));
  }

  protected async eraseContainer() {
    // The wrapping key goes too. Leaving it behind would mean a later pairing reuses a key
    // that a previous vault's ciphertext was written under, and there is no reason to.
    await withStore("readwrite", async (store) => {
      await request(store.delete(CONTAINER_ID));
      await request(store.delete(WRAP_ID));
    });
  }

  /**
   * Returns the origin's wrapping key, generating it on first use.
   *
   * `generateKey` is async, and an IndexedDB transaction commits the moment control returns
   * to the event loop, so the generation cannot happen inside one. That opens a window
   * where two tabs both generate a key — hence the re-read inside the write transaction. A
   * loser that overwrote the winner's key would leave the stored ciphertext permanently
   * undecryptable, which is data loss, not a race to shrug at.
   */
  private async existingWrappingKey(): Promise<CryptoKey | null> {
    const existing = await withStore("readonly", (store) =>
      request<WrapRow | undefined>(store.get(WRAP_ID)),
    );
    return existing?.key ?? null;
  }

  private async wrappingKey(): Promise<CryptoKey> {
    const existing = await this.existingWrappingKey();
    if (existing) return existing;

    const generated = await crypto.subtle.generateKey(WRAP_ALGORITHM, false, [
      "encrypt",
      "decrypt",
    ]);
    return withStore("readwrite", async (store) => {
      const raced = await request<WrapRow | undefined>(store.get(WRAP_ID));
      if (raced) return raced.key;
      await request(
        store.put({ id: WRAP_ID, key: generated } satisfies WrapRow),
      );
      return generated;
    });
  }
}

export const createPlatformKeystore = (): SyncKeystore => new BrowserKeystore();
