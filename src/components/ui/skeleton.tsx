import { useEffect, useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { View } from "react-native";
import Animated, {
  ReduceMotion,
  cancelAnimation,
  makeMutable,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { motionCurves, useMotionPreference } from "@/components/ui/motion";
import { useQashyTheme } from "@/theme/theme";

const PULSE_DURATION = 900;
const PULSE_MIN = 0.55;
const PULSE_MAX = 1;
const REDUCED_MOTION_OPACITY = 0.7;

// One pulse for every block on screen. Blocks used to start a repeat each, so a screen with a dozen
// of them ran a dozen infinite animations that also drifted out of phase; they now read one shared
// value, run while at least one block is mounted, and breathe together.
let pulse: SharedValue<number> | undefined;
let pulseUsers = 0;

function usePulse(active: boolean) {
  const [value] = useState(() => (pulse ??= makeMutable(PULSE_MIN)));
  useEffect(() => {
    if (!active) return;
    if (pulseUsers++ === 0) {
      value.set(
        withRepeat(
          withTiming(PULSE_MAX, {
            duration: PULSE_DURATION,
            easing: motionCurves.inOut,
            reduceMotion: ReduceMotion.System,
          }),
          -1,
          true,
        ),
      );
    }
    return () => {
      if (--pulseUsers === 0) {
        cancelAnimation(value);
        value.set(PULSE_MIN);
      }
    };
  }, [active, value]);
  return value;
}

/**
 * A loading placeholder: a sunken-colored block with a gentle opacity pulse.
 * Under reduced motion the pulse is skipped entirely rather than slowed down —
 * a static block at a fixed opacity communicates "loading" just as well
 * without the motion a reduced-motion user asked not to see.
 */
export function Skeleton({
  width,
  height,
  radius: cornerRadius,
  style,
}: {
  width: number | `${number}%`;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useQashyTheme();
  const { radius } = theme;
  // The pulse is opacity only, so it survives `minimal`; it is skipped only when `instant`.
  const { instant: reduceMotion } = useMotionPreference();
  const pulseValue = usePulse(!reduceMotion);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? REDUCED_MOTION_OPACITY : pulseValue.get(),
  }));

  return (
    <Animated.View
      // Purely decorative: the real content it stands in for announces
      // itself once loaded, and a screen reader has nothing useful to say
      // about a pulsing rectangle in the meantime.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={[
        {
          width,
          height,
          borderRadius: cornerRadius ?? radius.control,
          borderCurve: "continuous",
          backgroundColor: theme.surfaceSunken,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

/** A stack of `Skeleton` lines, narrowing the last one so the block reads as text rather than a bar chart. */
export function SkeletonText({
  lines = 3,
  lineHeight = 14,
  gap,
}: {
  lines?: number;
  lineHeight?: number;
  gap?: number;
}) {
  const { radius, space } = useQashyTheme();
  return (
    <View style={{ gap: gap ?? space.sm }}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          // A static placeholder list never reorders, so an index key is safe here.
          key={index}
          width={index === lines - 1 && lines > 1 ? "60%" : "100%"}
          height={lineHeight}
          radius={radius.sm}
        />
      ))}
    </View>
  );
}
