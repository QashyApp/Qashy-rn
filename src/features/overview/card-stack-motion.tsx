/**
 * Motion for the Overview card stack that belongs to neither a card nor the edit frame:
 * following a month swipe, and the visible hold before a long press opens edit mode.
 */

import type { ReactNode } from "react";
import { Pressable, useWindowDimensions } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { restingPosition } from "@/components/ui/month-pager";
import { motionCurves, useMotionPreference } from "@/components/ui/motion";
import {
  monthSwipeFollow,
  type SwipeFollowMode,
} from "@/features/overview/month-swipe-follow";
import { useLocalization } from "@/localization/localization";
import { hapticImpactLight } from "@/services/haptics";
import { useQashyTheme } from "@/theme/theme";

/**
 * Moves the card stack with a month swipe. The pager does not slide this screen's page, it only
 * writes `dragProgress`; the stack leans toward the finger and dims on the UI thread as that
 * value changes. Reduced motion and the Off level keep it still, Minimal only dims.
 */
export function MonthSwipeFollow({
  month,
  dragProgress,
  children,
}: {
  month: string;
  dragProgress?: SharedValue<number>;
  children: ReactNode;
}) {
  const { isRtl } = useLocalization();
  const { width } = useWindowDimensions();
  const { instant, travel } = useMotionPreference();
  const idle = useSharedValue(0);
  const progress = dragProgress ?? idle;
  // `dragProgress` is absolute; subtracting where it rests on this month leaves the swipe alone.
  const rest = dragProgress ? restingPosition(month, isRtl) : 0;
  const mode: SwipeFollowMode = instant ? "none" : travel ? "travel" : "fade";

  const style = useAnimatedStyle(() => {
    const follow = monthSwipeFollow(progress.get() - rest, width, mode);
    return {
      opacity: follow.opacity,
      transform: [{ translateX: follow.translateX }],
    };
  });

  return <Animated.View style={style}>{children}</Animated.View>;
}

/** How long a card is held before it opens edit mode. */
const HOLD_MS = 450;
const HOLD_SCALE = 0.98;
const HOLD_DIP = 0.88;

/**
 * A card that opens edit mode when held. While the finger is down the card slowly settles in
 * (a small scale, or a dip in opacity at the Minimal level) so the hold reads as something
 * happening; it lets go the moment the finger lifts or starts scrolling, and gives a tap when
 * the hold completes. Native only: the web has no press-and-hold.
 */
export function HoldToCustomize({
  onActivate,
  children,
}: {
  onActivate: () => void;
  children: ReactNode;
}) {
  const { motion } = useQashyTheme();
  const { instant, travel } = useMotionPreference();
  const hold = useSharedValue(0);

  const release = () => {
    hold.set(withTiming(0, { duration: instant ? 0 : motion.duration.fast }));
  };

  const style = useAnimatedStyle(() => ({
    opacity: travel ? 1 : 1 - (1 - HOLD_DIP) * hold.get(),
    transform: [{ scale: travel ? 1 - (1 - HOLD_SCALE) * hold.get() : 1 }],
  }));

  return (
    <Pressable
      // A press-and-hold affordance for sighted users only. Left accessible it would collapse the
      // whole card into one screen-reader element and hide its buttons; "Customize" is the
      // accessible way into edit mode.
      accessible={false}
      delayLongPress={HOLD_MS}
      onPressIn={() => {
        if (instant) return;
        hold.set(
          withTiming(1, { duration: HOLD_MS, easing: motionCurves.exit }),
        );
      }}
      onPressOut={release}
      onLongPress={() => {
        hapticImpactLight();
        release();
        onActivate();
      }}
      style={{ width: "100%" }}
    >
      <Animated.View style={style}>{children}</Animated.View>
    </Pressable>
  );
}
