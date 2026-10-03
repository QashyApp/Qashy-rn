import { useMemo } from "react";
import { Gesture } from "react-native-gesture-handler";
import {
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { motionCurves } from "@/components/ui/motion";
import type { MonthDirection } from "@/components/ui/month-switcher";
import { useLocalization } from "@/localization/localization";
import { useFinanceState } from "@/providers/finance-provider";
import { moveMonth } from "@/utils/date";
import { hapticSelection } from "@/utils/haptics";

const SWIPE_DISTANCE = 64;
const SWIPE_VELOCITY = 600;
/** The content trails the finger at this ratio, so it reads as resistance rather than a free drag. */
const FOLLOW = 0.45;
/** Past the newest allowed month the content barely moves. */
const BLOCKED_FOLLOW = 0.12;
/** Where the incoming month starts, opposite the swipe, before settling. */
const ARRIVE_OFFSET = 44;

/**
 * Horizontal swipe to step months, gated by the device-local `swipeBetweenMonths`
 * setting. Returns `{ gesture, style }` for `MonthSwipeView`, or `null` on web, where a
 * mouse drag would fight text selection. The gesture is disabled while the setting is off,
 * so the view tree never changes shape.
 *
 * The content follows the finger with resistance and dims slightly; on release past the
 * threshold the month changes and the new content settles in from the opposite side, otherwise
 * it springs back. Vertical movement fails the gesture early so the list keeps scrolling.
 * Dragging toward the end edge reveals the next month, flipped in right-to-left locales.
 */
export function useMonthSwipe({
  month,
  onChange,
  max,
  disabled = false,
}: {
  month: string;
  onChange: (month: string, direction: MonthDirection) => void;
  max?: string;
  disabled?: boolean;
}) {
  const { settings } = useFinanceState();
  const { isRtl } = useLocalization();
  const translateX = useSharedValue(0);
  const supported = process.env.EXPO_OS !== "web";
  const active = Boolean(settings.swipeBetweenMonths) && !disabled;

  const style = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(Math.abs(translateX.value) / 400, 0.2),
    transform: [{ translateX: translateX.value }],
  }));

  const gesture = useMemo(() => {
    if (!supported) return null;
    const canForward = !(max != null && moveMonth(month, 1) > max);
    const step = (delta: number) => {
      hapticSelection();
      onChange(moveMonth(month, delta), delta > 0 ? "right" : "left");
    };
    const settle = () => {
      "worklet";
      translateX.set(
        withTiming(0, {
          duration: 220,
          easing: motionCurves.standard,
          reduceMotion: ReduceMotion.System,
        }),
      );
    };
    // +1 forward / -1 back for a drag of `dx` pixels.
    const directionOf = (dx: number) => {
      "worklet";
      return dx > 0 === isRtl ? 1 : -1;
    };
    return Gesture.Pan()
      .enabled(active)
      .activeOffsetX([-24, 24])
      .failOffsetY([-14, 14])
      .onUpdate((event) => {
        const blocked = directionOf(event.translationX) > 0 && !canForward;
        translateX.set(
          event.translationX * (blocked ? BLOCKED_FOLLOW : FOLLOW),
        );
      })
      .onEnd((event) => {
        const far =
          Math.abs(event.translationX) >= SWIPE_DISTANCE ||
          Math.abs(event.velocityX) >= SWIPE_VELOCITY;
        const delta = directionOf(event.translationX);
        if (!far || (delta > 0 && !canForward)) return;
        runOnJS(step)(delta);
        // The new month arrives from the side the finger was heading toward.
        translateX.set(event.translationX > 0 ? -ARRIVE_OFFSET : ARRIVE_OFFSET);
      })
      .onFinalize(() => {
        settle();
      });
  }, [supported, active, month, onChange, max, isRtl, translateX]);

  return useMemo(() => (gesture ? { gesture, style } : null), [gesture, style]);
}

export type MonthSwipe = NonNullable<ReturnType<typeof useMonthSwipe>>;
