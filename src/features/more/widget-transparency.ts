/** Transparency is shown as 0–100% in steps of 5; the stored setting is the opacity (100 − this). */
export const TRANSPARENCY_STEP = 5;
export const TRANSPARENCY_PRESETS = [0, 25, 50, 75, 100] as const;

export interface WidgetTransparencySliderProps {
  /** Accessible name of the control. */
  label: string;
  /** Percent transparent, 0–100. */
  value: number;
  /**
   * Called once with the final value, when the user finishes choosing. Resolves true when the
   * value was saved and false when the write failed, so the control can fall back to the stored one.
   */
  onCommit: (value: number) => Promise<boolean>;
}

/** Rounds to the nearest step of 5 and clamps to 0–100. */
export function snapTransparency(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const snapped = Math.round(raw / TRANSPARENCY_STEP) * TRANSPARENCY_STEP;
  return Math.min(100, Math.max(0, snapped));
}

/** The stored opacity for a transparency percent, and back. */
export const opacityFromTransparency = (transparency: number) =>
  100 - snapTransparency(transparency);
export const transparencyFromOpacity = (opacity: number) =>
  snapTransparency(100 - opacity);
