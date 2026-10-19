import { Platform } from "react-native";

import NativeModule from "./src/QashyWidgetsModule";

export type WidgetKind = "transactions" | "summary";

export interface PlacedWidget {
  /** The Android appWidgetId; the key into the snapshot's `widgets` map. */
  id: number;
  kind: WidgetKind;
}

/** True on Android builds that include the native module. */
export function isAvailable(): boolean {
  return Platform.OS === "android" && NativeModule != null;
}

/** Home-screen widgets currently placed (both kinds); [] on web or without the native module. */
export async function getPlacedWidgets(): Promise<PlacedWidget[]> {
  if (Platform.OS !== "android" || !NativeModule) return [];
  const placed = await NativeModule.getPlacedWidgets();
  return (placed ?? []).filter(
    (w): w is PlacedWidget => w.kind === "transactions" || w.kind === "summary",
  );
}

/**
 * Stores the snapshot JSON device-locally (not backed up) and re-renders every widget, then
 * schedules the midnight refresh. Rejects when the JSON does not parse as a version-1 snapshot.
 * A no-op on web or without the native module.
 */
export async function update(json: string): Promise<void> {
  if (Platform.OS !== "android" || !NativeModule) return;
  await NativeModule.update(json);
}

/**
 * Deletes the stored snapshot, puts widgets into their "open the app" state and cancels
 * scheduled refreshes. A no-op on web or without the native module.
 */
export async function clear(): Promise<void> {
  if (Platform.OS !== "android" || !NativeModule) return;
  await NativeModule.clear();
}
