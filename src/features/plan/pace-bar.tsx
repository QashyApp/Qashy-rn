import { View } from "react-native";

import { ProgressBar } from "@/components/ui/progress-bar";
import { useQashyTheme } from "@/theme/theme";

/**
 * A `ProgressBar` with a thin vertical tick overlaid at `elapsedRatio`, so a
 * budget's spend reads against the clock, not just against the limit. Built
 * as a wrapper rather than a `ProgressBar` change: the tick is specific to a
 * time-boxed budget period, not a concern of the shared progress primitive.
 */
export function PaceBar({
  label,
  value,
  elapsedRatio,
  color,
}: {
  label: string;
  value: number;
  elapsedRatio: number;
  color?: string;
}) {
  const theme = useQashyTheme();
  const clampedElapsed = Math.max(
    0,
    Math.min(1, Number.isFinite(elapsedRatio) ? elapsedRatio : 0),
  );
  // Never draw the tick flush at either edge: at 0% or 100% it would sit on
  // top of the track's own rounded end and read as a rendering glitch rather
  // than a marker.
  const showTick = clampedElapsed > 0.01 && clampedElapsed < 0.99;
  return (
    <View style={{ justifyContent: "center" }}>
      <ProgressBar label={label} value={value} color={color} />
      {showTick ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: -3,
            bottom: -3,
            start: `${clampedElapsed * 100}%`,
            width: 2,
            marginStart: -1,
            borderRadius: 1,
            backgroundColor: theme.text,
            opacity: 0.4,
          }}
        />
      ) : null}
    </View>
  );
}
