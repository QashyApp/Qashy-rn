import { renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

import { getFloatingBarVisibility } from "@/components/navigation/floating-bar-visibility";
import { AnimationLevelContext } from "@/components/ui/animation-level-context";
import { useScrollHide } from "@/components/ui/use-scroll-hide";
import type { AnimationLevel } from "@/domain/models";

// The hooks take their durations from the theme.
jest.mock("@/theme/theme", () => ({
  useQashyTheme: () => ({
    motion: jest.requireActual("@/theme/themes/classic").classicTheme.motion,
  }),
}));

// The bundled mock makes a new shared value on every render; the real one is stable, and the hooks
// under test depend on that. This keeps the rest of the mock and fixes only that.
jest.mock("react-native-reanimated", () => {
  const { useState } = jest.requireActual("react");
  const Reanimated = jest.requireActual("react-native-reanimated/mock");
  const mutable = (initial: unknown) => {
    let current = initial;
    return {
      get: () => current,
      set: (next: unknown) => {
        current =
          typeof next === "function"
            ? (next as (mockValue: unknown) => unknown)(current)
            : next;
      },
      get value() {
        return current;
      },
      set value(next: unknown) {
        current = next;
      },
    };
  };
  return {
    ...Reanimated,
    makeMutable: mutable,
    useSharedValue: (initial: unknown) => useState(() => mutable(initial))[0],
  };
});

const scroll = (
  y: number,
  contentHeight = 4000,
): NativeSyntheticEvent<NativeScrollEvent> =>
  ({
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 400, height: contentHeight },
      layoutMeasurement: { width: 400, height: 800 },
    },
  }) as NativeSyntheticEvent<NativeScrollEvent>;

function withLevel(level: AnimationLevel) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AnimationLevelContext value={level}>{children}</AnimationLevelContext>
    );
  };
}

describe("useScrollHide", () => {
  it("hides on a scroll down and shows again on a scroll up", async () => {
    const { result } = await renderHook(() => useScrollHide());
    const { onScroll, visibility } = result.current;
    for (const y of [20, 60, 100, 140, 180]) onScroll(scroll(y));
    expect(visibility.get()).toBe(0);
    expect(getFloatingBarVisibility().get()).toBe(0);
    for (const y of [170, 150, 130]) onScroll(scroll(y));
    expect(visibility.get()).toBe(1);
  });

  it("shows again on `show` and takes the next page's offset as its starting point", async () => {
    const { result } = await renderHook(() => useScrollHide());
    const { onScroll, show, visibility } = result.current;
    for (const y of [20, 60, 100, 140, 180]) onScroll(scroll(y));
    expect(visibility.get()).toBe(0);
    expect(getFloatingBarVisibility().get()).toBe(0);
    show();
    expect(visibility.get()).toBe(1);
    expect(getFloatingBarVisibility().get()).toBe(1);
    // Another month's page reports an offset far from the last page's: that is not a scroll down.
    onScroll(scroll(500));
    expect(visibility.get()).toBe(1);
    // Its own scrolling still hides it.
    for (const y of [540, 580, 620]) onScroll(scroll(y));
    expect(visibility.get()).toBe(0);
  });

  it("keeps the same onScroll across renders and a change of animation level", async () => {
    const { result, rerender } = await renderHook(() => useScrollHide(), {
      wrapper: withLevel("all"),
    });
    const first = result.current.onScroll;
    await rerender({});
    expect(result.current.onScroll).toBe(first);
    const off = await renderHook(() => useScrollHide(), {
      wrapper: withLevel("off"),
    });
    // And an instance whose level changes after mount keeps its own function too.
    const again = off.result.current.onScroll;
    await off.rerender({});
    expect(off.result.current.onScroll).toBe(again);
  });
});
