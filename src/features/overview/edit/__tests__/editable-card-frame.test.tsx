import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { useLayoutEffect, type ReactElement } from "react";
import { AccessibilityInfo, StyleSheet, Text } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  createGestureController,
  getByGestureTestId,
} from "react-native-gesture-handler/jest-utils";

import type { OverviewCard } from "@/domain/overview-layout";
import { EditableCardFrame } from "@/features/overview/edit/editable-card-frame";
import {
  useCardReorder,
  type CardReorder,
} from "@/features/overview/edit/use-card-reorder";
import { hapticImpactLight, hapticSuccess } from "@/services/haptics";

// Gesture handler v3's `GestureDetector` insists on a `GestureHandlerRootView` ancestor at
// runtime; the app root provides one, so the drag-handle tests mount inside the same shell.
const renderFrame = (frame: ReactElement) =>
  render(
    <GestureHandlerRootView style={{ flex: 1 }}>
      {frame}
    </GestureHandlerRootView>,
  );

// The Reanimated mock builds a fresh shared value on every render, so a gesture that re-renders
// the frame (it lifts) would lose what it wrote. Real shared values persist; make the mock's do.
jest.mock("react-native-reanimated", () => {
  const Reanimated = jest.requireActual("react-native-reanimated/mock");
  const { useRef } = jest.requireActual("react");
  Reanimated.default.call = () => {};
  Reanimated.useReducedMotion = () => false;
  const mockSharedValue = Reanimated.useSharedValue;
  Reanimated.useSharedValue = (initial: unknown) => {
    const ref = useRef(null);
    if (ref.current === null) ref.current = mockSharedValue(initial);
    return ref.current;
  };
  return Reanimated;
});

// A minimal stand-in theme: only the tokens `materialStyle`/`AppText`/`IconButton` actually
// read for the materials this frame uses (`raised`, `sunken` is not used here).
jest.mock("@/theme/theme", () => ({
  useQashyTheme: () => ({
    // The real classic scales: components destructure `space`/`radius` from the theme.
    ...(({ space, radius, tile, iconSize, motion, type }) => ({
      space,
      radius,
      tile,
      iconSize,
      motion,
      type,
    }))(jest.requireActual("@/theme/themes/classic").classicTheme),
    text: "#111111",
    textMuted: "#666666",
    surface: "#ffffff",
    surfaceMuted: "#eeeeee",
    accent: "#4040ff",
    onAccent: "#ffffff",
    shadowRaised: "none",
    shadowCard: "none",
    shadowOverlay: "none",
    shadowControl: "none",
    shadowControlPressed: "none",
    surfaceGradient: undefined,
  }),
}));

jest.mock("@/localization/localization", () => ({
  useLocalization: () => ({
    t: (message: string) => message,
    isRtl: false,
    language: "en",
    locale: "en-US",
  }),
}));

jest.mock("@/services/haptics", () => ({
  hapticSelection: jest.fn(),
  hapticImpactLight: jest.fn(),
  hapticSuccess: jest.fn(),
}));

const CARDS: readonly OverviewCard[] = ["a", "b", "c"].map((id) => ({
  id,
  type: "accounts",
  size: "regular",
  config: {},
}));

// Hands the shared reorder state to the test so it can stand in for the UI-thread reaction
// (which the Reanimated mock does not run) and inspect what a drag wrote.
let reorderForTest: CardReorder | undefined;
const capture = (reorder: CardReorder) => {
  reorderForTest = reorder;
};

function Frame({
  index = 1,
  onDrop,
  ...rest
}: Partial<Parameters<typeof EditableCardFrame>[0]> & {
  onDrop?: (id: string, toIndex: number) => Promise<unknown> | null;
}) {
  const { reorder } = useCardReorder({
    cards: CARDS,
    gap: 16,
  });
  useLayoutEffect(() => {
    capture(reorder);
  });
  return (
    <EditableCardFrame
      id="b"
      title="Budget pulse"
      index={index}
      total={3}
      sizes={["compact", "regular", "wide"]}
      showSizeControl
      hasConfigSheet={false}
      configOpen={false}
      onMoveUp={jest.fn()}
      onMoveDown={jest.fn()}
      onCycleSize={jest.fn()}
      onRemove={jest.fn()}
      reorder={reorder}
      onDrop={onDrop}
      {...rest}
    >
      <Text>Card content</Text>
    </EditableCardFrame>
  );
}

describe("EditableCardFrame", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the toolbar with accessible labels for each action", async () => {
    await renderFrame(<Frame />);

    expect(screen.getByLabelText("Move Budget pulse up")).toBeTruthy();
    expect(screen.getByLabelText("Move Budget pulse down")).toBeTruthy();
    expect(screen.getByLabelText("Change Budget pulse size")).toBeTruthy();
    expect(screen.getByLabelText("Remove Budget pulse")).toBeTruthy();
  });

  it('disables "move up" at the first position', async () => {
    await renderFrame(<Frame index={0} />);

    const moveUp = screen.getByLabelText("Move Budget pulse up");
    expect(moveUp.props.accessibilityState?.disabled).toBe(true);
  });

  it('disables "move down" at the last position', async () => {
    await renderFrame(<Frame index={2} />);

    const moveDown = screen.getByLabelText("Move Budget pulse down");
    expect(moveDown.props.accessibilityState?.disabled).toBe(true);
  });

  it("calls onRemove when the remove button is pressed", async () => {
    const onRemove = jest.fn();
    await renderFrame(<Frame onRemove={onRemove} />);

    await fireEvent.press(screen.getByLabelText("Remove Budget pulse"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("does not show a size control when the widget only has one size", async () => {
    await renderFrame(
      <Frame sizes={["regular"] as const} showSizeControl={false} />,
    );

    expect(screen.queryByLabelText("Change Budget pulse size")).toBeNull();
  });

  it("gives the drag grip a 44px touch target", async () => {
    await renderFrame(<Frame />);

    const grip = StyleSheet.flatten(
      screen.getByLabelText("Drag to reorder Budget pulse").props.style,
    );
    expect(grip.minWidth).toBeGreaterThanOrEqual(44);
    expect(grip.minHeight).toBeGreaterThanOrEqual(44);
  });

  describe("accessibility", () => {
    it("puts the role and the move/remove actions on the labelled grip", async () => {
      await renderFrame(<Frame />);

      const grip = screen.getByLabelText("Drag to reorder Budget pulse");
      expect(grip.props.accessibilityRole).toBe("button");
      expect(grip.props.accessible).toBe(true);
      expect(
        grip.props.accessibilityActions.map((a: { name: string }) => a.name),
      ).toEqual(["moveUp", "moveDown", "remove"]);
    });

    it("runs the grip's actions", async () => {
      const onMoveUp = jest.fn();
      const onMoveDown = jest.fn();
      const onRemove = jest.fn();
      await renderFrame(
        <Frame
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onRemove={onRemove}
        />,
      );
      const grip = screen.getByLabelText("Drag to reorder Budget pulse");

      for (const actionName of ["moveUp", "moveDown", "remove"]) {
        await fireEvent(grip, "accessibilityAction", {
          nativeEvent: { actionName },
        });
      }
      expect(onMoveUp).toHaveBeenCalledTimes(1);
      expect(onMoveDown).toHaveBeenCalledTimes(1);
      expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it("moves focus to the grip after a toolbar button moved the card", async () => {
      const sendEvent = jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent");
      const view = await renderFrame(<Frame index={1} />);
      await fireEvent.press(screen.getByLabelText("Move Budget pulse up"));
      // The card is now first in the stack.
      await view.rerender(
        <GestureHandlerRootView style={{ flex: 1 }}>
          <Frame index={0} />
        </GestureHandlerRootView>,
      );
      expect(sendEvent).toHaveBeenCalledWith(expect.anything(), "focus");
      sendEvent.mockRestore();
    });

    it("leaves focus alone when the grip's own action moved the card", async () => {
      const sendEvent = jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent");
      const view = await renderFrame(<Frame index={1} />);
      await fireEvent(
        screen.getByLabelText("Drag to reorder Budget pulse"),
        "accessibilityAction",
        { nativeEvent: { actionName: "moveUp" } },
      );
      await view.rerender(
        <GestureHandlerRootView style={{ flex: 1 }}>
          <Frame index={0} />
        </GestureHandlerRootView>,
      );
      expect(sendEvent).not.toHaveBeenCalled();
      sendEvent.mockRestore();
    });
  });

  describe("dragging", () => {
    const controller = () =>
      createGestureController(getByGestureTestId("overview-card-drag-b"));

    it("lifts with a light tap and commits the live target on release", async () => {
      const onDrop = jest.fn(() => Promise.resolve(true));
      await renderFrame(<Frame onDrop={onDrop} />);
      const drag = controller();

      await act(async () => {
        drag.begin();
        drag.activate();
        drag.update({ translationY: 160 });
      });
      expect(hapticImpactLight).toHaveBeenCalledTimes(1);
      expect(reorderForTest?.source.get()).toBe(1);

      // On device the UI-thread reaction publishes the target as the card crosses slots.
      reorderForTest?.target.set(2);
      await act(async () => {
        drag.end();
      });

      expect(onDrop).toHaveBeenCalledWith("b", 2);
      expect(hapticSuccess).toHaveBeenCalledTimes(1);
      expect(reorderForTest?.source.get()).toBe(-1);
      expect(reorderForTest?.target.get()).toBe(-1);
    });

    it("resolves the landing slot from the release, not a stale published target", async () => {
      const onDrop = jest.fn(() => Promise.resolve(true));
      await renderFrame(<Frame onDrop={onDrop} />);
      const drag = controller();
      // Three cards of 100 with a gap of 16: card b's centre is 166, the others' 50 and 282.
      await act(async () => {
        for (const id of ["a", "b", "c"])
          reorderForTest?.setCardHeight(id, 100);
      });

      await act(async () => {
        drag.begin();
        drag.activate();
        drag.update({ translationY: 10 });
      });
      // The reaction has not caught up with the finger's last, fast move: still on slot 1.
      expect(reorderForTest?.target.get()).toBe(1);
      await act(async () => {
        drag.end({ translationY: 200 });
      });

      expect(onDrop).toHaveBeenCalledWith("b", 2);
    });

    it("does not reorder when released over its own slot", async () => {
      const onDrop = jest.fn(() => Promise.resolve(true));
      await renderFrame(<Frame onDrop={onDrop} />);
      const drag = controller();

      await act(async () => {
        drag.begin();
        drag.activate();
        drag.end();
      });

      expect(onDrop).not.toHaveBeenCalled();
      expect(hapticSuccess).not.toHaveBeenCalled();
    });

    // The wrapper that carries the z-order: lifted above its neighbours while held.
    const zIndexAbove = () => {
      let node = screen.getByText("Card content", {
        includeHiddenElements: true,
      }).parent;
      while (node) {
        const z = StyleSheet.flatten(node.props.style)?.zIndex;
        if (z !== undefined) return z;
        node = node.parent;
      }
      return undefined;
    };

    it("lets go of the card when the drop settles and its slot never moved", async () => {
      let resolveSave: (saved: boolean) => void = () => {};
      const onDrop = jest.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveSave = resolve;
          }),
      );
      await renderFrame(<Frame onDrop={onDrop} />);
      const drag = controller();

      await act(async () => {
        drag.begin();
        drag.activate();
        drag.update({ translationY: 160 });
      });
      reorderForTest?.target.set(2);
      await act(async () => {
        drag.end();
      });
      // The save is still running and the slot has not moved: held where it was dropped.
      expect(zIndexAbove()).toBe(10);

      // The save failed, so the order never changed and `index` stays 1.
      await act(async () => {
        resolveSave(false);
      });
      expect(zIndexAbove()).toBe(0);
    });

    it("does not let an earlier drop's outcome release a later drag", async () => {
      const saves: ((saved: boolean) => void)[] = [];
      const onDrop = jest.fn(
        () =>
          new Promise<boolean>((resolve) => {
            saves.push(resolve);
          }),
      );
      await renderFrame(<Frame onDrop={onDrop} />);
      const drag = controller();

      for (let round = 0; round < 2; round += 1) {
        await act(async () => {
          drag.begin();
          drag.activate();
          drag.update({ translationY: 160 });
        });
        reorderForTest?.target.set(2);
        await act(async () => {
          drag.end();
        });
      }
      expect(saves).toHaveLength(2);

      // The first drop's save settling must not release the frame held for the second.
      await act(async () => {
        saves[0](true);
      });
      expect(zIndexAbove()).toBe(10);
      await act(async () => {
        saves[1](true);
      });
      expect(zIndexAbove()).toBe(0);
    });

    it("commits nothing when the gesture is cancelled", async () => {
      const onDrop = jest.fn(() => Promise.resolve(true));
      await renderFrame(<Frame onDrop={onDrop} />);
      const drag = controller();

      await act(async () => {
        drag.begin();
        drag.activate();
      });
      reorderForTest?.target.set(2);
      await act(async () => {
        drag.cancel();
      });

      expect(onDrop).not.toHaveBeenCalled();
      expect(hapticSuccess).not.toHaveBeenCalled();
      expect(reorderForTest?.source.get()).toBe(-1);
    });
  });
});
