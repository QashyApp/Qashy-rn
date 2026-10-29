import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import {
  motionCurves,
  useMotionDurations,
  useMotionPreference,
} from "@/components/ui/motion";

const FADE_FROM = 0.3;

/**
 * Content that changes with the month but is not worth sliding: when `month` changes it dims
 * and fades back up instead of replacing itself with a hard cut. The dim lands in the same
 * commit as the new content, so the old content is never seen dimmed.
 */
export function MonthContentFade({
  month,
  style,
  children,
}: {
  month: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  // An opacity fade survives the minimal level; only `instant` skips it.
  const { instant } = useMotionPreference();
  const { enter } = useMotionDurations();
  const enabled = !instant;
  const opacity = useSharedValue(1);
  const shownMonth = useRef(month);
  useLayoutEffect(() => {
    if (shownMonth.current === month) return;
    shownMonth.current = month;
    if (!enabled) return;
    opacity.set(FADE_FROM);
    opacity.set(
      withTiming(1, { duration: enter, easing: motionCurves.standard }),
    );
  }, [month, enabled, enter, opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}
