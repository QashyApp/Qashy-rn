import { useCallback } from "react";
import {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import {
  EASE_STANDARD,
  springConfig,
  useMotionDurations,
  useMotionPreference,
} from "@/components/ui/motion/durations";
import { useQashyTheme } from "@/theme/theme";

/** The press-state wash opacity, the same 10% `MotionPressable` uses for its state layer. */
const OVERLAY_PRESS = 0.1;

/**
 * The theme's press feedback for a control that is not a `MotionPressable` (a navigation item that
 * owns its own `Pressable`): the same depth, mode and spring `MotionPressable` uses.
 *
 * A `scale` theme shrinks the content by `motion.pressScale`, a `translate` theme sinks it by
 * `motion.pressTranslate`, and anything below the full animation level (or under system
 * reduce-motion) stays still. An `overlay` theme (Material You) never moves the content; its
 * feedback is a translucent wash of the text color. Spread `style` on an `Animated.View` around the
 * content, and when `overlay` is true render an absolutely filled `Animated.View` (pointer events
 * off, the control's own corner radius, `backgroundColor` the theme's text color) with
 * `overlayStyle` behind or beside the content. The wash is opacity only, so it stays under
 * reduced motion, like the wash on a `MotionPressable`. Call `setPressed` from the press-in and
 * press-out handlers.
 */
export function usePressFeedback() {
  const { motion } = useQashyTheme();
  const { travel, instant } = useMotionPreference();
  const durations = useMotionDurations();
  const scale = useSharedValue(1);
  const translateY = useSharedValue(0);
  const wash = useSharedValue(0);
  const overlay = motion.press === "overlay";
  const depth = travel && motion.press === "scale" ? motion.pressScale : 1;
  const sink =
    travel && motion.press === "translate" ? motion.pressTranslate : 0;
  const washDuration = durations.exit;

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.get() }, { scale: scale.get() }],
  }));
  const overlayStyle = useAnimatedStyle(() => ({ opacity: wash.get() }));
  const setPressed = useCallback(
    (pressed: boolean) => {
      scale.set(withSpring(pressed ? depth : 1, springConfig));
      translateY.set(withSpring(pressed ? sink : 0, springConfig));
      if (overlay)
        wash.set(
          withTiming(pressed ? OVERLAY_PRESS : 0, {
            duration: washDuration,
            easing: EASE_STANDARD,
            reduceMotion: instant ? ReduceMotion.Always : ReduceMotion.System,
          }),
        );
    },
    [depth, sink, overlay, washDuration, instant, scale, translateY, wash],
  );

  return { style, setPressed, overlay, overlayStyle };
}
