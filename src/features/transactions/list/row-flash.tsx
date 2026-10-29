import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { motionCurves, useMotionPreference } from "@/components/ui/motion";
import { useQashyTheme } from "@/theme/theme";

const PEAK = 0.22;
/** With no motion the highlight holds still for this many of the theme's slow durations. */
const STILL_HOLD_SLOWS = 3;
/** Slack after the last frame before the row is told the flash is over. */
const DONE_MARGIN_MS = 50;

/**
 * A highlight laid over a row to say "this is the one you just saved". It is the last child of the
 * row's clipped slab, because the sliding row content paints an opaque fill that would hide
 * anything beneath it.
 *
 * Full motion pulses `flashes` times and then disappears. Minimal motion is a single quick fade in
 * and out instead of pulses. With no motion at all it shows one still highlight and removes it
 * after a hold, so the cue survives without movement. Durations come from the theme. Pointer events
 * are off, so the row underneath stays tappable throughout.
 */
export function RowFlash({
  flashes,
  onDone,
}: {
  flashes: number;
  onDone?: () => void;
}) {
  const theme = useQashyTheme();
  const { duration } = theme.motion;
  const { instant, travel } = useMotionPreference();
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (flashes <= 0) return;
    let total: number;
    let hide: ReturnType<typeof setTimeout> | undefined;
    if (instant) {
      // Nothing animates: the highlight appears at once and is taken away at once.
      total = duration.slow * STILL_HOLD_SLOWS;
      opacity.value = PEAK;
      hide = setTimeout(() => {
        opacity.value = 0;
      }, total);
    } else {
      // Minimal motion fades a single time; pulsing is a full-motion cue.
      const pulses = travel ? flashes : 1;
      const up = travel ? duration.base : duration.fast;
      const down = travel ? duration.slow : duration.base;
      total = pulses * (up + down);
      opacity.value = withRepeat(
        withSequence(
          withTiming(PEAK, { duration: up, easing: motionCurves.inOut }),
          withTiming(0, { duration: down, easing: motionCurves.inOut }),
        ),
        pulses,
        false,
      );
    }
    const timer = setTimeout(() => onDone?.(), total + DONE_MARGIN_MS);
    return () => {
      clearTimeout(timer);
      clearTimeout(hide);
      cancelAnimation(opacity);
    };
    // The flash is a one-shot keyed by the row's signal; re-running on a new parent render would restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      testID="row-flash"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: theme.accent },
        style,
      ]}
    />
  );
}
