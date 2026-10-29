import { useEffect, useRef, useState } from "react";
import {
  ScrollView,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from "react-native";
import { GestureDetector } from "react-native-gesture-handler";

import { CalculatorHost } from "@/components/finance/calculator-host";
import { useSheetBody } from "@/components/navigation/sheet-body-context";
import { ScreenTransition } from "@/components/ui/motion";
import { useQashyTheme } from "@/theme/theme";

// Shared scroll container for form screens: taps on chips and buttons land on
// the first touch while the keyboard is open. Amount fields inside it use the calculator keypad, which
// rises over the whole screen (see `CalculatorHost`).
export function FormScreen({
  children,
  contentContainerStyle,
  maxWidth = 680,
  onScroll,
  scrollEnabled = true,
  ...props
}: ScrollViewProps & { maxWidth?: number }) {
  const theme = useQashyTheme();
  // In the Android sheet the body can be dragged too, so the sheet needs this scroll view's offset
  // and a gesture to run beside it (null everywhere else).
  const sheetBody = useSheetBody();
  const registerWithSheet = sheetBody?.register;
  const reportOffset = sheetBody?.reportOffset;
  // The scroll view's real offset, so a (re-)registration can hand it to the sheet: unregistering
  // forgets the offset on the sheet's side while the scroll view keeps it.
  const offsetY = useRef(0);
  useEffect(() => {
    if (!registerWithSheet) return;
    const unregister = registerWithSheet();
    reportOffset?.(offsetY.current);
    return unregister;
  }, [registerWithSheet, reportOffset]);
  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offsetY.current = event.nativeEvent.contentOffset.y;
    reportOffset?.(offsetY.current);
    onScroll?.(event);
  };
  // A sheet starts sliding in only once everything in it has mounted, so a long form held
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
  const scrollView = (
    <ScrollView
      onScroll={handleScroll}
      scrollEventThrottle={16}
      scrollEnabled={scrollEnabled && (sheetBody?.scrollEnabled ?? true)}
      keyboardShouldPersistTaps="handled"
      // Dragging the content puts the system keyboard away (the amount keypad is not one: it is a
      // layer over the whole screen, so the form cannot be dragged while it is open).
      keyboardDismissMode="on-drag"
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
  );
  const scroll = (
    <ScreenTransition style={{ flex: 1 }}>
      {sheetBody ? (
        <GestureDetector gesture={sheetBody.scrollGesture}>
          {scrollView}
        </GestureDetector>
      ) : (
        scrollView
      )}
    </ScreenTransition>
  );
  const hosted = <CalculatorHost>{scroll}</CalculatorHost>;
  if (process.env.EXPO_OS === "web") return hosted;
  return <View style={{ flex: 1 }}>{hosted}</View>;
}
