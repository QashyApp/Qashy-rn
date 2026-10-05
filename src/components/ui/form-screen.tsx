import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  ScrollView,
  type ScrollViewProps,
} from "react-native";

import { CalculatorHost } from "@/components/finance/calculator-host";
import { ScreenTransition } from "@/components/ui/motion";
import { useQashyTheme } from "@/theme/theme";

// Shared scroll container for form screens: taps on chips and buttons land on
// the first touch while the keyboard is open, and iOS keeps the focused field
// above the keyboard. Amount fields inside it use the calculator keypad, which
// rises over the whole screen (see `CalculatorHost`).
export function FormScreen({
  children,
  contentContainerStyle,
  maxWidth = 680,
  onScroll,
  ...props
}: ScrollViewProps & { maxWidth?: number }) {
  const theme = useQashyTheme();
  // A native sheet starts sliding in only once everything in it has mounted, so a long form held
  // the slide back by however long the whole form took to build (Android's own sheet starts at
  // once, but a form that builds mid-spring drops frames from it). The form now mounts a frame
  // after its sheet: the slide starts on the tap, and the form is in place well before the sheet
  // has risen far enough to show it. The sheet's height comes from its detents, not its content,
  // so nothing resizes when the form arrives.
  const [bodyMounted, setBodyMounted] = useState(process.env.EXPO_OS === "web");
  useEffect(() => {
    if (bodyMounted) return;
    const frame = requestAnimationFrame(() => setBodyMounted(true));
    return () => cancelAnimationFrame(frame);
  }, [bodyMounted]);
  const scroll = (
    <ScreenTransition style={{ flex: 1 }}>
      <ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
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
        {bodyMounted ? children : null}
      </ScrollView>
    </ScreenTransition>
  );
  const hosted = <CalculatorHost>{scroll}</CalculatorHost>;
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
