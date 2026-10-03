import { usePathname, useRouter, type Href } from "expo-router";
import { Tabs } from "expo-router/tabs";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useEffect, useRef } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FloatingTabBar } from "@/components/navigation/floating-tab-bar";
import { useNavBarStyleSheet } from "@/components/navigation/nav-bar-style-sheet-context";
import {
  sectionOfPathname,
  type TabSection,
} from "@/components/navigation/tab-sections";
import { useLocalization } from "@/localization/localization";
import { useFinanceState } from "@/providers/finance-provider";
import {
  BottomBarClearanceContext,
  floatingBarClearance,
} from "@/theme/layout";
import { useQashyTheme } from "@/theme/theme";
import { withAlpha } from "@/theme/tokens";

const IS_ANDROID = process.env.EXPO_OS === "android";

/**
 * iOS and web always use the native/web navigation. Android chooses between the platform
 * `BottomNavigationView` ("native") and a JS floating pill ("floating") from the device-local
 * `navBarStyle` setting. Swapping navigators remounts the tab stacks, so the user's section is restored.
 */
export default function TabsLayout() {
  const { settings } = useFinanceState();
  const floating = IS_ANDROID && settings.navBarStyle === "floating";
  useRestoreSectionOnSwitch(floating);
  return floating ? <FloatingTabsLayout /> : <NativeTabsLayout />;
}

function useRestoreSectionOnSwitch(floating: boolean) {
  const pathname = usePathname();
  const router = useRouter();
  const previousFloating = useRef(floating);
  const lastSection = useRef(sectionOfPathname(pathname));
  const currentPathname = useRef(pathname);
  // Set when the style flips while a screen outside the tabs (/appearance) is on top: the new navigator
  // mounts underneath on its default route, so the section is restored once the user comes back.
  const pendingSection = useRef<TabSection | null>(null);

  useEffect(() => {
    currentPathname.current = pathname;
    if (previousFloating.current === floating) {
      const current = sectionOfPathname(pathname);
      const pending = pendingSection.current;
      if (pending && current !== null) {
        pendingSection.current = null;
        if (current !== pending) {
          router.replace(`/${pending}` as Href);
          return;
        }
      }
      // Only remember sections while the style is unchanged: the render that flips it may already
      // carry the new navigator's default route.
      lastSection.current = current ?? lastSection.current;
      return;
    }
    previousFloating.current = floating;
    const section = lastSection.current;
    if (!section) return;
    if (sectionOfPathname(pathname) === null) {
      pendingSection.current = section;
      return;
    }
    // Only if the new navigator did not already land on the same section.
    // Deliberately not cancelled by this effect's cleanup: the new navigator's own initial route changes
    // `pathname` right away, which would re-run the effect and drop the restore.
    setTimeout(() => {
      if (sectionOfPathname(currentPathname.current) !== section) {
        router.replace(`/${section}` as Href);
      }
    }, 0);
  }, [floating, pathname, router]);
}

function FloatingTabsLayout() {
  const { t } = useLocalization();
  const { space } = useQashyTheme();
  const insets = useSafeAreaInsets();
  const { open } = useNavBarStyleSheet();
  return (
    <BottomBarClearanceContext
      value={floatingBarClearance(insets.bottom, space.md)}
    >
      <Tabs
        // The bar floats over the screens, so they keep their full height. Each section stack shows
        // its own native header, hence no header here.
        screenOptions={{ headerShown: false }}
        tabBar={(props) => <FloatingTabBar {...props} onLongPress={open} />}
      >
        <Tabs.Screen name="overview" options={{ title: t("Overview") }} />
        <Tabs.Screen
          name="transactions"
          options={{ title: t("Transactions") }}
        />
        <Tabs.Screen name="plan" options={{ title: t("Plan") }} />
        <Tabs.Screen name="more" options={{ title: t("More") }} />
      </Tabs>
    </BottomBarClearanceContext>
  );
}

function NativeTabsLayout() {
  const theme = useQashyTheme();
  const { t } = useLocalization();
  const { open } = useNavBarStyleSheet();
  // No SafeAreaView here. Each section stack now shows a native header, and the
  // platform header applies the top inset itself; padding the tab host as well
  // would push every screen down by a second status bar's worth.
  return (
    <NativeTabs
      tintColor={theme.accent}
      backgroundColor={theme.navBackground}
      iconColor={{ default: theme.textMuted, selected: theme.accent }}
      labelStyle={{
        default: { color: theme.textMuted },
        selected: { color: theme.accent },
      }}
      indicatorColor={theme.accentContainer}
      // `accentContainer` is a fully opaque fill, right for the resting selected
      // pill. Android's ripple draws its color at full alpha too, so reusing it
      // here painted a solid gray disc over the icon on tap instead of a subtle
      // press overlay — a translucent tint of the real accent hex reads correctly.
      rippleColor={withAlpha(theme.staticAccent, 0.12)}
      // iOS-only: the hairline the system draws above the bar when content
      // scrolls under it. The theme's own border tone keeps it as restrained
      // as every other divider, instead of the system default.
      shadowColor={theme.border}
      minimizeBehavior="onScrollDown"
      // Android-only. `onTabLongPress` exists only in the patched react-native-screens (see
      // patches/ and "Native patches" in the README); the bar itself shows no tooltip for it.
      unstable_nativeProps={IS_ANDROID ? { onTabLongPress: open } : undefined}
    >
      <NativeTabs.Trigger name="overview">
        <NativeTabs.Trigger.Label>{t("Overview")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "house", selected: "house.fill" }}
          md="home"
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="transactions">
        <NativeTabs.Trigger.Label>{t("Transactions")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{
            default: "list.bullet.rectangle",
            selected: "list.bullet.rectangle.fill",
          }}
          md="receipt_long"
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="plan">
        <NativeTabs.Trigger.Label>{t("Plan")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: "chart.pie", selected: "chart.pie.fill" }}
          md="donut_large"
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more" role="more">
        <NativeTabs.Trigger.Label>{t("More")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="ellipsis.circle" md="more_horiz" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
