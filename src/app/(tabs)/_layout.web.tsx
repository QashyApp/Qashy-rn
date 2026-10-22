import { usePathname } from "expo-router";
import { Tabs } from "expo-router/tabs";
import { useCallback, useRef } from "react";
import { View, useWindowDimensions } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NavigationBar } from "@/components/navigation/web-navigation";
import { RAIL_GUTTER } from "@/components/navigation/web-navigation-item";
import {
  SECTION_FADE_MS,
  SectionVisibility,
  TabPressPublisher,
  type TabPressBridge,
} from "@/components/navigation/web-tab-sections";
import { useAnimationLevel } from "@/components/ui/animation-level-context";
import { AppText } from "@/components/ui/app-text";
import { useLocalization } from "@/localization/localization";
import { materialStyle } from "@/theme/materials";
import {
  ContentWidthContext,
  NAV_RAIL_BREAKPOINT,
  NAV_SIDEBAR_BREAKPOINT,
  navigationRailWidth,
} from "@/theme/layout";
import { useQashyTheme } from "@/theme/theme";

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
