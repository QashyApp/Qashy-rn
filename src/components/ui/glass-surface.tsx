import { BlurView } from "expo-blur";
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "expo-glass-effect";
import { useEffect, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Platform,
  View,
  type ViewStyle,
} from "react-native";

import { useQashyTheme } from "@/theme/theme";

/**
 * Whether a blurred backdrop will actually render here. When it will not, the surface falls back to
 * the theme's opaque surface instead of drawing a view with no backdrop behind it.
 *
 * - Web: `backdrop-filter` must be supported (`-webkit-` form included for older Safari). Browsers
 *   without `CSS.supports` are treated as unsupported.
 * - Android: the blur relies on RenderEffect, which needs Android 12 (API 31).
 */
function blurIsReliable(): boolean {
  if (process.env.EXPO_OS === "web") {
    if (typeof CSS === "undefined" || typeof CSS.supports !== "function")
      return false;
    return (
      CSS.supports("backdrop-filter", "blur(1px)") ||
      CSS.supports("-webkit-backdrop-filter", "blur(1px)")
    );
  }
  if (process.env.EXPO_OS === "android") return Number(Platform.Version) >= 31;
  return true;
}

export function GlassSurface({
  children,
  style,
  interactive = false,
}: {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
  interactive?: boolean;
}) {
  const theme = useQashyTheme();
  const [reduceTransparency, setReduceTransparency] = useState(() =>
    process.env.EXPO_OS === "web" && typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-transparency: reduce)").matches
      : false,
  );

  useEffect(() => {
    if (typeof AccessibilityInfo.isReduceTransparencyEnabled === "function") {
      AccessibilityInfo.isReduceTransparencyEnabled().then(
        setReduceTransparency,
      );
      const subscription = AccessibilityInfo.addEventListener(
        "reduceTransparencyChanged",
        setReduceTransparency,
      );
      return () => subscription.remove();
    }
    if (process.env.EXPO_OS === "web" && typeof window !== "undefined") {
      const media = window.matchMedia("(prefers-reduced-transparency: reduce)");
      const update = (event: MediaQueryListEvent) =>
        setReduceTransparency(event.matches);
      media.addEventListener?.("change", update);
      return () => media.removeEventListener?.("change", update);
    }
    return undefined;
  }, []);

  if (
    process.env.EXPO_OS === "ios" &&
    !reduceTransparency &&
    isGlassEffectAPIAvailable() &&
    isLiquidGlassAvailable()
  ) {
    return (
      <GlassView
        isInteractive={interactive}
        tintColor={theme.staticAccent}
        colorScheme={theme.mode}
        style={style}
      >
        {children}
      </GlassView>
    );
  }
  if (!reduceTransparency && blurIsReliable()) {
    return (
      <BlurView
        tint={theme.glassTint}
        intensity={72}
        style={[{ overflow: "hidden" }, style]}
      >
        {children}
      </BlurView>
    );
  }
  return (
    <View style={[{ backgroundColor: theme.surfaceElevated }, style]}>
      {children}
    </View>
  );
}
