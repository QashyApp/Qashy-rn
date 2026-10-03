import type { ExpoConfig } from "expo/config";

/**
 * app.json stays the source of truth; this only layers on the Android ABI list
 * for EAS build profiles that set QASHY_ANDROID_ARCHS (see eas.json). Unset (local
 * dev, `expo run:android`) keeps Expo's default of all four ABIs.
 */
export default ({ config }: { config: ExpoConfig }): ExpoConfig => {
  const raw: string = process.env.QASHY_ANDROID_ARCHS ?? "";
  const archs = raw
    .split(",")
    .map((arch: string) => arch.trim())
    .filter(Boolean);

  if (archs.length === 0) return config;

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      ["expo-build-properties", { android: { buildArchs: archs } }],
    ],
  };
};
