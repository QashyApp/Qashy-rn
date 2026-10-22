import type { ReactNode } from "react";
import type { ViewStyle } from "react-native";

import { MotionPressable } from "@/components/ui/motion";
import { useQashyTheme } from "@/theme/theme";

export interface KeypadPressableProps {
  accessibilityLabel: string;
  onPress: () => void;
  /** Held down: the backspace key clears with it. */
  onLongPress?: () => void;
  style: (pressed: boolean) => ViewStyle;
  children: ReactNode;
}

/**
 * The touch surface of a keypad key. On the web (and as the fallback) it is a `MotionPressable`:
 * a mouse has one pointer, and the browser already gives keys focus, Enter and Space.
 * `keypad-pressable.native.tsx` replaces it on Android so two fingers can type at once.
 */
export function KeypadPressable({
  accessibilityLabel,
  onPress,
  onLongPress,
  style,
  children,
}: KeypadPressableProps) {
  const { motion } = useQashyTheme();
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onLongPress={onLongPress}
      pressedScale={motion.pressScale}
      style={({ pressed }) => style(pressed)}
    >
      {children}
    </MotionPressable>
  );
}
