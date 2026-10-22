import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { useQashyTheme } from "@/theme/theme";

import {
  NAV_ITEMS,
  NavigationItem,
  type NavItem,
  type NavMetrics,
} from "./web-navigation-item";

// The selected indicator travels between sections rather than each item fading
// its own background in and out. Two discrete fades read as two unrelated
// events; one continuous movement reads as a single surface responding, and it
// is the difference between the navigation looking animated and looking fluid.
const indicatorTiming = {
  duration: 260,
  easing: Easing.bezier(0.2, 0, 0, 1),
  reduceMotion: ReduceMotion.System,
} as const;

function isActiveItem(item: NavItem, pathname: string) {
  return (
    pathname === item.match ||
    pathname.startsWith(`${item.match}/`) ||
    (item.match === "/overview" && pathname === "/")
  );
}

/**
 * The items plus the indicator that slides between them.
 *
 * The items live in their own container rather than directly in the padded
 * navigation surface, so `onLayout` coordinates and the absolutely positioned
 * indicator resolve against exactly the same box — the bottom bar's top border
 * would otherwise offset one against the other.
 */
export function NavigationBar({
  mobile,
  compact,
  narrow,
  pathname,
  onActivePress,
}: {
  mobile: boolean;
  compact: boolean;
  narrow: boolean;
  pathname: string;
  onActivePress: (href: string) => void;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const reduceMotion = useReducedMotion();
  const [metrics, setMetrics] = useState<Record<string, NavMetrics>>({});
  const activeHref = NAV_ITEMS.find((item) =>
    isActiveItem(item, pathname),
  )?.href;
  const activeMetrics = activeHref ? metrics[activeHref] : undefined;

  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const width = useSharedValue(0);
  const height = useSharedValue(0);
  const shown = useSharedValue(0);

  useEffect(() => {
    // The inactive bar is unmounted at the breakpoint, so its metrics never enter this state.
    // There is nothing to position until the active bar has measured itself.
    if (
      !activeMetrics ||
      activeMetrics.width === 0 ||
      activeMetrics.height === 0
    )
      return;
    // A first measurement has nowhere to slide from, so it is placed rather
    // than moved — otherwise the indicator flies in from the corner on load.
    const place = shown.get() === 0 || reduceMotion;
    const apply = (value: SharedValue<number>, next: number) => {
      value.set(place ? next : withTiming(next, indicatorTiming));
    };
    apply(x, activeMetrics.x);
    apply(y, activeMetrics.y);
    apply(width, activeMetrics.width);
    apply(height, activeMetrics.height);
    shown.set(place ? 1 : withTiming(1, indicatorTiming));
  }, [activeMetrics, height, reduceMotion, shown, width, x, y]);

  const indicatorStyle = useAnimatedStyle(() => ({
    opacity: shown.value,
    width: width.value,
    height: height.value,
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));

  const handleMeasure = useCallback((href: string, next: NavMetrics) => {
    setMetrics((current) => {
      const previous = current[href];
      if (
        previous &&
        previous.x === next.x &&
        previous.y === next.y &&
        previous.width === next.width &&
        previous.height === next.height
      ) {
        return current;
      }
      return { ...current, [href]: next };
    });
  }, []);

  return (
    <View
      style={{
        position: "relative",
        flexDirection: mobile ? "row" : "column",
        alignItems: mobile ? "center" : "stretch",
        flex: mobile ? 1 : undefined,
        gap: mobile ? 0 : space.sm,
        zIndex: mobile ? undefined : 10,
      }}
    >
      {theme.materialControls ? null : (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: 0,
              left: 0,
              borderRadius: radius.nav,
              borderCurve: "continuous",
              backgroundColor: theme.accentContainer,
              // The selected item reads as pressed into the surface rather than a
              // flat tinted rectangle — the same "physically depressing" language
              // as every other active/pressed control in the tactile system.
              boxShadow: theme.shadowControlPressed,
            },
            indicatorStyle,
          ]}
        />
      )}
      {NAV_ITEMS.map((item) => (
        <NavigationItem
          key={item.label}
          item={item}
          active={item.href === activeHref}
          compact={compact}
          mobile={mobile}
          narrow={narrow}
          onMeasure={handleMeasure}
          onActivePress={onActivePress}
        />
      ))}
    </View>
  );
}
