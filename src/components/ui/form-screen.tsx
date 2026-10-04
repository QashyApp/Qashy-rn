import { useRef } from "react";
import {
  KeyboardAvoidingView,
  ScrollView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from "react-native";

import { CalculatorHost } from "@/components/finance/calculator-host";
import { ScreenTransition } from "@/components/ui/motion";
import { useQashyTheme } from "@/theme/theme";

// Shared scroll container for form screens: taps on chips and buttons land on
// the first touch while the keyboard is open, and iOS keeps the focused field
// above the keyboard. Amount fields inside it use the calculator keypad, which
// the screen lays out beneath the scroll view (see `CalculatorHost`).
export function FormScreen({
  children,
  contentContainerStyle,
  maxWidth = 680,
  onScroll,
  ...props
}: ScrollViewProps & { maxWidth?: number }) {
  const theme = useQashyTheme();
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffset = useRef(0);
  const trackScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffset.current = event.nativeEvent.contentOffset.y;
    onScroll?.(event);
  };
  const scroll = (
    <ScreenTransition style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        onScroll={trackScroll}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        // Android-only: without it, this ScrollView never registers as a nested
        // scrolling child, so the form sheet's own BottomSheetBehavior treats
        // every scroll drag as its own — collapsing or dismissing the sheet
        // instead of scrolling the content, even on an untouched form.
        nestedScrollEnabled
        style={{ flex: 1, backgroundColor: theme.background }}
        contentContainerStyle={[
          {
            padding: 18,
            paddingBottom: 44,
            gap: 18,
            width: "100%",
            maxWidth,
            alignSelf: "center",
          },
          contentContainerStyle,
        ]}
        {...props}
      >
        {children}
      </ScrollView>
    </ScreenTransition>
  );
  const hosted = (
    <CalculatorHost scrollRef={scrollRef} scrollOffset={scrollOffset}>
      {scroll}
    </CalculatorHost>
  );
  if (process.env.EXPO_OS === "web") return hosted;
  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
      style={{ flex: 1 }}
    >
      {hosted}
    </KeyboardAvoidingView>
  );
}
