import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, View, type LayoutRectangle } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { usePressFeedback } from "@/components/ui/motion";
import { useLocalization } from "@/localization/localization";
import { NAV_RAIL_WIDTH } from "@/theme/layout";
import { useQashyTheme } from "@/theme/theme";

// Icon names are the SF-style ids resolved through `AppIcon`, so the same section
// reads the same on every platform.
export const NAV_ITEMS = [
  {
    href: "/overview" as const,
    label: "Overview",
    icon: "house",
    match: "/overview",
  },
  {
    href: "/transactions" as const,
    label: "Transactions",
    icon: "list.bullet.rectangle",
    match: "/transactions",
  },
  { href: "/plan" as const, label: "Plan", icon: "chart.pie", match: "/plan" },
  {
    href: "/more" as const,
    label: "More",
    icon: "ellipsis.circle",
    match: "/more",
  },
];

/** The selected section switches to the solid glyph, as the native tabs do. */
const activeIconName = (icon: string) => `${icon}.fill`;

// Hover affordances fade in place rather than mounting and unmounting.
// Reanimated's web exit moves the leaving element into a clone and appends that
// clone as the *last* child of the pressable, so the opaque hover background —
// which paints behind the icon while it is a real child — reappeared on top of
// the icon for the length of its own fade. The icon blinked every time the
// pointer left an item, and again when a click made that item active and
// unmounted the background under it.
const hoverTiming = {
  duration: 120,
  easing: Easing.bezier(0.2, 0, 0, 1),
  reduceMotion: ReduceMotion.System,
} as const;

// The tooltip keeps its original asymmetry: it arrives at the standard enter
// duration and leaves at the faster exit one.
const tooltipInTiming = { ...hoverTiming, duration: 200 } as const;
const tooltipOutTiming = hoverTiming;
/** How far the tooltip slides in from, matching the shared motion system. */
const TOOLTIP_TRAVEL = 8;

/** Icon target in the compact rail. The rail's padding is derived from it. */
const RAIL_ITEM_SIZE = 52;
/** Centres the rail's icon column: 52pt of target inside 84pt of rail. */
export const RAIL_GUTTER = (NAV_RAIL_WIDTH - RAIL_ITEM_SIZE) / 2;
/**
 * Measured from the item, so it has to clear the rest of the rail and its border
 * before the gap starts. A fixed 58 left the tooltip straddling the divider,
 * where the only part of it not covered by the page was the sliver still inside
 * the rail — it read as a stray 6pt rectangle rather than a label.
 */
const tooltipOffset = (gap: number) => NAV_RAIL_WIDTH - RAIL_GUTTER + gap;
const TOOLTIP_HEIGHT = 36;

export type NavItem = (typeof NAV_ITEMS)[number];
export type NavMetrics = Pick<LayoutRectangle, "x" | "y" | "width" | "height">;

export function NavigationItem({
  item,
  active,
  compact,
  mobile,
  narrow,
  onMeasure,
  onActivePress,
}: {
  item: NavItem;
  active: boolean;
  compact: boolean;
  mobile: boolean;
  /** Viewports where a quarter of the bar is too tight for "Transactions". */
  narrow: boolean;
  onMeasure: (href: string, metrics: NavMetrics) => void;
  /** Pressing the section that is already showing: scroll it back to the top. */
  onActivePress: (href: string) => void;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const m3 = theme.materialControls;
  // M3 navigation bar / rail: the icon sits in a pill (64x32 bar, 56x32 rail) with the label
  // below it; the expanded sidebar is a drawer whose item is the pill. No tooltip, no slide.
  const stacked = m3 && (mobile || compact);
  const { isRtl, t } = useLocalization();
  const [showTooltip, setShowTooltip] = useState(false);
  const currentPageProps = active ? { "aria-current": "page" as const } : {};
  const foreground = active
    ? m3
      ? theme.onSecondaryContainer
      : theme.onAccentContainer
    : showTooltip
      ? theme.text
      : theme.textMuted;
  const { style: contentStyle, setPressed } = usePressFeedback();

  // The selected item already carries the accent indicator, so it never shows
  // the hover background underneath it.
  const highlighted = showTooltip && !active;
  const tooltipShown = compact && !mobile && showTooltip && !m3;
  const highlight = useSharedValue(0);
  const tooltipProgress = useSharedValue(0);

  useEffect(() => {
    highlight.set(withTiming(highlighted ? 1 : 0, hoverTiming));
  }, [highlight, highlighted]);

  useEffect(() => {
    tooltipProgress.set(
      withTiming(
        tooltipShown ? 1 : 0,
        tooltipShown ? tooltipInTiming : tooltipOutTiming,
      ),
    );
  }, [tooltipProgress, tooltipShown]);

  // The rail sits on the right in RTL, so the tooltip slides in from the left.
  const direction = isRtl ? -1 : 1;
  const highlightStyle = useAnimatedStyle(() => ({ opacity: highlight.value }));
  const tooltipStyle = useAnimatedStyle(() => ({
    opacity: tooltipProgress.value,
    transform: [
      { translateX: (1 - tooltipProgress.value) * TOOLTIP_TRAVEL * direction },
    ],
  }));
  return (
    <Link href={item.href} asChild>
      {/* Link asChild drops function-form styles on web, so this must stay a
          plain style object; animated feedback lives on the inner views. */}
      <Pressable
        {...currentPageProps}
        accessibilityHint={
          compact && !mobile && !m3 ? t(item.label) : undefined
        }
        accessibilityLabel={t(item.label)}
        accessibilityRole="link"
        /* `aria-current` (above) conveys the active page. `aria-selected` is not valid on a link,
           and react-native-web also derives it from `accessibilityState.selected`, so neither is set. */
        onBlur={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onHoverIn={() => setShowTooltip(true)}
        onHoverOut={() => setShowTooltip(false)}
        onLayout={(event) => {
          const { x, y, width, height } = event.nativeEvent.layout;
          onMeasure(item.href, { x, y, width, height });
        }}
        onPress={() => {
          if (active) onActivePress(item.href);
        }}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={{
          minHeight: stacked ? (mobile ? 64 : 56) : m3 ? 56 : 48,
          minWidth: stacked
            ? undefined
            : mobile
              ? 64
              : compact
                ? RAIL_ITEM_SIZE
                : undefined,
          flex: mobile ? 1 : undefined,
          paddingHorizontal: stacked
            ? 0
            : mobile
              ? narrow
                ? 2
                : 4
              : compact
                ? 12
                : 16,
          borderRadius: m3 && !stacked ? 28 : radius.nav,
          borderCurve: "continuous",
          backgroundColor: "transparent",
          position: "relative",
          zIndex: showTooltip ? 20 : undefined,
        }}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              borderRadius: m3 && !stacked ? 28 : radius.nav,
              borderCurve: "continuous",
              backgroundColor: theme.surfaceMuted,
              display: stacked ? "none" : "flex",
            },
            highlightStyle,
          ]}
        />
        {m3 && !stacked && active ? (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              borderRadius: 28,
              backgroundColor: theme.secondaryContainer,
            }}
          />
        ) : null}
        <Animated.View
          style={[
            {
              flex: 1,
              alignSelf: "stretch",
              flexDirection: mobile || compact ? "column" : "row",
              alignItems: "center",
              // Only the expanded sidebar starts its content at the leading edge,
              // because there the icon is followed by a label and the labels have
              // to line up. Everywhere else the icon is alone in the box, and
              // `flex-start` was pinning it to the top of a 48pt target — the
              // rail's selected pill sat visibly low around its own icon.
              justifyContent: mobile || compact ? "center" : "flex-start",
              gap: mobile ? space.xxs : space.sm,
            },
            contentStyle,
          ]}
        >
          {stacked ? (
            <View
              style={{
                width: mobile ? 64 : 56,
                height: 32,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: active
                  ? theme.secondaryContainer
                  : "transparent",
              }}
            >
              {!active ? (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    {
                      position: "absolute",
                      top: 0,
                      right: 0,
                      bottom: 0,
                      left: 0,
                      borderRadius: 16,
                      backgroundColor: theme.surfaceMuted,
                    },
                    highlightStyle,
                  ]}
                />
              ) : null}
              <AppIcon
                name={active ? activeIconName(item.icon) : item.icon}
                color={foreground as string}
                size={24}
              />
            </View>
          ) : (
            <AppIcon
              name={active ? activeIconName(item.icon) : item.icon}
              color={foreground as string}
              size={mobile ? 22 : 20}
            />
          )}
          {mobile || !compact || stacked ? (
            <AppText
              selectable={false}
              variant="label"
              numberOfLines={1}
              style={{
                color: m3 && !active ? theme.textMuted : foreground,
                fontSize: m3 ? 12 : mobile ? (narrow ? 10 : 11) : undefined,
                fontWeight: m3 ? "500" : undefined,
                letterSpacing: mobile && narrow && !m3 ? -0.2 : undefined,
              }}
            >
              {item.label}
            </AppText>
          ) : null}
        </Animated.View>
        {/* Mounted for the whole time the rail is compact, so only a breakpoint
            change adds or removes it. `aria-hidden` keeps a faded-out tooltip
            out of the accessibility tree exactly as unmounting would. */}
        {compact && !mobile && !m3 ? (
          <Animated.View
            aria-hidden={!showTooltip}
            pointerEvents="none"
            role="tooltip"
            style={[
              {
                position: "absolute",
                start: tooltipOffset(space.sm),
                top: (48 - TOOLTIP_HEIGHT) / 2,
                minHeight: TOOLTIP_HEIGHT,
                justifyContent: "center",
                paddingHorizontal: 12,
                borderRadius: radius.control,
                backgroundColor: theme.navBackground,
                borderWidth: 1,
                borderColor: theme.border,
                boxShadow: theme.shadowRaised,
              },
              tooltipStyle,
            ]}
          >
            <AppText selectable={false} variant="caption" numberOfLines={1}>
              {item.label}
            </AppText>
          </Animated.View>
        ) : null}
      </Pressable>
    </Link>
  );
}
