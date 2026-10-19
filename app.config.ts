import type { ExpoConfig } from "expo/config";

import languages from "./src/localization/languages.json";

/**
 * Language subtags (`en`, `he`) of every bundled and Play-translated language, deduplicated.
 * Fed to expo-localization so Android generates `locales_config.xml` and lists exactly these
 * languages in the system per-app language picker.
 */
const androidLocales: string[] = [
  ...new Set(
    [...languages.bundled, ...languages.playTranslated].map(
      ({ tag }: { tag: string }) => new Intl.Locale(tag).language,
    ),
  ),
];

/**
 * app.json holds the static config, including `version`; this layers on the
 * expo-localization plugin (its language list lives in src/localization/languages.json)
 * and the with-android-strings plugin (src/localization/android-strings.json becomes
 * res/values and res/values-iw strings.xml), plus the Android ABI list for EAS build
 * profiles that set QASHY_ANDROID_ARCHS (see eas.json). Unset (local dev,
 * `expo run:android`) keeps Expo's default of all four ABIs. Build numbers are owned by EAS (`appVersionSource: remote`).
 */
export default ({ config }: { config: ExpoConfig }): ExpoConfig =>
  withAndroidArchs({
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      ["expo-localization", { supportedLocales: { android: androidLocales } }],
      // Ships the UI strings as Android string resources (values/ and values-iw/) so Google
      // Play can translate them and the app can read the translations back at runtime.
      "./plugins/with-android-strings",
    ],
  });

function withAndroidArchs(config: ExpoConfig): ExpoConfig {
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
}
