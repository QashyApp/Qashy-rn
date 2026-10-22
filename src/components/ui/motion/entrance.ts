import { useEffect } from "react";
import {
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { useAnimationLevel } from "@/components/ui/animation-level-context";
import {
  EASE_STANDARD,
  MotionDurations,
  EASE_EXIT,
  TRAVEL,
} from "@/components/ui/motion/durations";

export type MotionVariant = "fade" | "up" | "down" | "left" | "right" | "zoom";

// Where each variant starts before it settles into place. The presets ship with
// a 25px offset and ZoomIn starts from scale 0, which is what made every mount
// look like it was being performed.
const ENTRANCE_START: Record<
  MotionVariant,
  { translateX: number; translateY: number; scale: number }
> = {
  fade: { translateX: 0, translateY: 0, scale: 1 },
  up: { translateX: 0, translateY: -TRAVEL, scale: 1 },
  down: { translateX: 0, translateY: TRAVEL, scale: 1 },
  left: { translateX: -TRAVEL, translateY: 0, scale: 1 },
  right: { translateX: TRAVEL, translateY: 0, scale: 1 },
  zoom: { translateX: 0, translateY: 0, scale: 0.94 },
};

/**
 * The entrance, driven by a shared value rather than Reanimated's `entering`.
 *
 * It does not use `withInitialValues` to soften the presets. Why: that makes Reanimated
 * generate a keyframe whose name is not in its built-in `Animations` registry.
 * On web that is the one branch of `setElementAnimation` that schedules cleanup,
 * and cleanup for an ENTERING animation calls `setElementPosition` — so roughly
 * 200ms after mount every softened element was permanently given
 * `position: absolute` and a snapshot `top/left/width/height`. Content dropped
 * out of flow across the whole site: button labels landed outside their button,
 * which then collapsed to its own padding.
 *
 * A shared value reaches the same start states without generating a keyframe,
 * and runs identically on the worklet path and on web. `exiting` and `layout`
 * stay on Reanimated: they need an element the tree no longer owns, and neither
 * goes through the branch above.
 */
export function useEntrance(
  variant: MotionVariant,
  delay: number,
  duration: number,
  enabled: boolean,
) {
  const progress = useSharedValue(enabled ? 0 : 1);

  useEffect(() => {
    if (!enabled) return;
    progress.set(
      withDelay(
        delay,
        withTiming(1, {
          duration,
          easing: EASE_STANDARD,
          reduceMotion: ReduceMotion.System,
        }),
      ),
    );
  }, [delay, duration, enabled, progress]);

  // At the minimal level everything arrives as a plain fade, with no travel or scaling.
  const level = useAnimationLevel();
  const start = ENTRANCE_START[level === "minimal" ? "fade" : variant];
  const style = useAnimatedStyle(() => {
    const remaining = 1 - progress.value;
    return {
      opacity: progress.value,
      transform: [
        { translateX: start.translateX * remaining },
        { translateY: start.translateY * remaining },
        { scale: 1 - (1 - start.scale) * remaining },
      ],
    };
  });

  // Elements that arrive with their screen never carry an opacity or transform
  // they did not ask for.
  return enabled ? style : null;
}

// Every exit is a plain fade, whatever the entrance was. Direction is
// information about where content is *going*, and content being removed isn't
// going anywhere — the incoming element already carries the direction. Keeping
// exits uniform also sidesteps the presets' fixed 25px exit offset, which
// `withInitialValues` cannot reach because it only overrides the start state.
export function exitingAnimation(durations: MotionDurations) {
  return FadeOut.duration(durations.exit)
    .easing(EASE_EXIT)
    .reduceMotion(ReduceMotion.System);
}
