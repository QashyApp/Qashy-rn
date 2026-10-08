/**
 * The key hierarchy.
 *
 * One root secret, everything else derived from it with a distinct HKDF label. That
 * structure is what lets the relay be handed a bucket identifier and a write token
 * without ever being handed anything that decrypts a byte: the bucket id is a one-way
 * function of the root key, so knowing it reveals nothing about the content key derived
 * from the same root under a different label.
 *
 * Device identity keys are generated *per device* and their private halves never leave
 * it. That is what makes revocation mean something — a shared symmetric key alone would
 * let any holder forge history indistinguishably from any other, and removing a device
 * from a roster would accomplish nothing.
 */

import { LABELS } from "@/sync/crypto/labels";
import {
  KEY_LENGTH,
  assertLength,
  concatBytes,
  hkdf,
  randomBytes,
  sha256,
  toBase32,
  u32be,
  utf8Bytes,
  agreementKeygen,
  agreementPublicKeyFrom,
  signingKeygen,
  signingPublicKeyFrom,
} from "@/sync/crypto/primitives";
import {
  brand,
  type AgreementKeyPair,
  type AgreementPublicKey,
  type AgreementSecretKey,
  type BackupKey,
  type BucketToken,
  type ContentKey,
  type PairingSecret,
  type SigningKeyPair,
  type SigningPublicKey,
  type SigningSecretKey,
  type VaultRootKey,
} from "@/sync/crypto/types";

/** Device ids are this many base32 characters — 130 bits of a SHA-256 digest. */
export const DEVICE_ID_LENGTH = 26;

const EMPTY_SALT = new Uint8Array(0);

/** Creates a brand new vault. Called exactly once, on the first device. */
export const createVaultRootKey = () =>
  brand<VaultRootKey>(randomBytes(KEY_LENGTH));

export const deriveContentKey = (vrk: VaultRootKey) =>
  brand<ContentKey>(hkdf(vrk, EMPTY_SALT, LABELS.content));

export const deriveBackupKey = (vrk: VaultRootKey) =>
  brand<BackupKey>(hkdf(vrk, EMPTY_SALT, LABELS.backup));

/**
 * The relay addresses blobs by this. It is an HKDF output, so it is opaque to the relay
 * and uncorrelated with anything else derived from the same root.
 */
export const deriveBucketId = (vrk: VaultRootKey) =>
  toBase32(hkdf(vrk, EMPTY_SALT, LABELS.bucket)).slice(0, 52);

/** A bare write capability. It authorizes a `PUT`; it identifies nobody. */
export const deriveBucketToken = (vrk: VaultRootKey) =>
  brand<BucketToken>(hkdf(vrk, EMPTY_SALT, LABELS.bucketAuth));

/** Route tags are this many base32 characters — 80 bits, far more than routing needs. */
export const ROUTE_TAG_LENGTH = 16;

/** One UTC day in milliseconds. Route tags rotate on UTC day boundaries. */
export const ROUTE_DAY_MS = 86_400_000;

/**
 * The UTC day number a route tag is derived for: whole days since the Unix epoch.
 *
 * Floored, so every instant within one UTC day maps to the same number. Callers that tolerate a
 * day of overlap read both today's and yesterday's number; see `runtime.ts`.
 */
export const routeDayOf = (nowMs: number) => Math.floor(nowMs / ROUTE_DAY_MS);

/**
 * The tag a relay blob is addressed to: one device, on one UTC day, within one vault epoch.
 *
 * A drop-box holds blobs for every device in the vault, so a reader has to know which ones are
 * for it. Writing the recipient's device id on the outside would answer that — and would hand the
 * relay a stable identifier derived from a public key, which could follow a device across days,
 * vaults and relays. This blinds it: only vault members can compute the tag, and the relay sees
 * only an unlinkable-looking value.
 *
 * It rotates twice. Per UTC day, so the relay cannot link one device's traffic across days (it
 * can within a day, and across midnight both today's and yesterday's tags are live). Per epoch,
 * because a key rotation changes the root key the tag is derived from.
 *
 * Input layout, unambiguous by construction: `salt = u32be(epoch) ‖ u32be(day) ‖ utf8(deviceId)`.
 * The first eight bytes are always the two fixed-width integers, so no two (epoch, day, deviceId)
 * triples can share a salt, whatever the device id's length. The label is `LABELS.routeDay`.
 */
export const deriveRouteTag = (
  vrk: VaultRootKey,
  epoch: number,
  day: number,
  deviceId: string,
) =>
  toBase32(
    hkdf(
      vrk,
      concatBytes(u32be(epoch), u32be(day), utf8Bytes(deviceId)),
      LABELS.routeDay,
    ),
  ).slice(0, ROUTE_TAG_LENGTH);

/** A fresh single-use pairing secret. Crosses the optical channel, never the network. */
export const createPairingSecret = () =>
  brand<PairingSecret>(randomBytes(KEY_LENGTH));

/**
 * The rendezvous a pairing pair meets at.
 *
 * Not keyed on the vault root key: the entire point of pairing is that the joining device does
 * not have it yet. The pairing secret is the only thing both devices hold at this
 * moment, and it reached the second device optically, so an id derived from it is one a network
 * observer cannot compute.
 *
 * Deliberately **not** windowed. A rotating id exists to stop a server linking one session to
 * the next, which needs the id to outlive a session; this one lives ninety seconds and is used
 * once, so rotation would buy nothing and would introduce a clock-straddling failure.
 */
export const derivePairingRendezvousId = (pairingSecret: PairingSecret) =>
  toBase32(hkdf(pairingSecret, EMPTY_SALT, LABELS.pairingRendezvous)).slice(
    0,
    52,
  );

// ---------------------------------------------------------------------------
// Device identity
// ---------------------------------------------------------------------------

export interface DeviceIdentity {
  readonly deviceId: string;
  readonly signing: SigningKeyPair;
  readonly agreement: AgreementKeyPair;
}

/**
 * Derives a device id from its signing public key.
 *
 * Because the id is a function of the key, a peer can check that a claimed id matches
 * the key presented in the handshake. An attacker cannot claim someone else's id without
 * also holding their private key, so identity spoofing is caught before the roster is
 * even consulted.
 */
export const deriveDeviceId = (
  signingPublicKey: SigningPublicKey | Uint8Array,
) =>
  toBase32(sha256(utf8Bytes(LABELS.device), signingPublicKey)).slice(
    0,
    DEVICE_ID_LENGTH,
  );

export const createDeviceIdentity = (): DeviceIdentity => {
  const signing = signingKeygen();
  const agreement = agreementKeygen();
  return {
    deviceId: deriveDeviceId(signing.publicKey),
    signing: {
      publicKey: brand<SigningPublicKey>(signing.publicKey),
      secretKey: brand<SigningSecretKey>(signing.secretKey),
    },
    agreement: {
      publicKey: brand<AgreementPublicKey>(agreement.publicKey),
      secretKey: brand<AgreementSecretKey>(agreement.secretKey),
    },
  };
};

/**
 * Rebuilds an identity from the two secret keys the keystore holds.
 *
 * Takes plain bytes rather than branded keys on purpose: the keystore reads a byte range
 * out of a stored record and has no legitimate way to brand it itself — `brand` is
 * deliberately not exported past this directory. Both halves are length-checked by the
 * public-key derivations below, so a truncated or corrupted read fails here rather than
 * producing an identity with a silently wrong device id.
 */
export const restoreDeviceIdentity = (
  signingSecret: Uint8Array,
  agreementSecret: Uint8Array,
): DeviceIdentity => {
  const signingPublic = brand<SigningPublicKey>(
    signingPublicKeyFrom(signingSecret),
  );
  return {
    deviceId: deriveDeviceId(signingPublic),
    signing: {
      publicKey: signingPublic,
      secretKey: brand<SigningSecretKey>(signingSecret),
    },
    agreement: {
      publicKey: brand<AgreementPublicKey>(
        agreementPublicKeyFrom(agreementSecret),
      ),
      secretKey: brand<AgreementSecretKey>(agreementSecret),
    },
  };
};

/**
 * Brands the public halves of a peer's identity.
 *
 * The counterpart to `restoreDeviceIdentity`, for the keys that arrive from somewhere else:
 * a roster row read back out of `sync_peers`, or a handshake hello. Neither the storage
 * layer nor the engine can brand them itself — `brand` deliberately stops at this directory
 * — and neither should be trusted to have got the length right.
 *
 * The length check is the substance. `sharedSecret` and `verify` both accept a short key by
 * throwing somewhere deep inside a curve implementation, which surfaces as "authentication
 * failed" and sends a user hunting for a pairing problem that does not exist. Failing here
 * says what is actually wrong: the stored row is corrupt.
 */
export const restorePeerKeys = (
  signingPublic: Uint8Array,
  agreementPublic: Uint8Array,
) => ({
  signingKey: brand<SigningPublicKey>(
    assertLength(signingPublic, KEY_LENGTH, "A peer's signing key"),
  ),
  agreementKey: brand<AgreementPublicKey>(
    assertLength(agreementPublic, KEY_LENGTH, "A peer's agreement key"),
  ),
});

/**
 * Brands bytes the keystore just read back as the vault root key.
 *
 * The length check is the whole point. Every other key in the system is derived from this
 * one, so a short read here would propagate into an HKDF call that happily accepts it and
 * yields a content key that decrypts nothing, with the failure surfacing several layers
 * away as "authentication failed".
 */
export const restoreVaultRootKey = (bytes: Uint8Array) =>
  brand<VaultRootKey>(assertLength(bytes, KEY_LENGTH, "Vault root key"));

/**
 * Formats a device id for display in groups of seven, the way a fingerprint should be
 * shown: humans compare grouped strings far more reliably than a 26-character run.
 */
export const formatDeviceId = (deviceId: string) =>
  (deviceId.match(/.{1,7}/g) ?? [deviceId]).join("-");

/** The bytes a roster entry commits to. Exported so `handshake.ts` and the engine agree exactly. */
export const deviceIdentityBytes = (
  deviceId: string,
  signingPublicKey: Uint8Array,
  agreementPublicKey: Uint8Array,
) => concatBytes(utf8Bytes(deviceId), signingPublicKey, agreementPublicKey);
