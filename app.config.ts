import { execSync } from "node:child_process";
import type { ExpoConfig } from "expo/config";

/**
 * Version is `<major>.<minor>.<commits since that tag>`, derived from the nearest
 * baseline tag `[v]MAJOR.MINOR.0[-suffix]` (e.g. tag `2.0.0` + 12 commits = `2.0.12`).
 * Tags with a non-zero last number (`2.0.12`) are GitHub release tags, not baselines,
 * and are ignored here. Build numbers are not set here: EAS owns them
 * (`appVersionSource: remote`). Needs full history and tags (`fetch-depth: 0` in CI);
 * without them it falls back to 0.0.0.
 */
function gitVersion(): string {
  try {
    const described = execSync(
      'git describe --tags --long --match "[v0-9]*.[0-9]*.0" --match "[v0-9]*.[0-9]*.0-*"',
      {
        stdio: ["ignore", "pipe", "ignore"],
      },
    )
      .toString()
      .trim();
    const match = /^v?(\d+\.\d+).*-(\d+)-g[0-9a-f]+$/.exec(described);
    if (match) return `${match[1]}.${match[2]}`;
  } catch {
    // No git, no tags, or a shallow clone.
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

  return {
    ...versioned,
    plugins: [
      ...(versioned.plugins ?? []),
      ["expo-build-properties", { android: { buildArchs: archs } }],
    ],
  };
};
