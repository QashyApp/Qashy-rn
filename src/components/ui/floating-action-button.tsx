import {
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

import { IconButton } from "@/components/ui/icon-button";
import { useQashyTheme } from "@/theme/theme";
import { hapticImpactLight } from "@/utils/haptics";

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
  const visibilityStyle = useAnimatedStyle(() => {
    if (!visibility) return {};
    const shown = visibility.value;
    return {
      opacity: shown,
      transform: [
        { scale: 0.6 + 0.4 * shown },
        { translateY: (1 - shown) * 12 },
      ],
      pointerEvents: shown < 0.5 ? ("none" as const) : ("auto" as const),
    };
  });

  return (
    <Animated.View style={[StyleSheet.flatten(style), visibilityStyle]}>
      <IconButton
        {...props}
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
