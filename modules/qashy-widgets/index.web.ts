// Web has no home-screen widgets; same surface as index.ts, no native code.
export interface PlacedWidget {
  id: number;
  kind: string;
}

export function isAvailable(): boolean {
  return false;
}

export async function getPlacedWidgets(): Promise<PlacedWidget[]> {
  return [];
}

export async function update(_json: string): Promise<void> {}

export async function clear(): Promise<void> {}

export function reportHeadlessResult(_ok: boolean): void {}

export type PreviewRegistration =
  "unsupported" | "unchanged" | "registered" | "rateLimited" | "failed";

export async function registerPreviews(): Promise<PreviewRegistration> {
  return "unsupported";
}
