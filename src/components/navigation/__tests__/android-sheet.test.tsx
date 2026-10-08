import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import {
  AndroidSheet,
  ANDROID_SHEET_OPTIONS,
  hasAndroidSheetOptions,
  sheetScreenLayout,
} from "@/components/navigation/android-sheet";
import { useSheetShell } from "@/components/navigation/sheet-shell-context";
import { AnimationLevelContext } from "@/components/ui/animation-level-context";

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
    // Motion off: the exit finishes at once, so no UI-thread timing is involved.
    <AnimationLevelContext value="off">
      <AndroidSheet title="Transaction" navigation={nav}>
        <Text>Form body</Text>
      </AndroidSheet>
    </AnimationLevelContext>,
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

  it("goes straight to the screen's own confirmation while the form is dirty", async () => {
    const nav = navigation();
    let guard: ((guarded: boolean) => void) | undefined;
    const Probe = () => {
      guard = useSheetShell()?.setGuarded;
      return null;
    };
    await render(
      <AnimationLevelContext value="off">
        <AndroidSheet title="Transaction" navigation={nav}>
          <Probe />
        </AndroidSheet>
      </AnimationLevelContext>,
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

  it("returns the screen untouched off Android, even with the sheet's options", () => {
    // Jest runs as iOS.
    const child = <Text>screen</Text>;
    expect(
      sheetScreenLayout({
        options: ANDROID_SHEET_OPTIONS,
        navigation: navigation(),
        children: child,
      }),
    ).toBe(child);
  });
});
