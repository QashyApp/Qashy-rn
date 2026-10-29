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
import { useTabLongPress } from "@/components/navigation/use-tab-long-press";
import { useMotionPreference } from "@/components/ui/motion";
import { useLocalization } from "@/localization/localization";
import { useFinanceSettings } from "@/providers/finance-provider";
import { hapticSelection } from "@/services/haptics";
import {
  BottomBarClearanceContext,
  floatingBarClearance,
} from "@/theme/layout";
import { useQashyTheme } from "@/theme/theme";
import { withAlpha } from "@/theme/tokens";

const IS_ANDROID = process.env.EXPO_OS === "android";

/**
 * Web always uses the web navigation. Android chooses between the platform
 * `BottomNavigationView` ("native") and a JS floating pill ("floating") from the device-local
 * `navBarStyle` setting. Swapping navigators remounts the tab stacks, so the user's section is restored.
 */
export default function TabsLayout() {
  const settings = useFinanceSettings();
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
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    // `pathname` right away, which would re-run the effect and drop the restore. The pending timer is
    // instead cleared when a newer one replaces it and when the layout unmounts.
    if (restoreTimer.current !== null) clearTimeout(restoreTimer.current);
    restoreTimer.current = setTimeout(() => {
      restoreTimer.current = null;
      if (sectionOfPathname(currentPathname.current) !== section) {
        router.replace(`/${section}` as Href);
      }
    }, 0);
  }, [floating, pathname, router]);
  useEffect(
    () => () => {
      if (restoreTimer.current !== null) clearTimeout(restoreTimer.current);
    },
    [],
  );
}

function FloatingTabsLayout() {
  const { t } = useLocalization();
  const { space, motion, background } = useQashyTheme();
  const insets = useSafeAreaInsets();
  const { open } = useNavBarStyleSheet();
  // The indicator in the bar glides over `motion.duration.base`; the sections cross-fade over the
  // same time so content does not hard-cut under it. `instant` folds the in-app Animations level
  // (Off) and the system's reduce-motion setting; at Minimal a fade is the whole motion anyway.
  const { instant } = useMotionPreference();
  return (
    <BottomBarClearanceContext
      value={floatingBarClearance(insets.bottom, space.md)}
    >
      <Tabs
        // The bar floats over the screens, so they keep their full height. Each section stack shows
        // its own native header, hence no header here. Tabs are lazy (the navigator's default), so
        // a section still mounts on its first visit; the fade only runs between mounted ones.
        screenOptions={{
          headerShown: false,
          animation: instant ? "none" : "fade",
          transitionSpec: {
            animation: "timing",
            config: { duration: motion.duration.base },
          },
          // Opaque scenes, so the window behind never shows through mid-fade.
          sceneStyle: { backgroundColor: background },
        }}
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
  // Android-only (a no-op elsewhere). The bar is Android's own, so the press comes from the local
  // `qashy-tab-gestures` module rather than from a React prop; the bar shows no tooltip for it.
  useTabLongPress(open);
  // No SafeAreaView here. Each section stack now shows a native header, and the
  // platform header applies the top inset itself; padding the tab host as well
  // would push every screen down by a second status bar's worth.
  return (
    <NativeTabs
      // Emitted before navigation, so `isFocused()` still reports the tab being left: a press on the
      // tab that is already open (or one the native bar refused) gets no haptic, like the floating bar.
      screenListeners={({ navigation }) => ({
        tabPress: (event) => {
          if (event.data?.isPrevented) return;
          if (!navigation.isFocused()) hapticSelection();
        },
      })}
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
    >
      <NativeTabs.Trigger name="overview">
        <NativeTabs.Trigger.Label>{t("Overview")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="transactions">
        <NativeTabs.Trigger.Label>{t("Transactions")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon md="receipt_long" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="plan">
        <NativeTabs.Trigger.Label>{t("Plan")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon md="donut_large" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more" role="more">
        <NativeTabs.Trigger.Label>{t("More")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon md="more_horiz" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
