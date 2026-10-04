const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

// Cryptography is quarantined in `src/sync/crypto/`. Everything else consumes it
// through that directory's documented API, so there is exactly one place to review
// when asking "can this construction be attacked?" — and a stray
// `import { gcm } from '@noble/ciphers/aes'` somewhere in a screen cannot quietly
// introduce a second, unreviewed cryptosystem.
const CRYPTO_PACKAGES = ["@noble/*", "@scure/*"];

// Shape and rhythm belong to the active theme, so a component reads them from `useQashyTheme()`
// (`const { space, radius } = useQashyTheme()`) rather than importing the classic constants,
// which would silently ignore every other theme. Only `src/theme/**` defines them.
const THEME_SCALES = ["space", "radius", "tile", "iconSize", "motion"];

const RESTRICTED_PATHS = [
  {
    // zod was removed: it is a large share of the web bundle for three flat validators, which
    // are hand-written beside their callers now. Keep it out unless the trade is revisited.
    name: "zod",
    message:
      "zod was removed for bundle size; validate with a small hand-written parser instead.",
  },
];

const RESTRICTED_PATTERNS = [
  {
    group: CRYPTO_PACKAGES,
    message:
      "Cryptographic primitives may only be imported inside src/sync/crypto/. Use the API that directory exports.",
  },
  {
    group: ["zod/**"],
    message:
      "zod was removed for bundle size; validate with a small hand-written parser instead.",
  },
];

module.exports = defineConfig([
  ...expoConfig,
  {
    // `server/` is the relay worker: a separate deployment target with Cloudflare Workers
    // globals, its own tsconfig, and its own `npm run typecheck`. Linting it with the Expo
    // config would only produce noise about an environment it does not run in.
    ignores: ["dist/**", "coverage/**", "node_modules/**", "server/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    // `src/sync/crypto/**` is the quarantine itself: the one place cryptographic packages are
    // imported.
    ignores: ["src/sync/crypto/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...RESTRICTED_PATHS,
            {
              name: "@/theme/tokens",
              importNames: THEME_SCALES,
              message:
                "Read space, radius, tile, iconSize and motion from useQashyTheme() so the active theme applies.",
            },
          ],
          patterns: RESTRICTED_PATTERNS,
        },
      ],
    },
  },
  {
    files: ["src/theme/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: RESTRICTED_PATHS, patterns: RESTRICTED_PATTERNS },
      ],
    },
  },
  {
    // The sync layer must not log. Op payloads, device ids, and handshake material all
    // pass through it, and a stray `console.log` while debugging is how key material
    // ends up in a crash report.
    files: ["src/sync/**/*.{ts,tsx}"],
    ignores: ["src/sync/**/__tests__/**"],
    rules: {
      "no-console": "error",
    },
  },
]);
