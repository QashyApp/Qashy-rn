import { Link, useIsFocused, usePathname } from "expo-router";
import { Tabs, type BottomTabBarProps } from "expo-router/tabs";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  Pressable,
  View,
  useWindowDimensions,
  type LayoutRectangle,
} from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAnimationLevel } from "@/components/ui/animation-level-context";
import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { useLocalization } from "@/localization/localization";
import { materialStyle } from "@/theme/materials";
import {
  ContentWidthContext,
  NAV_RAIL_BREAKPOINT,
  NAV_RAIL_WIDTH,
  NAV_SIDEBAR_BREAKPOINT,
  navigationRailWidth,
} from "@/theme/layout";
import { useQashyTheme } from "@/theme/theme";

// Icon names mirror the SF Symbols used by the native tabs in `_layout.tsx` so
// the same section reads the same on every platform.
const NAV_ITEMS = [
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

/** Long enough to read as a fade, short enough that it never makes a section feel slow to open. */
const SECTION_FADE_MS = 250;

/**
 * A section that has been left stays mounted (that is the point), but once its fade-out is over
 * it is removed from layout, so it cannot be tabbed into, read by a screen reader or matched by
 * a query for what is on screen.
 */
function SectionVisibility({ children }: { children: ReactElement }) {
  const focused = useIsFocused();
  const [expired, setExpired] = useState(!focused);
  useEffect(() => {
    if (focused) return;
    const timer = setTimeout(() => setExpired(true), SECTION_FADE_MS + 50);
    return () => {
      clearTimeout(timer);
      setExpired(false);
    };
  }, [focused]);
  const hidden = !focused && expired;
  return (
    <View style={{ flex: 1, display: hidden ? "none" : "flex" }}>
      {children}
    </View>
  );
}

/** The selected section switches to the solid glyph, as the native tabs do. */
const activeIconName = (icon: string) => `${icon}.fill`;

const pressSpring = {
  damping: 20,
  stiffness: 380,
  mass: 0.7,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
} as const;

// The selected indicator travels between sections rather than each item fading
// its own background in and out. Two discrete fades read as two unrelated
// events; one continuous movement reads as a single surface responding, and it
// is the difference between the navigation looking animated and looking fluid.
const indicatorTiming = {
  duration: 260,
  easing: Easing.bezier(0.2, 0, 0, 1),
  reduceMotion: ReduceMotion.System,
} as const;

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
const RAIL_GUTTER = (NAV_RAIL_WIDTH - RAIL_ITEM_SIZE) / 2;
/**
 * Measured from the item, so it has to clear the rest of the rail and its border
 * before the gap starts. A fixed 58 left the tooltip straddling the divider,
 * where the only part of it not covered by the page was the sliver still inside
 * the rail — it read as a stray 6pt rectangle rather than a label.
 */
const tooltipOffset = (gap: number) => NAV_RAIL_WIDTH - RAIL_GUTTER + gap;
const TOOLTIP_HEIGHT = 36;

type NavItem = (typeof NAV_ITEMS)[number];
type NavMetrics = Pick<LayoutRectangle, "x" | "y" | "width" | "height">;

function isActiveItem(item: NavItem, pathname: string) {
  return (
    pathname === item.match ||
    pathname.startsWith(`${item.match}/`) ||
    (item.match === "/overview" && pathname === "/")
  );
}

/**
 * What the section tabs hand back to the layout around them. The sidebar and the bottom bar are
 * drawn by the layout, outside the tab navigator, so they cannot emit navigator events themselves;
 * the invisible tab bar below publishes this instead.
 */
interface TabPressBridge {
  /** Emits `tabPress` for the section, as a tab bar does; screens' `useScrollToTop` listens for it. */
  press: (section: string) => void;
}

/** Renders nothing. Exists only to expose the navigator's `emit` to the layout. */
function TabPressPublisher({
  state,
  navigation,
  bridgeRef,
}: BottomTabBarProps & {
  bridgeRef: { current: TabPressBridge | null };
}) {
  useEffect(() => {
    bridgeRef.current = {
      press: (section) => {
        const route = state.routes.find(
          (candidate) => candidate.name === section,
        );
        if (!route) return;
        navigation.emit({
          type: "tabPress",
          target: route.key,
          canPreventDefault: true,
        });
      },
    };
    return () => {
      bridgeRef.current = null;
    };
  }, [bridgeRef, navigation, state.routes]);
  return null;
}

function NavigationItem({
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
  const pressScale = useSharedValue(1);
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

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
        onPressIn={() => {
          if (!m3) pressScale.set(withSpring(0.95, pressSpring));
        }}
        onPressOut={() => {
          if (!m3) pressScale.set(withSpring(1, pressSpring));
        }}
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
            out of the accessibility tree exactly as unmounting used to. */}
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

/**
 * The items plus the indicator that slides between them.
 *
 * The items live in their own container rather than directly in the padded
 * navigation surface, so `onLayout` coordinates and the absolutely positioned
 * indicator resolve against exactly the same box — the bottom bar's top border
 * would otherwise offset one against the other.
 */
function NavigationBar({
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

export default function WebTabsLayout() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const { t } = useLocalization();
  const compact = width < NAV_SIDEBAR_BREAKPOINT;
  const mobile = width < NAV_RAIL_BREAKPOINT;
  const narrow = width < 360;
  // Screens size themselves against this rather than the window, so the rail
  // widening at 1200 no longer pushes their internal breakpoints around.
  const railWidth = navigationRailWidth(width);
  const reducedMotion = useReducedMotion();
  const animationLevel = useAnimationLevel();
  const fadeBetweenSections = !reducedMotion && animationLevel !== "off";
  const tabPressBridge = useRef<TabPressBridge | null>(null);
  const pressActiveSection = useCallback((href: string) => {
    tabPressBridge.current?.press(href.slice(1));
  }, []);

  return (
    <View
      style={{
        flex: 1,
        flexDirection: mobile ? "column" : "row",
        backgroundColor: theme.background,
      }}
    >
      <View
        accessibilityLabel={t("Primary")}
        role="navigation"
        style={{
          display: mobile ? "none" : "flex",
          width: railWidth,
          // Above the content pane, which is a later sibling and therefore paints
          // over it by default. Nothing here overlaps the page except the compact
          // rail's tooltip, and that tooltip was disappearing under it.
          zIndex: 30,
          // `viewport-fit=cover` means an installed PWA draws under the status
          // bar and the display cutouts, so the rail has to pad by real insets.
          paddingTop: space.xl + insets.top,
          paddingBottom: space.xl + insets.bottom,
          // The compact rail's gutter is whatever centres a 52pt icon target in
          // the 84pt the layout reserves. Padding chosen independently of the
          // target made the items wider than the box that held them, so both the
          // icons and the selected pill overhung the divider.
          paddingStart:
            (theme.materialControls
              ? compact
                ? 0
                : space.md
              : compact
                ? RAIL_GUTTER
                : space.xl) + insets.left,
          paddingEnd: theme.materialControls
            ? compact
              ? 0
              : space.md
            : compact
              ? RAIL_GUTTER
              : space.xl,
          // M3 rails and drawers sit on the container color with no divider.
          borderEndWidth: theme.materialControls ? 0 : 1,
          borderEndColor: theme.border,
          backgroundColor: theme.materialControls
            ? theme.navBackground
            : undefined,
          gap: space.xxl,
        }}
      >
        <View
          style={{
            minHeight: 52,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: compact ? "center" : "flex-start",
            gap: space.md,
          }}
        >
          <View
            style={[
              {
                width: 38,
                height: 38,
                borderRadius: radius.tile,
                borderCurve: "continuous",
                alignItems: "center",
                justifyContent: "center",
              },
              materialStyle(theme, "accent"),
            ]}
          >
            <AppText
              selectable={false}
              variant="headline"
              style={{ color: theme.onAccent }}
            >
              Q
            </AppText>
          </View>
          {!compact ? <AppText variant="headline">Qashy</AppText> : null}
        </View>
        {!mobile ? (
          <NavigationBar
            mobile={false}
            compact={compact}
            narrow={narrow}
            pathname={pathname}
            onActivePress={pressActiveSection}
          />
        ) : null}
        {!compact ? (
          <View style={{ marginTop: "auto", gap: space.xs }}>
            <AppText variant="overline" muted>
              {t("Local-first finance")}
            </AppText>
            {/* Not "stays on this device" any more: with sync on, it also reaches the user's
                other devices. What survived the change is the claim that actually matters —
                nobody else, including any relay in the middle, can read it. */}
            <AppText variant="caption" muted>
              Only your devices can read your data.
            </AppText>
          </View>
        ) : null}
      </View>
      <ContentWidthContext value={Math.max(width - railWidth, 0)}>
        <View style={{ flex: 1 }}>
          {/* The sections are tabs without a tab bar of their own (the rail and the bottom bar
              above are the bar). That keeps every section that has been visited mounted, so
              coming back to Transactions finds its scroll position, search and month where they
              were, and the switch is a short cross-fade instead of a remount. */}
          <Tabs
            screenOptions={{
              headerShown: false,
              lazy: true,
              animation: fadeBetweenSections ? "fade" : "none",
              transitionSpec: {
                animation: "timing",
                config: { duration: SECTION_FADE_MS },
              },
              sceneStyle: { backgroundColor: theme.background },
            }}
            screenLayout={({ children }) => (
              <SectionVisibility>{children}</SectionVisibility>
            )}
            tabBar={(props) => (
              <TabPressPublisher {...props} bridgeRef={tabPressBridge} />
            )}
          >
            <Tabs.Screen name="overview" />
            <Tabs.Screen name="transactions" />
            <Tabs.Screen name="plan" />
            <Tabs.Screen name="more" />
          </Tabs>
        </View>
      </ContentWidthContext>
      <View
        accessibilityLabel={t("Primary")}
        role="navigation"
        style={[
          {
            display: mobile ? "flex" : "none",
            position: "absolute",
            left: theme.materialControls ? 0 : space.md + insets.left,
            right: theme.materialControls ? 0 : space.md + insets.right,
            bottom: theme.materialControls ? 0 : space.md + insets.bottom,
            minHeight: theme.materialControls ? 80 + insets.bottom : 64,
            borderRadius: theme.materialControls ? 0 : radius.sheet,
            borderCurve: "continuous",
            flexDirection: "row",
            alignItems: theme.materialControls ? "flex-start" : "center",
            paddingLeft: space.sm,
            paddingRight: space.sm,
            paddingTop: theme.materialControls ? 12 : space.xs,
            paddingBottom: theme.materialControls
              ? 16 + insets.bottom
              : space.xs,
          },
          theme.materialControls
            ? { backgroundColor: theme.navBackground }
            : materialStyle(theme, "raised"),
        ]}
      >
        {mobile ? (
          <NavigationBar
            mobile
            compact={false}
            narrow={narrow}
            pathname={pathname}
            onActivePress={pressActiveSection}
          />
        ) : null}
      </View>
    </View>
  );
}
