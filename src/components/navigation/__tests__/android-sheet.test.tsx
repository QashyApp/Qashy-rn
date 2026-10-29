import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { useEffect, type ReactElement } from "react";
import { ScrollView, Text } from "react-native";
import {
  GestureDetector,
  GestureHandlerRootView,
  State,
} from "react-native-gesture-handler";
import {
  createGestureController,
  getByGestureTestId,
} from "react-native-gesture-handler/jest-utils";

import {
  AndroidSheet,
  ANDROID_SHEET_OPTIONS,
  hasAndroidSheetOptions,
  sheetScreenLayout,
} from "@/components/navigation/android-sheet";
import { useSheetBody } from "@/components/navigation/sheet-body-context";
import { useSheetShell } from "@/components/navigation/sheet-shell-context";
import { AnimationLevelContext } from "@/components/ui/animation-level-context";

// Real shared values persist across renders (the mock builds a fresh one each time). A boolean flag
// can also be made to read stale, as a JS-side read of a value written on the UI thread can for a
// frame: `lagFlags.on` hides every `true` write from `get()`.
const lagFlags = { on: false };
jest.mock("react-native-reanimated", () => {
  const Reanimated = jest.requireActual("react-native-reanimated/mock");
  const { useRef } = jest.requireActual("react");
  Reanimated.default.call = () => {};
  Reanimated.useReducedMotion = () => false;
  const mockSharedValue = Reanimated.useSharedValue;
  Reanimated.useSharedValue = (initial: unknown) => {
    const ref = useRef(null as unknown);
    if (ref.current === null) {
      const value = mockSharedValue(initial) as { get: () => unknown };
      ref.current =
        typeof initial === "boolean"
          ? new Proxy(value, {
              get(target, prop) {
                if (prop === "get") {
                  return () => (lagFlags.on ? initial : target.get());
                }
                return Reflect.get(target, prop);
              },
            })
          : value;
      return ref.current;
    }
    return ref.current;
  };
  return Reanimated;
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));

jest.mock("@/theme/theme", () => {
  const actual = jest.requireActual("@/theme/theme");
  return {
    ...actual,
    useQashyTheme: () => actual.accentTokens("#5966E9", false),
  };
});

jest.mock("@/localization/localization", () => ({
  useLocalization: () => ({
    t: (message: string) => message,
    isRtl: false,
    language: "en",
    locale: "en-US",
  }),
}));

const navigation = () => ({ goBack: jest.fn(), isFocused: () => true });

const renderSheet = async (nav: ReturnType<typeof navigation>) =>
  render(
    // Gesture handler v3's `GestureDetector` requires a `GestureHandlerRootView` ancestor
    // (the app root supplies one in production).
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Motion off: the exit finishes at once, so no UI-thread timing is involved. */}
      <AnimationLevelContext value="off">
        <AndroidSheet title="Transaction" navigation={nav}>
          <Text>Form body</Text>
        </AndroidSheet>
      </AnimationLevelContext>
    </GestureHandlerRootView>,
  );

const handles: {
  reportOffset?: (offsetY: number) => void;
  guard?: (guarded: boolean) => void;
} = {};
describe("AndroidSheet", () => {
  it("shows the title and the screen inside it", async () => {
    await renderSheet(navigation());
    expect(screen.getByText("Transaction")).toBeTruthy();
    expect(screen.getByText("Form body")).toBeTruthy();
  });

  it("closes through the close button, then goes back", async () => {
    const nav = navigation();
    await renderSheet(nav);
    await fireEvent.press(screen.getAllByLabelText("Close").at(-1)!);
    await act(async () => undefined);
    expect(nav.goBack).toHaveBeenCalledTimes(1);
  });

  it("closes once however many ways ask for it", async () => {
    const nav = navigation();
    await renderSheet(nav);
    // The scrim is pointer-only (hidden from screen readers), so it is reached by test id.
    const scrim = screen.getByTestId("android-sheet-scrim", {
      includeHiddenElements: true,
    });
    const button = screen.getByLabelText("Close");
    await fireEvent.press(scrim);
    await fireEvent.press(button);
    await act(async () => undefined);
    expect(nav.goBack).toHaveBeenCalledTimes(1);
  });

  it("goes back once when a flick-dismiss and a tap land in the same frame", async () => {
    const nav = navigation();
    await renderSheet(nav);
    const pan = createGestureController(
      getByGestureTestId("android-sheet-pan"),
    );
    lagFlags.on = true;
    try {
      // The throw's `dismissNow` runs on JS while the UI-thread closing flag still reads false here.
      await act(async () => {
        pan.begin();
        pan.activate();
        pan.update({ translationY: 200 });
        pan.end({ velocityY: 3000 });
      });
      expect(nav.goBack).toHaveBeenCalledTimes(1);
      const scrim = screen.getByTestId("android-sheet-scrim", {
        includeHiddenElements: true,
      });
      await fireEvent.press(scrim);
      await fireEvent.press(screen.getByLabelText("Close"));
      await act(async () => undefined);
    } finally {
      lagFlags.on = false;
    }
    expect(nav.goBack).toHaveBeenCalledTimes(1);
  });

  it("goes straight to the screen's own confirmation while the form is dirty", async () => {
    const nav = navigation();
    const Probe = () => {
      const shell = useSheetShell();
      useEffect(() => {
        handles.guard = shell?.setGuarded;
      }, [shell?.setGuarded]);
      return null;
    };
    await render(
      <GestureHandlerRootView style={{ flex: 1 }}>
        <AnimationLevelContext value="off">
          <AndroidSheet title="Transaction" navigation={nav}>
            <Probe />
          </AndroidSheet>
        </AnimationLevelContext>
      </GestureHandlerRootView>,
    );
    await act(async () => handles.guard?.(true));
    await fireEvent.press(screen.getAllByLabelText("Close").at(-1)!);
    expect(nav.goBack).toHaveBeenCalledTimes(1);
    // The sheet did not animate away before the question was asked, so it can be asked again.
    await fireEvent.press(screen.getAllByLabelText("Close").at(-1)!);
    expect(nav.goBack).toHaveBeenCalledTimes(2);
  });
});

// A sheet body the way `FormScreen` wires its scroll view: registered with the sheet, wrapped in the
// scroll gesture, and reporting its offset.
const ScrollBody = () => {
  const body = useSheetBody();
  const shell = useSheetShell();
  const register = body?.register;
  useEffect(() => register?.(), [register]);
  useEffect(() => {
    handles.reportOffset = body?.reportOffset;
    handles.guard = shell?.setGuarded;
  }, [body?.reportOffset, shell?.setGuarded]);
  if (!body) return null;
  return (
    <GestureDetector gesture={body.scrollGesture}>
      <ScrollView testID="body-scroll" scrollEnabled={body.scrollEnabled}>
        <Text>Scrolling body</Text>
      </ScrollView>
    </GestureDetector>
  );
};

const renderScrollSheet = async (
  nav: ReturnType<typeof navigation>,
  { measured = false, registered = true } = {},
) => {
  const view = await render(
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AnimationLevelContext value="off">
        <AndroidSheet title="Transaction" navigation={nav}>
          {registered ? <ScrollBody /> : <Text>Plain body</Text>}
        </AndroidSheet>
      </AnimationLevelContext>
    </GestureHandlerRootView>,
  );
  if (measured) {
    // An 800px window: the panel opens at 72% of it and can be dragged up to its full height.
    await fireEvent(screen.getByTestId("android-sheet-frame"), "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } },
    });
  }
  return view;
};

// The callbacks a gesture was built with, for driving ones the gesture controller has no event for.
type PanCallbacks = Record<string, ((...args: never[]) => void) | undefined>;
const callbacksOf = (testId: string) =>
  (getByGestureTestId(testId) as unknown as { handlers: PanCallbacks })
    .handlers;

const bodyPan = () =>
  createGestureController(getByGestureTestId("android-sheet-body-pan"));
const headerPan = () =>
  createGestureController(getByGestureTestId("android-sheet-pan"));

describe("AndroidSheet body drag", () => {
  beforeEach(() => {
    handles.reportOffset = undefined;
    handles.guard = undefined;
  });

  it("dismisses from the body when the content is at the top", async () => {
    const nav = navigation();
    await renderScrollSheet(nav);
    const pan = bodyPan();
    await act(async () => {
      pan.begin();
      pan.activate();
      pan.update({ translationY: 14 });
      pan.update({ translationY: 220 });
      pan.end({ velocityY: 3000 });
    });
    expect(nav.goBack).toHaveBeenCalledTimes(1);
  });

  it("leaves the drag to the scroll view when the content is scrolled down", async () => {
    const nav = navigation();
    await renderScrollSheet(nav);
    await act(async () => handles.reportOffset?.(180));
    const pan = bodyPan();
    await act(async () => {
      pan.begin();
      pan.activate();
      pan.update({ translationY: 14 });
      pan.update({ translationY: 220 });
      pan.end({ velocityY: 3000 });
    });
    expect(nav.goBack).not.toHaveBeenCalled();
  });

  it("carries on into closing once the same drag has scrolled the content to the top", async () => {
    const nav = navigation();
    await renderScrollSheet(nav);
    await act(async () => handles.reportOffset?.(180));
    const pan = bodyPan();
    await act(async () => {
      pan.begin();
      pan.activate();
      pan.update({ translationY: 14 });
      pan.update({ translationY: 120 });
      handles.reportOffset?.(0);
      pan.update({ translationY: 140 });
      pan.update({ translationY: 400 });
      pan.end({ velocityY: 3000 });
    });
    expect(nav.goBack).toHaveBeenCalledTimes(1);
  });

  it("does not read a fling that only scrolled the content as a throw at the sheet", async () => {
    const nav = navigation();
    await renderScrollSheet(nav);
    await act(async () => handles.reportOffset?.(500));
    const pan = bodyPan();
    await act(async () => {
      pan.begin();
      pan.activate();
      pan.update({ translationY: 40 });
      handles.reportOffset?.(0);
      pan.end({ velocityY: 4000 });
    });
    expect(nav.goBack).not.toHaveBeenCalled();
  });

  it("expands from the lower detent on a drag up, then lets the content scroll", async () => {
    const nav = navigation();
    await renderScrollSheet(nav, { measured: true });
    // Below the top detent an upward drag expands the sheet, so the scroll view is switched off.
    expect(screen.getByTestId("body-scroll").props.scrollEnabled).toBe(false);
    const pan = bodyPan();
    await act(async () => {
      pan.begin();
      pan.activate();
      pan.update({ translationY: -14 });
      pan.update({ translationY: -260 });
      pan.end({ velocityY: -2000 });
    });
    expect(nav.goBack).not.toHaveBeenCalled();
    expect(screen.getByTestId("body-scroll").props.scrollEnabled).toBe(true);
  });

  it("settles back on the lower detent after a short upward drag", async () => {
    const nav = navigation();
    await renderScrollSheet(nav, { measured: true });
    const pan = bodyPan();
    await act(async () => {
      pan.begin();
      pan.activate();
      pan.update({ translationY: -12 });
      pan.update({ translationY: -40 });
      pan.end({ velocityY: -50 });
    });
    expect(nav.goBack).not.toHaveBeenCalled();
    expect(screen.getByTestId("body-scroll").props.scrollEnabled).toBe(false);
  });

  it("leaves a body that never registered a scroll view to the header", async () => {
    const nav = navigation();
    await renderScrollSheet(nav, { registered: false });
    const pan = bodyPan();
    await act(async () => {
      pan.begin();
      pan.activate();
      pan.update({ translationY: 220 });
      pan.end({ velocityY: 3000 });
    });
    expect(nav.goBack).not.toHaveBeenCalled();
  });

  it("never activates the body pan for a body that did not register", async () => {
    const nav = navigation();
    await renderScrollSheet(nav, { registered: false });
    expect(getByGestureTestId("android-sheet-body-pan").config.enabled).toBe(
      false,
    );
  });

  it("enables the body pan once a body has registered", async () => {
    await renderScrollSheet(navigation());
    expect(getByGestureTestId("android-sheet-body-pan").config.enabled).toBe(
      true,
    );
  });

  it("keeps the scroll offset across detent changes, so a pull down from a scrolled form scrolls", async () => {
    const nav = navigation();
    await renderScrollSheet(nav, { measured: true });
    const body = bodyPan();
    const header = headerPan();
    // Expand from the body, then scroll the form well down.
    await act(async () => {
      body.begin();
      body.activate();
      body.update({ translationY: -14 });
      body.update({ translationY: -260 });
      body.end({ velocityY: -2000 });
    });
    expect(screen.getByTestId("body-scroll").props.scrollEnabled).toBe(true);
    await act(async () => handles.reportOffset?.(400));
    // Lower the sheet from the header (the scroll view switches off), then expand it from the body
    // (it switches back on): every flip rebuilds the context value.
    await act(async () => {
      header.begin();
      header.activate();
      header.update({ translationY: 100 });
      header.update({ translationY: 200 });
      header.end({ velocityY: 0 });
    });
    expect(screen.getByTestId("body-scroll").props.scrollEnabled).toBe(false);
    await act(async () => {
      body.begin();
      body.activate();
      body.update({ translationY: -14 });
      body.update({ translationY: -260 });
      body.end({ velocityY: -2000 });
    });
    expect(screen.getByTestId("body-scroll").props.scrollEnabled).toBe(true);
    // The form is still scrolled to 400: a pull down belongs to the scroll view.
    await act(async () => {
      body.begin();
      body.activate();
      body.update({ translationY: 14 });
      body.update({ translationY: 300 });
      body.end({ velocityY: 3000 });
    });
    expect(nav.goBack).not.toHaveBeenCalled();
  });

  it("keeps the register callback stable while the scroll hand-off flips", async () => {
    const registers: unknown[] = [];
    const Spy = () => {
      registers.push(useSheetBody()?.register);
      return null;
    };
    await render(
      <GestureHandlerRootView style={{ flex: 1 }}>
        <AnimationLevelContext value="off">
          <AndroidSheet title="Transaction" navigation={navigation()}>
            <Spy />
          </AndroidSheet>
        </AnimationLevelContext>
      </GestureHandlerRootView>,
    );
    await fireEvent(screen.getByTestId("android-sheet-frame"), "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } },
    });
    expect(registers.length).toBeGreaterThan(1);
    expect(new Set(registers).size).toBe(1);
  });

  it("takes a single finger for both pans", async () => {
    await renderScrollSheet(navigation());
    expect(getByGestureTestId("android-sheet-pan").config.maxPointers).toBe(1);
    expect(
      getByGestureTestId("android-sheet-body-pan").config.maxPointers,
    ).toBe(1);
  });

  it("lets go of a cancelled header drag instead of throwing the sheet", async () => {
    const nav = navigation();
    await renderScrollSheet(nav, { measured: true });
    const header = headerPan();
    await act(async () => {
      header.begin();
      header.activate();
      header.update({ translationY: 100 });
      // The cancel carries a fast downward velocity that would dismiss a real release.
      header.cancel({ velocityY: 3000 });
    });
    expect(nav.goBack).not.toHaveBeenCalled();
  });

  it("puts a header drag down when it is finalized without having ended", async () => {
    const nav = navigation();
    await renderScrollSheet(nav, { measured: true });
    const handlers = callbacksOf("android-sheet-pan");
    const event = { velocityY: 0 } as never;
    await act(async () => {
      handlers.onStart?.(event);
      handlers.onUpdate?.({ translationY: -200 } as never);
      handlers.onFinalize?.(event, false as never);
    });
    // Released at the top detent rather than left half way: the scroll view is live again.
    expect(screen.getByTestId("body-scroll").props.scrollEnabled).toBe(true);
    expect(nav.goBack).not.toHaveBeenCalled();
  });

  it("activates the body pan by hand, and only on a mostly vertical move", async () => {
    await renderScrollSheet(navigation());
    const handlers = callbacksOf("android-sheet-body-pan");
    const { config } = getByGestureTestId("android-sheet-body-pan");
    expect(config.manualActivation).toBe(true);
    const manager = { activate: jest.fn(), fail: jest.fn() };
    const touch = (x: number, y: number) => ({
      state: State.BEGAN,
      numberOfTouches: 1,
      allTouches: [{ absoluteX: x, absoluteY: y }],
    });
    const move = (x: number, y: number) =>
      act(async () =>
        handlers.onTouchesMove?.(touch(x, y) as never, manager as never),
      );
    await act(async () =>
      handlers.onTouchesDown?.(touch(100, 100) as never, manager as never),
    );
    await move(104, 106);
    expect(manager.activate).not.toHaveBeenCalled();
    expect(manager.fail).not.toHaveBeenCalled();
    await move(118, 112);
    expect(manager.fail).toHaveBeenCalledTimes(1);
    await move(104, 114);
    expect(manager.activate).toHaveBeenCalledTimes(1);
  });

  it("asks the screen's confirmation first when a dirty form is dragged away from the body", async () => {
    const nav = navigation();
    await renderScrollSheet(nav);
    await act(async () => handles.guard?.(true));
    const pan = bodyPan();
    await act(async () => {
      pan.begin();
      pan.activate();
      pan.update({ translationY: 14 });
      pan.update({ translationY: 220 });
      pan.end({ velocityY: 3000 });
    });
    // The question is asked (the route's guard answers `goBack`); the sheet has not left, so a
    // second drag asks again.
    expect(nav.goBack).toHaveBeenCalledTimes(1);
    await act(async () => {
      pan.begin();
      pan.activate();
      pan.update({ translationY: 14 });
      pan.update({ translationY: 220 });
      pan.end({ velocityY: 3000 });
    });
    expect(nav.goBack).toHaveBeenCalledTimes(2);
  });
});

describe("sheetScreenLayout", () => {
  it("recognizes the sheet's options and nothing else", () => {
    expect(hasAndroidSheetOptions(ANDROID_SHEET_OPTIONS)).toBe(true);
    expect(hasAndroidSheetOptions({ presentation: "card" })).toBe(false);
    expect(hasAndroidSheetOptions({})).toBe(false);
  });

  it("wraps the screen in the sheet on Android", () => {
    // Jest runs as Android (see jest.config.cjs).
    const child = <Text>screen</Text>;
    const wrapped: ReactElement = sheetScreenLayout({
      options: ANDROID_SHEET_OPTIONS,
      navigation: navigation(),
      children: child,
    });
    expect(wrapped).not.toBe(child);
    expect(
      (wrapped as ReactElement<{ children: unknown }>).props.children,
    ).toBe(child);
  });

  // The off-Android branch is not testable here: `process.env.EXPO_OS` is inlined by Babel at
  // build time, and Jest is built for Android. Web never mounts the sheet (it uses the form sheet).
});
