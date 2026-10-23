import { useIsFocused } from "expo-router";
import { type BottomTabBarProps } from "expo-router/tabs";
import { useEffect, useState, type ReactElement } from "react";
import { View } from "react-native";

/** Long enough to read as a fade, short enough that it never makes a section feel slow to open. */
export const SECTION_FADE_MS = 250;

/**
 * A section that has been left stays mounted (that is the point), but once its fade-out is over
 * it is removed from layout, so it cannot be tabbed into, read by a screen reader or matched by
 * a query for what is on screen.
 */
export function SectionVisibility({ children }: { children: ReactElement }) {
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

/**
 * What the section tabs hand back to the layout around them. The sidebar and the bottom bar are
 * drawn by the layout, outside the tab navigator, so they cannot emit navigator events themselves;
 * the invisible tab bar below publishes this instead.
 */
export interface TabPressBridge {
  /** Emits `tabPress` for the section, as a tab bar does; screens' `useScrollToTop` listens for it. */
  press: (section: string) => void;
}

/** Renders nothing. Exists only to expose the navigator's `emitter` to the layout. */
export function TabPressPublisher({
  state,
  emitter,
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
        emitter.emit({
          type: "tabPress",
          target: route.key,
          canPreventDefault: true,
        });
      },
    };
    return () => {
      bridgeRef.current = null;
    };
  }, [bridgeRef, emitter, state.routes]);
  return null;
}
