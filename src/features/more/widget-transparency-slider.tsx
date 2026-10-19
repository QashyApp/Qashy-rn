import { SegmentedControl } from "@/components/ui/segmented-control";

import {
  TRANSPARENCY_PRESETS,
  type WidgetTransparencySliderProps,
} from "@/features/more/widget-transparency";

const OPTIONS = TRANSPARENCY_PRESETS.map((value) => ({
  value: String(value),
  label: `${value}%`,
  literal: true,
}));

/**
 * The fallback where the Compose slider does not exist (web): five fixed steps. Widgets are an
 * Android feature, so this is only reachable from a test or a future platform.
 */
export function WidgetTransparencySlider({
  label,
  value,
  onCommit,
}: WidgetTransparencySliderProps) {
  const nearest = TRANSPARENCY_PRESETS.reduce((best, step) =>
    Math.abs(step - value) < Math.abs(best - value) ? step : best,
  );
  return (
    <SegmentedControl
      label={label}
      options={OPTIONS}
      value={String(nearest)}
      onChange={(next) => onCommit(Number(next))}
    />
  );
}
