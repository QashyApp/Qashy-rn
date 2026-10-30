import { fireEvent, render, screen } from "@testing-library/react-native";

import { ActionButton } from "@/components/ui/action-button";

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
jest.mock("@/services/haptics", () => ({
  hapticImpactLight: jest.fn(),
  hapticSelection: jest.fn(),
  hapticWarning: jest.fn(),
}));

describe("ActionButton", () => {
  it("runs onPress when idle", async () => {
    const onPress = jest.fn();
    await render(<ActionButton title="Save" onPress={onPress} />);
    await fireEvent.press(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("ignores presses while busy, so a double tap cannot submit twice", async () => {
    const onPress = jest.fn();
    await render(<ActionButton title="Save" busy onPress={onPress} />);
    const button = screen.getByRole("button");
    expect(button.props.accessibilityState).toMatchObject({ busy: true });
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("ignores presses while disabled", async () => {
    const onPress = jest.fn();
    await render(<ActionButton title="Save" disabled onPress={onPress} />);
    await fireEvent.press(screen.getByRole("button"));
    expect(onPress).not.toHaveBeenCalled();
  });
});
