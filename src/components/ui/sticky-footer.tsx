import type { ReactNode } from "react";
import { KeyboardAvoidingView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useQashyTheme } from "@/theme/theme";

/**
 * Lays out a scrolling body with an action bar pinned under it.
 *
 * The primary action of a step-by-step flow must never scroll out of reach,
 * and on a phone the keyboard is what usually pushes it there. The whole
 * column rides the keyboard on iOS; Android's `adjustResize` window already
 * shrinks it, so only the padding for the home indicator is added there.
 */
export function StickyFooterLayout({
  children,
  footer,
  maxWidth = 560,
}: {
  children: ReactNode;
  footer: ReactNode;
  maxWidth?: number;
}) {
  const { space } = useQashyTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
      style={{ flex: 1 }}
    >
      <View style={{ flex: 1 }}>{children}</View>
      <View
        style={{
          width: "100%",
          maxWidth,
          alignSelf: "center",
          paddingHorizontal: space.xxl,
          paddingTop: space.md,
          paddingBottom: Math.max(insets.bottom, space.lg) + space.sm,
          gap: space.sm,
        }}
      >
        {footer}
      </View>
    </KeyboardAvoidingView>
  );
}
