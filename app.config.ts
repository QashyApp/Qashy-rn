import type { ExpoConfig } from "expo/config";

/**
 * app.json holds the static config, including `version`; this only layers on the
 * Android ABI list for EAS build profiles that set QASHY_ANDROID_ARCHS (see
 * eas.json). Unset (local dev, `expo run:android`) keeps Expo's default of all four
 * ABIs. Build numbers are owned by EAS (`appVersionSource: remote`).
 */
export default ({ config }: { config: ExpoConfig }): ExpoConfig => {
  const raw: string = process.env.QASHY_ANDROID_ARCHS ?? "";
  const archs = raw
    .split(",")
    .map((arch: string) => arch.trim())
    .filter(Boolean);

  if (archs.length === 0) return config;

  // Merge buildArchs into the expo-build-properties entry from app.json (which also
  // enables R8 minification) instead of appending a second, competing entry.
  const plugins = config.plugins ?? [];
  const isBuildProperties = (plugin: (typeof plugins)[number]): boolean =>
    Array.isArray(plugin) && plugin[0] === "expo-build-properties";

  if (!plugins.some(isBuildProperties)) {
    return {
      ...config,
      plugins: [
        ...plugins,
        ["expo-build-properties", { android: { buildArchs: archs } }],
      ],
    };
  }

  return {
    ...config,
    plugins: plugins.map((plugin) => {
      if (!isBuildProperties(plugin) || !Array.isArray(plugin)) return plugin;
      const options = (plugin[1] ?? {}) as {
        android?: Record<string, unknown>;
      };
      return [
        "expo-build-properties",
        { ...options, android: { ...options.android, buildArchs: archs } },
      ];
    }),
  };
};
