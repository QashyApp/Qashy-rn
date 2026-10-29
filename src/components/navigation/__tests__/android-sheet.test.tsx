import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Text } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
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
    let guard: ((guarded: boolean) => void) | undefined;
    const Probe = () => {
      guard = useSheetShell()?.setGuarded;
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
    await act(async () => guard?.(true));
    await fireEvent.press(screen.getAllByLabelText("Close").at(-1)!);
    expect(nav.goBack).toHaveBeenCalledTimes(1);
    // The sheet did not animate away before the question was asked, so it can be asked again.
    await fireEvent.press(screen.getAllByLabelText("Close").at(-1)!);
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
