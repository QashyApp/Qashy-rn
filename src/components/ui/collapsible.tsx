import { useState, type ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

/**
 * Content that folds away as `collapse` goes 0 → 1: its height, the parent's `gap` before it
 * (`gapBefore`) and its opacity all shrink together. The content keeps its natural size inside,
 * so it is measured once and never reflows while it folds. Hidden content is taken out of the
 * accessibility tree and touch handling by the clipped height and zero opacity at rest.
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
  const animated = useAnimatedStyle(() => {
    const progress = collapse.get();
    return {
      height: height === null ? undefined : height * (1 - progress),
      marginTop: -gapBefore * progress,
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
