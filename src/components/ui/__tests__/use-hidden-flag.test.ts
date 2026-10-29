import { renderHook } from "@testing-library/react-native";
import type { SharedValue } from "react-native-reanimated";

import { useHiddenFlag } from "@/components/ui/use-hidden-flag";

// The global Reanimated mock makes `useAnimatedReaction` a no-op. This one runs the reaction after
// every render, the way a UI-thread frame would, with `previous` null the first time.
jest.mock("react-native-reanimated", () => {
  const { useEffect: effect, useRef: ref } = jest.requireActual("react");
  const Reanimated = jest.requireActual("react-native-reanimated/mock");
  return {
    ...Reanimated,
    runOnJS: <T>(fn: T) => fn,
    useAnimatedReaction: <T>(
      prepare: () => T,
      react: (next: T, previous: T | null) => void,
    ) => {
      const previous = ref(null as T | null);
      effect(() => {
        const next = prepare();
        react(next, previous.current);
        previous.current = next;
      });
    },
  };
});

function shared(initial: number) {
  let value = initial;
  const get = jest.fn(() => value);
  return {
    get,
    set: (next: number) => {
      value = next;
    },
  } as unknown as SharedValue<number> & { set: (next: number) => void };
}

describe("useHiddenFlag", () => {
  it("does not read the shared value while rendering", async () => {
    const visibility = shared(0);
    const seen: boolean[] = [];
    const { result } = await renderHook(() => {
      const hidden = useHiddenFlag(visibility);
      seen.push(hidden);
      return hidden;
    });
    // The first render could not know; the reaction then flips it.
    expect(seen[0]).toBe(false);
    expect(result.current).toBe(true);
  });

  it("follows the value across the threshold, once per crossing", async () => {
    const visibility = shared(1);
    const { result, rerender } = await renderHook(() =>
      useHiddenFlag(visibility, 0.5),
    );
    expect(result.current).toBe(false);
    visibility.set(0.6);
    await rerender({});
    expect(result.current).toBe(false);
    visibility.set(0.4);
    await rerender({});
    expect(result.current).toBe(true);
    visibility.set(0);
    await rerender({});
    expect(result.current).toBe(true);
    visibility.set(1);
    await rerender({});
    expect(result.current).toBe(false);
  });

  it("is never hidden without a value to follow", async () => {
    const { result } = await renderHook(() => useHiddenFlag(undefined));
    expect(result.current).toBe(false);
  });
});
