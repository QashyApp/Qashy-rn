import type { BottomTabBarProps } from "expo-router/tabs";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { getFloatingBarVisibility } from "@/components/navigation/floating-bar-visibility";
import {
  TAB_SECTION_ICONS,
  type TabSection,
} from "@/components/navigation/tab-sections";
import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { usePressFeedback, useMotionPreference } from "@/components/ui/motion";
import { useLocalization } from "@/localization/localization";
import { FLOATING_BAR_HEIGHT } from "@/theme/layout";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import { hapticImpactLight, hapticSelection } from "@/services/haptics";

/** How long a press must last to open the navigation bar style sheet. */
export const LONG_PRESS_DELAY_MS = 400;
const MAX_BAR_WIDTH = 520;

function PressScale({
  pressed,
  children,
}: {
  pressed: boolean;
  children: ReactNode;
}) {
  const { space, radius, text } = useQashyTheme();
  // The same press feedback as the web bar: the theme's own, not a Material ripple, which would
  // spill across the whole tab. An overlay theme (Material You) neither shrinks nor sinks, so it
  // answers with a state-layer wash over the tab's own shape instead.
  const { style, setPressed, overlay, overlayStyle } = usePressFeedback();
  useEffect(() => {
    setPressed(pressed);
  }, [pressed, setPressed]);
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
      {overlay ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              borderRadius: radius.nav,
              borderCurve: "continuous",
              backgroundColor: text,
            },
            overlayStyle,
          ]}
        />
      ) : null}
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
  emitter,
  navigateToTab,
  insets,
  onLongPress,
}: BottomTabBarProps & { onLongPress: () => void }) {
  const theme = useQashyTheme();
  const { radius, space, motion } = theme;
  const { isRtl, t } = useLocalization();
  const { instant, travel } = useMotionPreference();
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
    // The indicator travels between tabs, so anything below the full level jumps to its slot.
    if (measured.get() === 0 || !travel) {
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
  }, [indicatorX, itemWidth, measured, motion.duration.base, travel, slot]);

  // A new section always shows the bar again, whatever the previous list left it at.
  useEffect(() => {
    visibility.set(
      withTiming(1, {
        duration: motion.duration.fast,
        reduceMotion: instant ? ReduceMotion.Always : ReduceMotion.System,
      }),
    );
  }, [instant, motion.duration.fast, state.index, visibility]);

  const hideDistance =
    FLOATING_BAR_HEIGHT + insets.bottom + space.md + space.lg;
  // Below the full level the bar only fades in and out; it does not slide.
  const containerStyle = useAnimatedStyle(() => ({
    opacity: visibility.value,
    transform: [
      { translateY: travel ? (1 - visibility.value) * hideDistance : 0 },
    ],
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
                  emitter.emit({ type: "tabLongPress", target: route.key });
                  onLongPress();
                }}
                onPress={() => {
                  const event = emitter.emit({
                    type: "tabPress",
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!focused && !event.defaultPrevented) {
                    hapticSelection();
                    navigateToTab(route.key);
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
