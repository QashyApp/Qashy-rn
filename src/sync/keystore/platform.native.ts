/**
 * Android key storage: the Android Keystore, through `expo-secure-store`.
 *
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` is doing two distinct things and both matter:
 *
 * - *WHEN_UNLOCKED* — the vault is unreadable while the phone is locked. Sync runs in the
 *   foreground only (see the plan's §3.6), so there is no background task that would need
 *   the key at a moment the user is not present, and nothing is given up by the stricter
 *   setting. (The opt-in background check-in, `sync/background.ts`, reads the key too. It is
 *   deliberately not given a weaker accessibility class: when the keystore will not answer
 *   because the device is locked, that wake simply skips and the next one tries again.)
 * - *THIS_DEVICE_ONLY* — the entry is excluded from cloud and device-transfer
 *   backups. That is the point of the whole design: a device key that syncs itself to
 *   a cloud is a device key a provider can be compelled to produce. Restoring a backup onto a new
 *   phone gives you the app without the vault, and the recovery phrase is how you get the
 *   vault back. That is the intended, honest path.
 *
 * `requireAuthentication` (a fingerprint on every read) is deliberately *not* set.
 * It prompts for **every** operation including writes, which would put a
 * biometric prompt in front of an ordinary background sync, and the key is
 * invalidated whenever the enrolled biometrics change — which would silently destroy the
 * vault when a user adds a fingerprint. It belongs behind an explicit opt-in with that
 * consequence spelled out, not on by default.
 */

import * as SecureStore from "expo-secure-store";

import { fromBase64Url, toBase64Url } from "@/sync/crypto";

import { BaseKeystore } from "@/sync/keystore/base";
import type { SyncKeystore } from "@/sync/keystore/types";

/**
 * Keys may only contain alphanumerics, `.`, `-` and `_`. The `v1` suffix is the escape
 * hatch for a future record format that cannot be migrated in place.
 */
const STORE_KEY = "qashy.sync.vault.v1";

// The `keychain*` option names are expo-secure-store's; they are kept exactly as first written so
// existing vaults keep resolving.
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: "app.qashy.sync",
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

class SecureStoreKeystore extends BaseKeystore {
  readonly kind: SyncKeystore["kind"] = "secure-store";

  /** The OS unlock is already the gate. See `SyncKeystore.supportsPassphrase`. */
  readonly supportsPassphrase = false;

  protected override available() {
    return SecureStore.isAvailableAsync();
  }

  protected async readContainer() {
    const value = await SecureStore.getItemAsync(STORE_KEY, OPTIONS);
    return value ? fromBase64Url(value) : null;
  }

  protected async writeContainer(bytes: Uint8Array) {
    // ~140 base64url characters for an unguarded record, far below the 2048-byte limit
    // that pushes SecureStore onto its file-backed fallback path on Android.
    await SecureStore.setItemAsync(STORE_KEY, toBase64Url(bytes), OPTIONS);
  }

  protected async eraseContainer() {
    await SecureStore.deleteItemAsync(STORE_KEY, OPTIONS);
  }
}

export const createPlatformKeystore = (): SyncKeystore =>
  new SecureStoreKeystore();
