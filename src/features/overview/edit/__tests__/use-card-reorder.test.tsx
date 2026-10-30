import { renderHook } from "@testing-library/react-native";

import type { OverviewCard } from "@/domain/overview-layout";
import { useCardReorder } from "@/features/overview/edit/use-card-reorder";

const registered: unknown[] = [];

jest.mock("react-native-reanimated", () => {
  const Reanimated = jest.requireActual("react-native-reanimated/mock");
  const { useRef } = jest.requireActual("react");
  Reanimated.default.call = () => {};
  Reanimated.useReducedMotion = () => false;
  // Real shared values persist across renders; the mock's build a new one each time.
  const mockSharedValue = Reanimated.useSharedValue;
  Reanimated.useSharedValue = (initial: unknown) => {
    const ref = useRef(null);
    if (ref.current === null) ref.current = mockSharedValue(initial);
    return ref.current;
  };
  Reanimated.useAnimatedRef = () => {
    const ref = useRef(null);
    if (ref.current === null)
      ref.current = Object.assign(() => null, { current: null });
    return ref.current;
  };
  Reanimated.useFrameCallback = (callback: unknown) => {
    registered.push(callback);
    return { setActive: () => {}, isActive: false, callbackId: 0 };
  };
  Reanimated.scrollTo = () => {};
  return Reanimated;
});

const CARDS: readonly OverviewCard[] = ["a", "b"].map((id) => ({
  id,
  type: "accounts",
  size: "regular",
  config: {},
}));

describe("useCardReorder", () => {
  it("hands the UI thread one frame callback for its whole life", async () => {
    // `useFrameCallback` unregisters and re-registers whenever the callback changes, restarting
    // the frame loop. A new worklet per render would do that on every render, including the one
    // that starts a drag, so the callback must keep its identity.
    registered.length = 0;
    const { rerender } = await renderHook(
      (props: { cards: readonly OverviewCard[] }) =>
        useCardReorder({ cards: props.cards, gap: 16 }),
      { initialProps: { cards: CARDS } },
    );
    await rerender({ cards: [...CARDS].reverse() });
    await rerender({ cards: CARDS });
    expect(registered.length).toBeGreaterThan(1);
    expect(new Set(registered).size).toBe(1);
  });
});
