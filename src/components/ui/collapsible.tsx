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

/** Browsers can take a folded block out of the tab order and the accessibility tree outright. */
const WEB = process.env.EXPO_OS === "web";

/**
 * Content that folds away as `collapse` goes 0 → 1: its height, the parent's `gap` before it
 * (`gapBefore`) and its opacity all shrink together. The content keeps its natural size inside,
 * so it is measured once and never reflows while it folds. Content that is `folded` (shut, or on
 * its way shut) is out of reach: it takes no touches, a screen reader skips it, and on the web it
 * is hidden once the fold has finished, so Tab never lands on a control nobody can see.
 *
 * Without travel (the minimal animation level) only the opacity fades: the height and the gap snap
 * to their folded or open size as the fold passes its midpoint.
 *
 * Once measured (or from the start, when it starts folded), the content is laid out absolutely, so the folded height can never constrain
 * it. In flow, Android could report the content at its folded size; that height of 0 was then
 * kept, and the block never unfolded again.
 */
export function Collapsible({
  collapse,
  folded,
  gapBefore = 0,
  style,
  children,
}: {
  collapse: SharedValue<number>;
  /** Whether the block is meant to be shut: the state `collapse` is heading for. */
  folded: boolean;
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
      // Not yet measured: a block that starts folded takes no room at all, rather than its
      // natural height for the frame before the measurement lands.
      height:
        height === null
          ? folded
            ? 0
            : undefined
          : height * (1 - layoutProgress),
      marginTop: -gapBefore * layoutProgress,
      opacity: 1 - progress,
      // Only once it is fully shut: a block that is still folding stays visible to the end.
      ...(WEB
        ? ({ visibility: progress >= 1 ? "hidden" : "visible" } as object)
        : null),
    };
  });
  return (
    <Animated.View
      style={[{ overflow: "hidden" }, animated]}
      pointerEvents={folded ? "none" : "auto"}
      importantForAccessibility={folded ? "no-hide-descendants" : "auto"}
      aria-hidden={folded ? true : undefined}
    >
      <View
        style={[height === null && !folded ? null : MEASURED_STYLE, style]}
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
