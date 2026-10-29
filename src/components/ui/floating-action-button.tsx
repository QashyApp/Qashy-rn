import {
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

import { IconButton } from "@/components/ui/icon-button";
import { flattenViewStyle, useMotionPreference } from "@/components/ui/motion";
import { useHiddenFlag } from "@/components/ui/use-hidden-flag";
import { useQashyTheme } from "@/theme/theme";
import { hapticImpactLight } from "@/services/haptics";

export function FloatingActionButton({
  label,
  icon = "plus",
  visibility,
  onPress,
  style,
  disabled = false,
  ...props
}: Omit<PressableProps, "children" | "style"> & {
  label: string;
  icon?: string;
  /** 0–1 shared value (see useScrollHide); the button tucks away toward 0. */
  visibility?: SharedValue<number>;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useQashyTheme();
  const isDisabled = Boolean(disabled);
  // Per-mode in the theme: a near-black shadow vanishes on dark surfaces, so
  // the dark value is deeper and wider rather than tinting the button itself.
  const shadow = theme.shadowFab;
  // Below the full animation level the button only fades; it does not shrink or slide.
  const { travel } = useMotionPreference();
  const visibilityStyle = useAnimatedStyle(() => {
    if (!visibility) return {};
    const shown = visibility.get();
    return travel
      ? {
          opacity: shown,
          transform: [
            { scale: 0.6 + 0.4 * shown },
            { translateY: (1 - shown) * 12 },
          ],
        }
      : { opacity: shown };
  });
  // A faded-out button must not take taps, nor be reachable by a screen reader. Touch routing is a
  // prop on the view: an animated style is not guaranteed to reach hit-testing.
  const hidden = useHiddenFlag(visibility);

  return (
    <Animated.View
      pointerEvents={hidden ? "none" : "auto"}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      style={[flattenViewStyle(style), visibilityStyle]}
    >
      <IconButton
        {...props}
        // A standalone control, not a row in a scroller: it answers the touch at once.
        delayPressIn={0}
        disabled={isDisabled}
        onPress={(event) => {
          hapticImpactLight();
          onPress?.(event);
        }}
        label={label}
        icon={icon}
        variant="accent"
        // Material's FAB is 56px, in the primary container, and keeps its elevation when pressed.
        size={theme.materialControls ? 56 : 58}
        iconSize={theme.materialControls ? 24 : 25}
        iconColor={theme.materialControls ? theme.onAccentContainer : undefined}
        // No entrance: the button is positioned outside the screen's transition
        // boundary, so an entrance here would replay on every visit to the tab.
        // Its motion is `visibility` — tucking away as the list scrolls.
        //
        // `variant="accent"` already gives the accent gradient and fill; this
        // overrides only the shadow, since the FAB reads pressable with a
        // tighter, darker shadow than a regular accent control at rest, and
        // presses in (inset shadow, no opacity dip) rather than dimming.
        style={(state) => ({
          ...(theme.materialControls
            ? { backgroundColor: theme.accentContainer }
            : null),
          boxShadow:
            state.pressed && !theme.materialControls
              ? theme.shadowControlPressed
              : shadow,
          opacity: isDisabled ? 0.4 : 1,
        })}
      />
    </Animated.View>
  );
}
