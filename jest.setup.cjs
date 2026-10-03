const nodeCrypto = require("node:crypto");

// Needed once `@testing-library/react-native` started rendering a component that uses
// `Gesture.Pan()` (the Overview edit-mode drag handle): the package's own recommended Jest
// setup, mocking the native gesture-handler module out entirely.
require("react-native-gesture-handler/jestSetup");

// Reanimated's official mock: swaps every worklet-driven API for a synchronous JS
// equivalent so a component using `useSharedValue`/`useAnimatedStyle`/`Gesture.Pan()` can
// render under Jest without the Babel worklet plugin or a real UI thread.
jest.mock("react-native-reanimated", () => {
  const Reanimated = require("react-native-reanimated/mock");
  Reanimated.default.call = () => {};
  // The bundled mock predates a couple of hooks this app calls directly: under Jest there is
  // no OS-level "reduce motion" setting to read, so every animation just runs (or, for a
  // component that branches on it, behaves as if reduce-motion were off).
  Reanimated.useReducedMotion = Reanimated.useReducedMotion ?? (() => false);
  return Reanimated;
});

let uuid = 0;

jest.mock("expo-localization", () => ({
  getLocales: jest.fn(() => [{ languageTag: "en-US", currencyCode: "USD" }]),
}));

// `expo-crypto` is replaced wholesale, not partially, because the real module is a
// native module that cannot load under Jest. That means every export the app ever
// calls has to be mirrored here: an unmirrored one is `undefined`, and the failure
// surfaces as "undefined is not a function" inside whichever suite happens to import
// it transitively, a long way from the cause.
//
// `randomUUID` stays counter-based so entity ids remain stable and readable across a
// run. Everything else delegates to Node's crypto, so the sync suites exercise real
// randomness and real digests rather than a stub they could accidentally pass against.
jest.mock("expo-crypto", () => {
  const toNodeAlgorithm = (algorithm) =>
    String(algorithm).replace(/-/g, "").toLowerCase();
  return {
    CryptoDigestAlgorithm: {
      SHA1: "SHA-1",
      SHA256: "SHA-256",
      SHA384: "SHA-384",
      SHA512: "SHA-512",
    },
    CryptoEncoding: { HEX: "hex", BASE64: "base64" },
    randomUUID: () =>
      `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
    getRandomBytes: (length) => new Uint8Array(nodeCrypto.randomBytes(length)),
    getRandomBytesAsync: async (length) =>
      new Uint8Array(nodeCrypto.randomBytes(length)),
    getRandomValues: (array) => nodeCrypto.webcrypto.getRandomValues(array),
    digest: async (algorithm, data) => {
      const digest = nodeCrypto
        .createHash(toNodeAlgorithm(algorithm))
        .update(Buffer.from(data))
        .digest();
      return new Uint8Array(digest).buffer;
    },
    digestStringAsync: async (algorithm, data, options) => {
      const hash = nodeCrypto
        .createHash(toNodeAlgorithm(algorithm))
        .update(data, "utf8");
      return options?.encoding === "base64"
        ? hash.digest("base64")
        : hash.digest("hex");
    },
  };
});

// `@noble/*` reaches for `globalThis.crypto.getRandomValues`, and the web keystore
// wraps key material with a non-extractable `CryptoKey` from `crypto.subtle`. Neither
// is guaranteed present in every environment this preset runs suites under, so pin
// Node's WebCrypto when it is missing rather than letting a suite fail obscurely.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: nodeCrypto.webcrypto,
    configurable: true,
    writable: true,
  });
}
