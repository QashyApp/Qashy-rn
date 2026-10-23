import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import type { KeypadPressableProps } from "@/components/finance/keypad-pressable";
import {
  springConfig,
  useMotionPreference,
} from "@/components/ui/motion/durations";
import { useQashyTheme } from "@/theme/theme";

/** How long a hold takes to count as a long press (the backspace key's clear). */
const LONG_PRESS_MS = 450;

/**
 * A keypad key on Android, driven by react-native-gesture-handler rather than the responder system.
 *
 * React Native's responder system grants a touch to one view at a time, so a `Pressable` ignores a
 * second finger that lands while the first is still down, which drops keys when two thumbs type fast.
 * Each key's `GestureDetector` is independent, so overlapping touches on different keys all register.
 *
 * A key fires when the finger lifts (a tap), as a `Pressable` does: a finger that slides off a key
 * cancels it, and the backspace key can tell a tap from a hold. The press feedback (the theme's press
 * scale and the pressed surface) follows the gesture's begin and end.
 *
 * Gestures do not fire for TalkBack's double-tap, so the key also exposes an `activate` accessibility
 * action, which is what the screen reader performs.
 */
export function KeypadPressable({
  accessibilityLabel,
  onPress,
  onLongPress,
  style,
  children,
}: KeypadPressableProps) {
  const { motion } = useQashyTheme();
  const { travel } = useMotionPreference();
  const [pressed, setPressed] = useState(false);
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  // The gestures are built once; they call whatever the latest handlers are.
  const latest = useRef({ onPress, onLongPress });
  useEffect(() => {
    latest.current = { onPress, onLongPress };
  });
  const firePress = useCallback(() => latest.current.onPress(), []);
  const fireLongPress = useCallback(() => latest.current.onLongPress?.(), []);
  const pressScale = travel && motion.press === "scale" ? motion.pressScale : 1;
  const hasLongPress = onLongPress !== undefined;

  const gesture = useMemo(() => {
    const feedback = (down: boolean) => {
      setPressed(down);
      scale.set(withSpring(down ? pressScale : 1, springConfig));
    };
    const tap = Gesture.Tap()
      .runOnJS(true)
      .maxDuration(hasLongPress ? LONG_PRESS_MS : 60_000)
      .maxDistance(40)
      .onBegin(() => feedback(true))
      // The handlers only read the ref when a gesture fires, never while rendering.
      // eslint-disable-next-line react-hooks/refs
      .onEnd((_event, success) => {
        if (success) firePress();
      })
      .onFinalize(() => feedback(false));
    if (!hasLongPress) return tap;
    const hold = Gesture.LongPress()
      .runOnJS(true)
      .minDuration(LONG_PRESS_MS)
      .maxDistance(40)
      // eslint-disable-next-line react-hooks/refs
      .onStart(fireLongPress);
    return Gesture.Race(tap, hold);
  }, [hasLongPress, pressScale, scale, firePress, fireLongPress]);

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityActions={[{ name: "activate" }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "activate") firePress();
        }}
        style={[style(pressed), animated]}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
