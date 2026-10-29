/**
 * The line that shows where a dragged Overview card will land. It sits inside the edit stack
 * (absolutely positioned, so it takes no part in the stack's layout) and is driven entirely by
 * the reorder state's shared values, so following the finger costs no React renders.
 */

import { useMemo } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { useMotionPreference } from "@/components/ui/motion";
import { insertionLineY } from "@/features/overview/edit/drag-math";
import type { CardReorder } from "@/features/overview/edit/use-card-reorder";
import { useQashyTheme } from "@/theme/theme";

const THICKNESS = 3;
/**
 * Above the lifted card, whose wrapper sits at z-index 10. The card's lift is a `boxShadow` (no
 * elevation), so on Android and web the z-order alone decides what is drawn on top.
 */
export const DROP_LINE_Z_INDEX = 20;

export function DropIndicator({ reorder }: { reorder: CardReorder }) {
  const { accent, radius, motion } = useQashyTheme();
  const { instant, travel } = useMotionPreference();
  const { slots, source, target, gap } = reorder;
  const lineY = useSharedValue(0);
  const shown = useSharedValue(0);
  const fade = instant ? 0 : motion.duration.fast;
  // The line is not dragged by the user, so it settles without overshooting the slot.
  const spring = useMemo(
    () => ({ ...motion.spring.snappy, overshootClamping: true }),
    [motion.spring.snappy],
  );

  useAnimatedReaction(
    () => insertionLineY(slots.get(), source.get(), target.get(), gap),
    (line, previous) => {
      if (line === null) {
        shown.set(withTiming(0, { duration: fade }));
        return;
      }
      // Appearing: place it straight away, then glide between slots while it is visible.
      if (previous === null || previous === undefined || !travel) {
        lineY.set(line);
      } else {
        lineY.set(withSpring(line, spring));
      }
      shown.set(withTiming(1, { duration: fade }));
    },
    [gap, fade, travel, spring],
  );

  const style = useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [{ translateY: lineY.get() - THICKNESS / 2 }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.line,
        { backgroundColor: accent, borderRadius: radius.pill },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  line: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: THICKNESS,
    zIndex: DROP_LINE_Z_INDEX,
  },
});
