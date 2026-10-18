/**
 * Writes src/localization/android-strings.json, the catalog the Android build
 * turns into values/strings.xml so Google Play can translate the app's strings, and
 * src/localization/android-runtime.json, the slim list of resource names and pattern
 * sources the app imports at runtime to read Play-translated strings.
 *
 *   node scripts/generate-android-strings.ts      (npm run strings:android)
 *
 * Node (22.18 or newer) strips the types natively, so imports carry explicit .ts extensions.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildAndroidCatalog } from "../src/localization/android-catalog.ts";

const output = fileURLToPath(
  new URL("../src/localization/android-strings.json", import.meta.url),
);

const runtimeOutput = fileURLToPath(
  new URL("../src/localization/android-runtime.json", import.meta.url),
);

const { catalog, runtime, skipped } = buildAndroidCatalog();
writeFileSync(output, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
writeFileSync(runtimeOutput, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");

console.log(
  `Wrote ${catalog.strings.length} strings and ${catalog.patterns.length} patterns ` +
    `(${skipped.length} patterns skipped) to ${output}`,
);
for (const { source, reason } of skipped) {
  console.log(`  skipped ${reason}: ${source}`);
}
