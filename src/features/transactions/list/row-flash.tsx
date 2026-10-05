import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { useAnimationLevel } from "@/components/ui/animation-level-context";
import { motionCurves } from "@/components/ui/motion";
import { useQashyTheme } from "@/theme/theme";

const PEAK = 0.22;
const PULSE_UP_MS = 140;
const PULSE_DOWN_MS = 260;
const REDUCED_HOLD_MS = 900;

/**
 * A highlight laid over a row to say "this is the one you just saved".
 *
 * It pulses `flashes` times and then disappears. With reduced motion it does not pulse: it shows
 * one still highlight for under a second and fades out, so the cue survives without movement.
 * Pointer events are off, so the row underneath stays tappable throughout.
 */
export function RowFlash({
  flashes,
  onDone,
}: {
  flashes: number;
  onDone?: () => void;
}) {
  const theme = useQashyTheme();
  // The cue itself is kept at every level; only the pulsing goes.
  const systemReduced = useReducedMotion();
  const level = useAnimationLevel();
  const reduced = systemReduced || level === "off";
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (flashes <= 0) return;
    if (reduced) {
      opacity.value = withSequence(
        withTiming(PEAK, { duration: 0 }),
        withDelay(REDUCED_HOLD_MS, withTiming(0, { duration: 120 })),
      );
    } else {
      opacity.value = withRepeat(
        withSequence(
          withTiming(PEAK, {
            duration: PULSE_UP_MS,
            easing: motionCurves.inOut,
          }),
          withTiming(0, {
            duration: PULSE_DOWN_MS,
            easing: motionCurves.inOut,
          }),
        ),
        flashes,
        false,
      );
    }
    const total = reduced
      ? REDUCED_HOLD_MS + 120
      : flashes * (PULSE_UP_MS + PULSE_DOWN_MS);
    const timer = setTimeout(() => onDone?.(), total + 50);
    return () => {
      clearTimeout(timer);
      cancelAnimation(opacity);
    };
    // The flash is a one-shot keyed by the row's signal; re-running on a new parent render would restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
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
