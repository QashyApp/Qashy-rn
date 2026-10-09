import { execSync } from "node:child_process";
import type { ExpoConfig } from "expo/config";

/**
 * Version is `<major>.<minor>.<commits since that tag>`, derived from the nearest
 * baseline tag `[v]MAJOR.MINOR.0[-suffix]` (e.g. tag `2.0.0` + 12 commits = `2.0.12`).
 * Tags with a non-zero last number (`2.0.12`) are GitHub release tags, not baselines,
 * and are ignored here. Build numbers are not set here: EAS owns them
 * (`appVersionSource: remote`).
 *
 * `QASHY_VERSION=<major.minor.patch>` overrides everything and skips git; CI computes the
 * version where full history exists and passes it to builds that only get a shallow copy
 * (EAS workers, `eas build --local`). A malformed value throws.
 *
 * Deriving from git needs full history and tags (`fetch-depth: 0` in CI). If that fails,
 * an EAS build (`EAS_BUILD` set) throws rather than ship 0.0.0 silently; everything
 * else (local dev, shallow CI test jobs) falls back to 0.0.0.
 */
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function isTruthyEnv(value: string | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized !== "" && normalized !== "false" && normalized !== "0";
}

function gitVersion(): string {
  const override = (process.env.QASHY_VERSION ?? "").trim();
  if (override !== "") {
    if (!VERSION_PATTERN.test(override)) {
      throw new Error(
        `Invalid QASHY_VERSION "${override}": expected <major>.<minor>.<patch> (e.g. 2.0.3).`,
      );
    }
    return override;
  }

  let described = "";
  try {
    described = execSync(
      'git describe --tags --long --match "[v0-9]*.[0-9]*.0" --match "[v0-9]*.[0-9]*.0-*"',
      {
        stdio: ["ignore", "pipe", "ignore"],
      },
    )
      .toString()
      .trim();
  } catch {
    // No git, no tags, or a shallow clone: handled below.
  }

  const match = /^v?(\d+\.\d+).*-(\d+)-g[0-9a-f]+$/.exec(described);
  if (match) return `${match[1]}.${match[2]}`;

  if (isTruthyEnv(process.env.EAS_BUILD)) {
    throw new Error(
      "Cannot derive app version from git (needs full history and tags). " +
        "Set QASHY_VERSION=<major.minor.patch> or fetch tags.",
    );
  }
  return "0.0.0";
}

/**
 * app.json holds the static config; this layers on the git-derived version and the
 * Android ABI list for EAS build profiles that set QASHY_ANDROID_ARCHS (see
 * eas.json). Unset (local dev, `expo run:android`) keeps Expo's default of all four
 * ABIs.
 */
export default ({ config }: { config: ExpoConfig }): ExpoConfig => {
  const raw: string = process.env.QASHY_ANDROID_ARCHS ?? "";
  const archs = raw
    .split(",")
    .map((arch: string) => arch.trim())
    .filter(Boolean);

  const versioned: ExpoConfig = { ...config, version: gitVersion() };

  if (archs.length === 0) return versioned;

  // Merge buildArchs into the expo-build-properties entry from app.json (which also
  // enables R8 minification) instead of appending a second, competing entry.
  const plugins = versioned.plugins ?? [];
  const isBuildProperties = (plugin: (typeof plugins)[number]): boolean =>
    Array.isArray(plugin) && plugin[0] === "expo-build-properties";

  if (!plugins.some(isBuildProperties)) {
    return {
      ...versioned,
      plugins: [...plugins, ["expo-build-properties", { android: { buildArchs: archs } }]],
    };
  }

  return {
    ...versioned,
    plugins: plugins.map((plugin) => {
      if (!isBuildProperties(plugin) || !Array.isArray(plugin)) return plugin;
      const options = (plugin[1] ?? {}) as { android?: Record<string, unknown> };
      return [
        "expo-build-properties",
        { ...options, android: { ...options.android, buildArchs: archs } },
      ];
    }),
  };
};
