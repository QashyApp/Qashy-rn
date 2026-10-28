import { useCallback } from "react";
import {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import {
  springConfig,
  useMotionPreference,
} from "@/components/ui/motion/durations";
import { useQashyTheme } from "@/theme/theme";

/**
 * The theme's press feedback for a control that is not a `MotionPressable` (a navigation item that
 * owns its own `Pressable`): the same depth, mode and spring `MotionPressable` uses.
 *
 * A `scale` theme shrinks the content by `motion.pressScale`, a `translate` theme sinks it by
 * `motion.pressTranslate`, an `overlay` theme (Material You) neither moves nor shrinks it, and
 * anything below the full animation level (or under system reduce-motion) stays still. Spread
 * `style` on an `Animated.View` around the content and call `setPressed` from the press-in and
 * press-out handlers.
 */
export function usePressFeedback() {
  const { motion } = useQashyTheme();
  const { travel } = useMotionPreference();
  const scale = useSharedValue(1);
  const translateY = useSharedValue(0);
  const depth = travel && motion.press === "scale" ? motion.pressScale : 1;
  const sink =
    travel && motion.press === "translate" ? motion.pressTranslate : 0;

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.get() }, { scale: scale.get() }],
  }));
  const setPressed = useCallback(
    (pressed: boolean) => {
      scale.set(withSpring(pressed ? depth : 1, springConfig));
      translateY.set(withSpring(pressed ? sink : 0, springConfig));
    },
    [depth, sink, scale, translateY],
  );

  return { style, setPressed };
}
