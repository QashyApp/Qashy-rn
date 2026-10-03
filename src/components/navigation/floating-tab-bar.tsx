import type { BottomTabBarProps } from "expo-router/tabs";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { getFloatingBarVisibility } from "@/components/navigation/floating-bar-visibility";
import {
  TAB_SECTION_ICONS,
  type TabSection,
} from "@/components/navigation/tab-sections";
import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { useLocalization } from "@/localization/localization";
import { FLOATING_BAR_HEIGHT } from "@/theme/layout";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import { hapticImpactLight } from "@/utils/haptics";

/** How long a press must last to open the navigation bar style sheet. */
export const LONG_PRESS_DELAY_MS = 400;
const MAX_BAR_WIDTH = 520;

// The same press feedback as the web bar: the icon and label dip with a quick spring rather than a
// Material ripple, which would spill across the whole tab.
const pressSpring = {
  damping: 20,
  stiffness: 380,
  mass: 0.7,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
} as const;

function PressScale({
  pressed,
  children,
}: {
  pressed: boolean;
  children: ReactNode;
}) {
  const { space } = useQashyTheme();
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.set(withSpring(pressed ? 0.95 : 1, pressSpring));
  }, [pressed, scale]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return (
    <Animated.View
      style={[
        {
          flex: 1,
          alignSelf: "stretch",
          alignItems: "center",
          justifyContent: "center",
          gap: space.xxs,
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Android's inset "floating" tab bar, drawn in JS (a native `BottomNavigationView` cannot float).
 *
 * It uses the theme's opaque `raised` material and no blur, so it already is its own reduced-transparency
 * fallback. It positions itself absolutely so the screens under it keep their full height; the tabs layout
 * publishes the matching clearance through `BottomBarClearanceContext` for every offset that must clear it.
 */
export function FloatingTabBar({
  state,
  descriptors,
  navigation,
  insets,
  onLongPress,
}: BottomTabBarProps & { onLongPress: () => void }) {
  const theme = useQashyTheme();
  const { radius, space, motion } = theme;
  const { isRtl, t } = useLocalization();
  const reduceMotion = useReducedMotion();
  const count = state.routes.length;
  const [barWidth, setBarWidth] = useState(0);
  const itemWidth = count > 0 ? barWidth / count : 0;
  // `left`/translateX are physical, while the row mirrors in RTL, so the visual slot is mirrored too.
  const slot = isRtl ? count - 1 - state.index : state.index;
  const indicatorX = useSharedValue(0);
  const measured = useSharedValue(0);
  const visibility = getFloatingBarVisibility();

  useEffect(() => {
    if (itemWidth <= 0) return;
    const target = slot * itemWidth;
    if (measured.get() === 0 || reduceMotion) {
      indicatorX.set(target);
      measured.set(1);
      return;
    }
    indicatorX.set(
      withTiming(target, {
        duration: motion.duration.base,
        easing: Easing.bezier(0.2, 0, 0, 1),
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [
    indicatorX,
    itemWidth,
    measured,
    motion.duration.base,
    reduceMotion,
    slot,
  ]);

  // A new section always shows the bar again, whatever the previous list left it at.
  useEffect(() => {
    visibility.set(
      withTiming(1, {
        duration: motion.duration.fast,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [motion.duration.fast, state.index, visibility]);

  const hideDistance =
    FLOATING_BAR_HEIGHT + insets.bottom + space.md + space.lg;
  const containerStyle = useAnimatedStyle(() => ({
    opacity: visibility.value,
    transform: [{ translateY: (1 - visibility.value) * hideDistance }],
    pointerEvents:
      visibility.value < 0.5 ? ("none" as const) : ("auto" as const),
  }));
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.value }],
  }));

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        {
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: space.md,
          paddingBottom: insets.bottom + space.md,
          alignItems: "center",
        },
        containerStyle,
      ]}
    >
      <View
        accessibilityLabel={t("Primary")}
        accessibilityRole="tablist"
        onLayout={(event: LayoutChangeEvent) =>
          setBarWidth(event.nativeEvent.layout.width - space.xs * 2)
        }
        style={[
          {
            width: "100%",
            maxWidth: MAX_BAR_WIDTH,
            height: FLOATING_BAR_HEIGHT,
            borderRadius: radius.sheet,
            borderCurve: "continuous",
            paddingHorizontal: space.xs,
            justifyContent: "center",
          },
          materialStyle(theme, "raised"),
        ]}
      >
        <View style={{ height: 48, flexDirection: "row" }}>
          {itemWidth > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[
                {
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: itemWidth,
                  borderRadius: radius.nav,
                  borderCurve: "continuous",
                  backgroundColor: theme.accentContainer,
                },
                indicatorStyle,
              ]}
            />
          ) : null}
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const options = descriptors[route.key]?.options;
            const label =
              typeof options?.title === "string" ? options.title : route.name;
            const icon =
              TAB_SECTION_ICONS[route.name as TabSection] ?? "ellipsis.circle";
            const color = focused ? theme.onAccentContainer : theme.textMuted;
            return (
              <Pressable
                key={route.key}
                accessibilityLabel={label}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                delayLongPress={LONG_PRESS_DELAY_MS}
                testID={options?.tabBarButtonTestID}
                onLongPress={() => {
                  hapticImpactLight();
                  navigation.emit({ type: "tabLongPress", target: route.key });
                  onLongPress();
                }}
                onPress={() => {
                  const event = navigation.emit({
                    type: "tabPress",
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!focused && !event.defaultPrevented) {
                    navigation.navigate(route.name, route.params);
                  }
                }}
                style={{
                  flex: 1,
                  minHeight: 48,
                  borderRadius: radius.nav,
                }}
              >
                {({ pressed }) => (
                  <PressScale pressed={pressed}>
                    <AppIcon
                      name={focused ? `${icon}.fill` : icon}
                      color={color as string}
                      size={22}
                    />
                    <AppText
                      literal
                      selectable={false}
                      variant="label"
                      numberOfLines={1}
                      style={{ color, fontSize: 11 }}
                    >
                      {label}
                    </AppText>
                  </PressScale>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
    </Animated.View>
  );
}
