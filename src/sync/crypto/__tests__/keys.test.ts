import {
  DEVICE_ID_LENGTH,
  createDeviceIdentity,
  createPairingSecret,
  createVaultRootKey,
  deriveBackupKey,
  deriveBucketId,
  deriveBucketToken,
  deriveContentKey,
  deriveDeviceId,
  ROUTE_DAY_MS,
  derivePairingRendezvousId,
  deriveRouteTag,
  deviceIdentityBytes,
  formatDeviceId,
  restoreDeviceIdentity,
  routeDayOf,
} from "@/sync/crypto/keys";
import {
  fromHex,
  signingPublicKeyFrom,
  toBase32,
  toHex,
  utf8Bytes,
} from "@/sync/crypto/primitives";
import { brand, type VaultRootKey } from "@/sync/crypto/types";

const vault = createVaultRootKey();
const otherVault = createVaultRootKey();

describe("key hierarchy", () => {
  it("derives every branch to a distinct 32-byte key", () => {
    const derived = [
      deriveContentKey(vault),
      deriveBackupKey(vault),
      deriveBucketToken(vault),
    ];
    for (const key of derived) expect(key).toHaveLength(32);

    const distinct = new Set(derived.map(toHex));
    expect(distinct.size).toBe(derived.length);
  });

  it("never reproduces the root key in a derived branch", () => {
    // A derivation that leaked the root would hand the relay — which legitimately receives
    // the bucket token — everything needed to decrypt the vault.
    const root = toHex(vault);
    expect(toHex(deriveContentKey(vault))).not.toBe(root);
    expect(toHex(deriveBucketToken(vault))).not.toBe(root);
    expect(toHex(deriveBackupKey(vault))).not.toBe(root);
  });

  it("is deterministic, so two devices holding the same vault agree without talking", () => {
    expect(toHex(deriveContentKey(vault))).toBe(toHex(deriveContentKey(vault)));
    expect(deriveBucketId(vault)).toBe(deriveBucketId(vault));
  });

  it("separates vaults completely", () => {
    expect(toHex(deriveContentKey(vault))).not.toBe(
      toHex(deriveContentKey(otherVault)),
    );
    expect(deriveBucketId(vault)).not.toBe(deriveBucketId(otherVault));
  });

  it("produces a bucket id that is opaque base32 and reveals nothing about the key", () => {
    const bucketId = deriveBucketId(vault);
    expect(bucketId).toMatch(/^[A-Z2-7]{52}$/);
    expect(bucketId).not.toContain(toHex(vault).slice(0, 8));
  });

  it("makes fresh pairing secrets", () => {
    expect(toHex(createPairingSecret())).not.toBe(toHex(createPairingSecret()));
  });
});

describe("the pairing rendezvous", () => {
  it("is a function of the pairing secret alone, so both devices compute it without talking", () => {
    const secret = createPairingSecret();
    expect(derivePairingRendezvousId(secret)).toBe(
      derivePairingRendezvousId(secret),
    );
    expect(derivePairingRendezvousId(secret)).toMatch(/^[A-Z2-7]{52}$/);
  });

  it("gives every pairing attempt its own meeting point", () => {
    expect(derivePairingRendezvousId(createPairingSecret())).not.toBe(
      derivePairingRendezvousId(createPairingSecret()),
    );
  });

  it("reveals nothing about the secret it came from", () => {
    const secret = createPairingSecret();
    expect(derivePairingRendezvousId(secret)).not.toContain(
      toBase32(secret).slice(0, 8),
    );
  });
});

describe("device identity", () => {
  it("derives the id from the signing key, so a claimed id can be checked", () => {
    const identity = createDeviceIdentity();
    expect(identity.deviceId).toHaveLength(DEVICE_ID_LENGTH);
    expect(identity.deviceId).toMatch(/^[A-Z2-7]+$/);
    expect(deriveDeviceId(identity.signing.publicKey)).toBe(identity.deviceId);
  });

  it("pins the derivation to a fixed key, so the id format cannot drift silently", () => {
    // The RFC 8032 test key. If this value ever changes, every previously-paired device
    // becomes unrecognisable to a new build — so it is frozen deliberately.
    const publicKey = signingPublicKeyFrom(
      fromHex(
        "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
      ),
    );
    expect(deriveDeviceId(publicKey)).toBe("CJ6MEFSHJRK2SNG44OYRYSEEX2");
  });

  it("gives different devices different ids", () => {
    expect(createDeviceIdentity().deviceId).not.toBe(
      createDeviceIdentity().deviceId,
    );
  });

  it("rebuilds the whole identity from the two secrets the keystore holds", () => {
    const identity = createDeviceIdentity();
    const restored = restoreDeviceIdentity(
      identity.signing.secretKey,
      identity.agreement.secretKey,
    );
    expect(restored.deviceId).toBe(identity.deviceId);
    expect(toHex(restored.signing.publicKey)).toBe(
      toHex(identity.signing.publicKey),
    );
    expect(toHex(restored.agreement.publicKey)).toBe(
      toHex(identity.agreement.publicKey),
    );
  });

  it("keeps signing and agreement keys separate", () => {
    const identity = createDeviceIdentity();
    expect(toHex(identity.signing.secretKey)).not.toBe(
      toHex(identity.agreement.secretKey),
    );
    expect(toHex(identity.signing.publicKey)).not.toBe(
      toHex(identity.agreement.publicKey),
    );
  });

  it("groups the id for display without changing it", () => {
    expect(formatDeviceId("ABCDEFGHIJKLMNOPQRSTUVWXYZ")).toBe(
      "ABCDEFG-HIJKLMN-OPQRSTU-VWXYZ",
    );
    expect(formatDeviceId("ABCDEFGHIJKLMNOPQRSTUVWXYZ").replace(/-/g, "")).toBe(
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    );
  });

  it("commits a roster entry to the id and both public keys together", () => {
    const identity = createDeviceIdentity();
    const bytes = deviceIdentityBytes(
      identity.deviceId,
      identity.signing.publicKey,
      identity.agreement.publicKey,
    );
    expect(bytes).toHaveLength(utf8Bytes(identity.deviceId).length + 64);
    // Swapping the two keys must not produce the same commitment.
    expect(toHex(bytes)).not.toBe(
      toHex(
        deviceIdentityBytes(
          identity.deviceId,
          identity.agreement.publicKey,
          identity.signing.publicKey,
        ),
      ),
    );
  });
});

describe("route tags", () => {
  // Golden vectors. The root key is bytes 0x00..0x1f. Computed independently from the raw noble
  // primitives (HKDF-SHA256, label "qashy/sync/route/v2/day", salt = u32be(epoch) ‖ u32be(day) ‖
  // utf8(deviceId)) and then base32-encoded, so a refactor cannot silently change the wire tags.
  const goldenKey = brand<VaultRootKey>(
    Uint8Array.from({ length: 32 }, (_, index) => index),
  );
  const DEVICE = "CJ6MEFSHJRK2SNG44OYRYSEEX2";

  it("pins the derivation to known answers", () => {
    expect(deriveRouteTag(goldenKey, 1, 20000, DEVICE)).toBe(
      "OPXBBTPCNTYI32YT",
    );
    expect(deriveRouteTag(goldenKey, 1, 20001, DEVICE)).toBe(
      "74UBCYPAZE4ZEKCD",
    );
    expect(deriveRouteTag(goldenKey, 2, 20000, DEVICE)).toBe(
      "6YGIEPY2STRV6CXS",
    );
    expect(
      deriveRouteTag(goldenKey, 1, 20000, "ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
    ).toBe("3ZCHID4WJFIDQ524");
  });

  it("produces a 16-character opaque base32 tag", () => {
    expect(deriveRouteTag(goldenKey, 1, 20000, DEVICE)).toMatch(
      /^[A-Z2-7]{16}$/,
    );
  });

  it("changes on the next UTC day, so the relay cannot link a device across days", () => {
    expect(deriveRouteTag(goldenKey, 1, 20000, DEVICE)).not.toBe(
      deriveRouteTag(goldenKey, 1, 20001, DEVICE),
    );
  });

  it("changes on a new vault epoch, so a rotated vault shares nothing with the old one", () => {
    expect(deriveRouteTag(goldenKey, 1, 20000, DEVICE)).not.toBe(
      deriveRouteTag(goldenKey, 2, 20000, DEVICE),
    );
  });

  it("is stable within a day and separates devices", () => {
    expect(deriveRouteTag(goldenKey, 1, 20000, DEVICE)).toBe(
      deriveRouteTag(goldenKey, 1, 20000, DEVICE),
    );
    expect(deriveRouteTag(goldenKey, 1, 20000, DEVICE)).not.toBe(
      deriveRouteTag(goldenKey, 1, 20000, "ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
    );
  });

  it("separates vaults on the same day and epoch", () => {
    expect(deriveRouteTag(vault, 1, 20000, DEVICE)).not.toBe(
      deriveRouteTag(otherVault, 1, 20000, DEVICE),
    );
  });

  it("numbers days in UTC, flooring so one day is one number", () => {
    const midnight = Date.UTC(2026, 9, 8);
    expect(ROUTE_DAY_MS).toBe(86_400_000);
    expect(routeDayOf(midnight)).toBe(20734);
    expect(routeDayOf(midnight + ROUTE_DAY_MS - 1)).toBe(20734);
    expect(routeDayOf(midnight - 1)).toBe(20733);
    expect(routeDayOf(midnight + ROUTE_DAY_MS)).toBe(20735);
  });
});

describe("a zero vault key", () => {
  it("still derives, because rejecting it is the keystore’s job and not this layer’s", () => {
    // Recorded so the behaviour is a decision rather than an accident: `createVaultRootKey`
    // is the only sanctioned source, and it never produces this.
    const zeroed = brand<VaultRootKey>(new Uint8Array(32));
    expect(deriveContentKey(zeroed)).toHaveLength(32);
  });
});
