/**
 * Recovery: the 24-word phrase, and the passphrase-protected backup file.
 *
 * Both of these are, bluntly, **full access to the vault**. That is not a flaw to be
 * papered over in the UI — it is the honest consequence of a design where no server can
 * ever help you recover, and the interface has to say so in those words. A user who
 * believes the phrase is "just a backup code" will store it somewhere a password would
 * be fine but a vault key is not.
 *
 * Two distinct wrappings live here, and the difference matters:
 *
 * - **Passphrase backup** (`createPassphraseBackup`): protects a file that leaves the
 *   vault's trust boundary — email, a cloud drive, a USB stick. Its key comes from
 *   scrypt over a passphrase, because the recipient of that file is assumed *not* to
 *   already hold the vault key. This is the one users will hand around.
 * - **Vault-keyed bundle** (`createVaultBundle`): protects a file moving *between devices
 *   that already share the vault key*, which is the hand-carried `.qashysync` transport.
 *   No passphrase, because demanding one would add a secret without adding a boundary —
 *   anyone who can open the file already holds the key that would decrypt the vault.
 * - **Vault-keyed backup** (`createVaultKeyBackup`): the same archive as the passphrase
 *   backup, but unlocked by the 24-word phrase instead of a passphrase. It exists because
 *   the phrase alone cannot restore a vault — it recovers the *key*, and the key without
 *   the data is a key to nothing. Pairing this file with the phrase is what turns "I wrote
 *   down 24 words" into an actual recovery path.
 *
 * The last two share a key (`deriveBackupKey`) and are kept apart by the envelope purpose —
 * `'file'` for a bundle in flight, `'backup'` for an archive at rest — so a bundle can never
 * be opened as an archive by swapping a magic number.
 */

import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

import {
  ENVELOPE_PURPOSES,
  open,
  seal,
  type EnvelopeContext,
} from "@/sync/crypto/envelope";
import { deriveBackupKey } from "@/sync/crypto/keys";
import {
  KEY_LENGTH,
  SCRYPT_DEFAULTS,
  concatBytes,
  lengthPrefixed,
  randomBytes,
  scryptKey,
  u32be,
  u8,
  type ScryptParams,
} from "@/sync/crypto/primitives";
import {
  SyncCryptoError,
  brand,
  type BackupKey,
  type VaultRootKey,
} from "@/sync/crypto/types";

export const RECOVERY_WORD_COUNT = 24;
export const MIN_PASSPHRASE_LENGTH = 12;

// ---------------------------------------------------------------------------
// Passphrase strength
// ---------------------------------------------------------------------------

/** Below this a single-class passphrase is refused whatever its length. */
const SINGLE_CLASS_MIN_LENGTH = 16;
/** Conservative floor for the estimate below. Roughly a 4-word diceware phrase, with margin. */
const MIN_ENTROPY_BITS = 50;

/**
 * Why a passphrase was refused. The UI maps each code to its own sentence, so the message can
 * say what to change instead of only that something is wrong.
 */
export type PassphraseWeakness =
  | "tooShort"
  | "singleClass"
  | "repetitive"
  | "sequential"
  | "common"
  | "lowEntropy";

export type PassphraseAssessment =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PassphraseWeakness };

/**
 * A short list of the passwords and phrases attackers try first. Matched after lowercasing and
 * undoing common leet substitutions, so `P@ssw0rd!` is `password`. It is a floor, not a
 * dictionary: a passphrase that avoids these is not thereby strong, and the entropy estimate
 * still has to pass.
 */
const COMMON_PASSPHRASES: readonly string[] = [
  "password",
  "passw0rd",
  "password1",
  "password123",
  "passwordpassword",
  "123456",
  "1234567",
  "12345678",
  "123456789",
  "1234567890",
  "111111",
  "000000",
  "qwerty",
  "qwerty123",
  "qwertyuiop",
  "qwertyui",
  "asdfgh",
  "asdfghjkl",
  "zxcvbn",
  "zxcvbnm",
  "abc123",
  "abcdef",
  "letmein",
  "letmeinnow",
  "welcome",
  "welcome1",
  "monkey",
  "dragon",
  "master",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "iloveyou",
  "iloveu",
  "trustno1",
  "shadow",
  "superman",
  "batman",
  "michael",
  "jessica",
  "charlie",
  "donald",
  "starwars",
  "freedom",
  "whatever",
  "qazwsx",
  "admin",
  "administrator",
  "login",
  "hello",
  "helloworld",
  "secret",
  "mustang",
  "access",
  "flower",
  "hunter",
  "ranger",
  "buster",
  "soccer",
  "hockey",
  "killer",
  "pepper",
  "joshua",
  "daniel",
  "andrew",
  "thomas",
  "jordan",
  "harley",
  "robert",
  "matthew",
  "computer",
  "internet",
  "samsung",
  "google",
  "changeme",
  "default",
  "lovely",
  "butterfly",
  "summer",
  "winter",
  "spring",
  "autumn",
  "orange",
  "banana",
  "cookie",
  "diamond",
  "tigger",
  "forever",
  "secure",
  "system",
  "guest",
  "root",
  "test",
  "testing",
  "thequickbrownfox",
  "opensesame",
  "iamthebest",
  "ilovepassword",
  "correcthorsebatterystaple",
  "correcthorse",
  "batterystaple",
  "mypassword",
  "mypass",
  "qwertyuiopasdfghjkl",
  "letmein123",
  "trustno",
  "dragon123",
  "monkey123",
];

const KEYBOARD_ROWS = ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"];

const LEET: Readonly<Record<string, string>> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
};

const SYMBOL_LETTERS: Readonly<Record<string, string>> = {
  "@": "a",
  $: "s",
  "!": "i",
};

/** Printable-ASCII symbol count is 33 with space; `other` is a deliberately round, generous 100. */
const CLASS_SIZES = [26, 26, 10, 33, 100] as const;

const charClass = (ch: string): number => {
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x61 && code <= 0x7a) return 0;
  if (code >= 0x41 && code <= 0x5a) return 1;
  if (code >= 0x30 && code <= 0x39) return 2;
  if (code < 0x80) return 3;
  return 4;
};

/**
 * Judges a passphrase before it protects a file. Pure, with no dependency and no network, so the
 * screen can call it on every keystroke.
 *
 * Length is measured after the same NFKC normalization the key derivation applies, in code
 * points: what the user sees as characters is what counts, and a decomposed `é` is not two.
 * The entropy figure is `effective length × log2(pool)`, where the pool is the classes actually
 * used and a character repeating its predecessor adds nothing. It is an estimate of guessing
 * cost against a generic attacker, not a measurement, and it errs low.
 */
export const assessPassphrase = (passphrase: string): PassphraseAssessment => {
  const chars = Array.from(passphrase.normalize("NFKC"));
  const fail = (reason: PassphraseWeakness): PassphraseAssessment => ({
    ok: false,
    reason,
  });
  if (chars.length < MIN_PASSPHRASE_LENGTH) return fail("tooShort");

  const classes = new Set(chars.map(charClass));
  if (classes.size === 1 && chars.length < SINGLE_CLASS_MIN_LENGTH) {
    return fail("singleClass");
  }

  let run = 1;
  let longestRun = 1;
  for (let index = 1; index < chars.length; index += 1) {
    run = chars[index] === chars[index - 1] ? run + 1 : 1;
    longestRun = Math.max(longestRun, run);
  }
  if (longestRun >= 4 || isRepeatedUnit(chars)) return fail("repetitive");

  const lowered = chars.join("").toLowerCase();
  if (hasSequence(lowered)) return fail("sequential");

  // Two views: as typed (digits kept, so `abc123` matches), and with leet substitutions undone and
  // the remaining digits dropped (so `P@ssw0rd!` matches `password`).
  const symbolsAsLetters = lowered.replace(
    /[@$!]/g,
    (ch) => SYMBOL_LETTERS[ch] ?? ch,
  );
  const squashed = symbolsAsLetters.replace(/[^a-z0-9]/g, "");
  const folded = squashed
    .replace(/[0-9]/g, (ch) => LEET[ch] ?? "")
    .replace(/[^a-z]/g, "");
  const matchesCommon = (view: string) =>
    COMMON_PASSPHRASES.some(
      (entry) => view === entry || (entry.length >= 8 && view.includes(entry)),
    );
  if (matchesCommon(squashed) || matchesCommon(folded)) return fail("common");

  let pool = 0;
  for (const cls of classes) pool += CLASS_SIZES[cls];
  let effective = 0;
  for (let index = 0; index < chars.length; index += 1) {
    if (index === 0 || chars[index] !== chars[index - 1]) effective += 1;
  }
  const bits = effective * Math.log2(pool);
  if (bits < MIN_ENTROPY_BITS) return fail("lowEntropy");

  return { ok: true };
};

const isRepeatedUnit = (chars: readonly string[]): boolean => {
  for (let period = 1; period <= chars.length / 2; period += 1) {
    if (chars.length % period !== 0) continue;
    let repeats = true;
    for (let index = period; index < chars.length && repeats; index += 1) {
      repeats = chars[index] === chars[index - period];
    }
    if (repeats) return true;
  }
  return false;
};

/**
 * Four characters climbing or falling by one (`abcd`, `4321`), or four in a row from a keyboard
 * row (`qwer`, `asdf`, reversed or not). Only same-class runs count, so `ab12` is not a sequence.
 */
const hasSequence = (lowered: string): boolean => {
  const codes = Array.from(lowered);
  for (let index = 0; index + 3 < codes.length; index += 1) {
    const window = codes.slice(index, index + 4).join("");
    for (const row of KEYBOARD_ROWS) {
      if (
        row.includes(window) ||
        row.split("").reverse().join("").includes(window)
      ) {
        return true;
      }
    }
    const step = codes[index + 1].charCodeAt(0) - codes[index].charCodeAt(0);
    if (Math.abs(step) !== 1) continue;
    let straight = true;
    for (let offset = 1; offset < 4 && straight; offset += 1) {
      const current = codes[index + offset].charCodeAt(0);
      const prior = codes[index + offset - 1].charCodeAt(0);
      straight =
        current - prior === step &&
        charClass(codes[index + offset]) === charClass(codes[index]);
    }
    if (straight && charClass(codes[index]) !== 4) return true;
  }
  return false;
};

/** English fallback for the same reasons the UI localizes. Thrown by `createPassphraseBackup`. */
export const PASSPHRASE_WEAKNESS_MESSAGES: Readonly<
  Record<PassphraseWeakness, string>
> = {
  tooShort: `Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters.`,
  singleClass: `Mix letters with digits or symbols, or make it at least ${SINGLE_CLASS_MIN_LENGTH} characters.`,
  repetitive: "Avoid repeating the same character or pattern.",
  sequential: "Avoid counting or keyboard sequences such as 1234 or qwer.",
  common: "That passphrase is too common. Choose words only you would use.",
  lowEntropy:
    "That passphrase is too easy to guess. Use more words or a wider mix.",
};

// ---------------------------------------------------------------------------
// Recovery phrase
// ---------------------------------------------------------------------------

/**
 * Encodes the vault root key as 24 BIP39 words.
 *
 * BIP39 rather than a bare hex dump for one reason that matters in practice: it carries a
 * checksum, so a phrase transcribed with one word wrong is *rejected* rather than
 * silently reconstructing a different, useless key. Someone restoring a vault years later
 * from handwriting deserves to be told they made a typo.
 */
export const vaultKeyToRecoveryPhrase = (vrk: VaultRootKey) =>
  bip39.entropyToMnemonic(vrk, wordlist);

export const recoveryPhraseToVaultKey = (phrase: string) => {
  const normalized = phrase.trim().toLowerCase().replace(/\s+/g, " ");
  if (!bip39.validateMnemonic(normalized, wordlist)) {
    throw new SyncCryptoError(
      "That recovery phrase is not valid. Check for a mistyped or out-of-order word.",
      "badMnemonic",
    );
  }
  const entropy = bip39.mnemonicToEntropy(normalized, wordlist);
  if (entropy.length !== KEY_LENGTH) {
    throw new SyncCryptoError(
      `A Qashy recovery phrase is ${RECOVERY_WORD_COUNT} words.`,
      "badMnemonic",
    );
  }
  return brand<VaultRootKey>(entropy);
};

/** Validates without revealing anything, so the confirmation step can check as the user types. */
export const isValidRecoveryPhrase = (phrase: string) =>
  bip39.validateMnemonic(
    phrase.trim().toLowerCase().replace(/\s+/g, " "),
    wordlist,
  );

// ---------------------------------------------------------------------------
// Backup files
// ---------------------------------------------------------------------------

const BACKUP_MAGIC = new Uint8Array([0x51, 0x53, 0x59, 0x42]); // 'QSYB'
const VAULT_BACKUP_MAGIC = new Uint8Array([0x51, 0x53, 0x59, 0x56]); // 'QSYV'
const BACKUP_FORMAT = 1;
const SALT_LENGTH = 32;

/**
 * Which secret opens this file, read from its first bytes alone.
 *
 * The caller needs this *before* it can prompt: asking for a passphrase and then discovering
 * the file wanted a recovery phrase is a dead end the user cannot reason about. `null` for
 * anything that is not a Qashy backup at all.
 *
 * This is a routing hint, not a security check — the magic is unauthenticated, and a file
 * whose magic says one thing and whose ciphertext says another simply fails to open.
 */
export const readBackupKind = (
  file: Uint8Array,
): "passphrase" | "vaultKey" | null => {
  const matches = (magic: Uint8Array) =>
    magic.every((byte, index) => file[index] === byte);
  if (file.length < 5) return null;
  if (matches(BACKUP_MAGIC)) return "passphrase";
  if (matches(VAULT_BACKUP_MAGIC)) return "vaultKey";
  return null;
};

const backupContext = (): EnvelopeContext => ({
  purpose: "backup",
  senderDeviceId: "",
  recipientDeviceId: "",
  epoch: 0,
  seq: 0,
});

const bundleContext = (
  senderDeviceId: string,
  epoch: number,
  seq: number,
): EnvelopeContext => ({
  purpose: "file",
  senderDeviceId,
  recipientDeviceId: "",
  epoch,
  seq,
});

/**
 * Seals `payload` under a key stretched from `passphrase`.
 *
 * The scrypt parameters are written into the header rather than assumed by the reader, so
 * raising them later does not orphan every backup a user already made. A file that
 * declares parameters this build considers too weak is still rejected — the header is a
 * record of what was used, not a licence to use anything.
 */
export const createPassphraseBackup = (
  passphrase: string,
  payload: Uint8Array,
  params: ScryptParams = SCRYPT_DEFAULTS,
) => {
  const assessment = assessPassphrase(passphrase);
  if (!assessment.ok) {
    throw new SyncCryptoError(
      PASSPHRASE_WEAKNESS_MESSAGES[assessment.reason],
      "badPassphrase",
    );
  }
  const salt = randomBytes(SALT_LENGTH);
  const key = brand<BackupKey>(scryptKey(passphrase, salt, params));
  return concatBytes(
    BACKUP_MAGIC,
    u8(BACKUP_FORMAT),
    u32be(params.N),
    u32be(params.r),
    u32be(params.p),
    lengthPrefixed(salt),
    seal(key, backupContext(), payload),
  );
};

export const openPassphraseBackup = (passphrase: string, file: Uint8Array) => {
  const header = 4 + 1 + 4 + 4 + 4 + 4;
  if (file.length < header + SALT_LENGTH) {
    throw new SyncCryptoError("That file is not a Qashy backup.", "badFormat");
  }
  if (BACKUP_MAGIC.some((byte, index) => file[index] !== byte)) {
    throw new SyncCryptoError("That file is not a Qashy backup.", "badFormat");
  }
  if (file[4] !== BACKUP_FORMAT) {
    throw new SyncCryptoError(
      "That backup was written by a newer version of Qashy.",
      "badVersion",
    );
  }
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const params: ScryptParams = {
    N: view.getUint32(5, false),
    r: view.getUint32(9, false),
    p: view.getUint32(13, false),
  };
  const saltLength = view.getUint32(17, false);
  if (saltLength !== SALT_LENGTH || file.length < header + saltLength) {
    throw new SyncCryptoError("That backup file is damaged.", "badFormat");
  }
  // `scryptKey` validates aggregate memory and CPU cost before the KDF allocates anything.
  // Checking individual fields is insufficient: a modest N multiplied by hostile r or p is
  // still an attacker-chosen denial of service.
  const salt = file.slice(header, header + saltLength);
  const key = brand<BackupKey>(scryptKey(passphrase, salt, params));
  try {
    return open(key, backupContext(), file.slice(header + saltLength));
  } catch (reason) {
    // The AEAD cannot distinguish a wrong passphrase from a damaged file, but the user
    // almost always mistyped, so lead with that and mention the other.
    if (reason instanceof SyncCryptoError && reason.code === "badTag") {
      throw new SyncCryptoError(
        "Wrong passphrase, or the backup file is damaged.",
        "badPassphrase",
      );
    }
    throw reason;
  }
};

/**
 * Seals a payload under a key derived from the vault root key. Used by the hand-carried
 * file transport, where both devices are already vault members.
 */
export const createVaultBundle = (
  vrk: VaultRootKey,
  senderDeviceId: string,
  epoch: number,
  seq: number,
  payload: Uint8Array,
) =>
  seal(
    deriveBackupKey(vrk),
    bundleContext(senderDeviceId, epoch, seq),
    payload,
  );

export const openVaultBundle = (
  vrk: VaultRootKey,
  senderDeviceId: string,
  epoch: number,
  seq: number,
  file: Uint8Array,
) =>
  open(deriveBackupKey(vrk), bundleContext(senderDeviceId, epoch, seq), file);

/**
 * Seals a backup archive under the vault root key, so the 24-word phrase opens it.
 *
 * No scrypt header, and that is not an oversight: the key is already 32 uniform random
 * bytes, and stretching a uniformly random key accomplishes nothing but making the restore
 * slow. Stretching exists to make a *low-entropy* secret expensive to guess.
 */
export const createVaultKeyBackup = (vrk: VaultRootKey, payload: Uint8Array) =>
  concatBytes(
    VAULT_BACKUP_MAGIC,
    u8(BACKUP_FORMAT),
    seal(deriveBackupKey(vrk), backupContext(), payload),
  );

export const openVaultKeyBackup = (vrk: VaultRootKey, file: Uint8Array) => {
  const header = VAULT_BACKUP_MAGIC.length + 1;
  if (
    file.length < header ||
    VAULT_BACKUP_MAGIC.some((byte, index) => file[index] !== byte)
  ) {
    throw new SyncCryptoError("That file is not a Qashy backup.", "badFormat");
  }
  if (file[4] !== BACKUP_FORMAT) {
    throw new SyncCryptoError(
      "That backup was written by a newer version of Qashy.",
      "badVersion",
    );
  }
  try {
    return open(deriveBackupKey(vrk), backupContext(), file.slice(header));
  } catch (reason) {
    // Same reasoning as the passphrase path, different remedy: the phrase is far more
    // likely to be the wrong *vault's* phrase than mistyped, since a typo fails the BIP39
    // checksum long before it reaches here.
    if (reason instanceof SyncCryptoError && reason.code === "badTag") {
      throw new SyncCryptoError(
        "That recovery phrase does not match this backup, or the file is damaged.",
        "badPassphrase",
      );
    }
    throw reason;
  }
};

/** Exported so the file transport can label bundles without importing the envelope module. */
export const VAULT_BUNDLE_PURPOSE = ENVELOPE_PURPOSES.file;
