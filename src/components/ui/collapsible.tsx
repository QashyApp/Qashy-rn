import { useState, type ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

import { useMotionPreference } from "@/components/ui/motion";

/** Without travel, the fold snaps shut (or open) as it passes this point. */
const FOLDED_AT = 0.5;

/**
 * Content that folds away as `collapse` goes 0 → 1: its height, the parent's `gap` before it
 * (`gapBefore`) and its opacity all shrink together. The content keeps its natural size inside,
 * so it is measured once and never reflows while it folds. Folded content stays focusable on
 * purpose: focusing a folded control (Tab on the web, a screen reader) is how a caller such as the
 * Transactions toolbar knows to open it again.
 *
 * Without travel (the minimal animation level) only the opacity fades: the height and the gap snap
 * to their folded or open size as the fold passes its midpoint.
 *
 * Once measured, the content is laid out absolutely, so the folded height can never constrain
 * it. In flow, Android could report the content at its folded size; that height of 0 was then
 * kept, and the block never unfolded again.
 */
export function Collapsible({
  collapse,
  gapBefore = 0,
  style,
  children,
}: {
  collapse: SharedValue<number>;
  /** The parent's `gap`, so the space before this block folds with it. */
  gapBefore?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const [height, setHeight] = useState<number | null>(null);
  const { travel } = useMotionPreference();
  const animated = useAnimatedStyle(() => {
    const progress = collapse.get();
    const layoutProgress = travel ? progress : progress >= FOLDED_AT ? 1 : 0;
    return {
      height: height === null ? undefined : height * (1 - layoutProgress),
      marginTop: -gapBefore * layoutProgress,
      opacity: 1 - progress,
    };
  });
  return (
    <Animated.View style={[{ overflow: "hidden" }, animated]}>
      <View
        style={[height === null ? null : MEASURED_STYLE, style]}
        onLayout={(event) => {
          const next = event.nativeEvent.layout.height;
          // Nothing folds to nothing: a zero is a clipped measurement, never the content's size.
          if (next > 0) setHeight(next);
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}

const MEASURED_STYLE = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
} as const;
