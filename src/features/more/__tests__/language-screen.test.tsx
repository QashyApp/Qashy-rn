import { fireEvent, render, screen } from "@testing-library/react-native";

import { LanguageScreen } from "@/features/more/language-screen";

const mockSetPreference = jest.fn();
let mockPreference = "system";

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
    preference: mockPreference,
    systemLocale: "en-US",
    setPreference: mockSetPreference,
  }),
}));

describe("LanguageScreen", () => {
  beforeEach(() => {
    mockSetPreference.mockReset();
    mockSetPreference.mockResolvedValue(undefined);
    mockPreference = "system";
  });

  it("lists system default with the resolved language, then each bundled language", async () => {
    await render(<LanguageScreen />);
    expect(screen.getByLabelText("Language").props.accessibilityRole).toBe(
      "radiogroup",
    );
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(
      screen.getByRole("radio", { name: "System default, English" }).props
        .accessibilityState,
    ).toMatchObject({ checked: true });
    expect(
      screen.getByRole("radio", { name: "עברית" }).props.accessibilityState,
    ).toMatchObject({ checked: false });
  });

  it("sets the preference when a language is chosen", async () => {
    await render(<LanguageScreen />);
    await fireEvent.press(screen.getByRole("radio", { name: "עברית" }));
    expect(mockSetPreference).toHaveBeenCalledWith("he-IL");
  });

  it("returns to system default", async () => {
    mockPreference = "he-IL";
    await render(<LanguageScreen />);
    expect(
      screen.getByRole("radio", { name: "עברית" }).props.accessibilityState,
    ).toMatchObject({ checked: true });
    await fireEvent.press(
      screen.getByRole("radio", { name: "System default, English" }),
    );
    expect(mockSetPreference).toHaveBeenCalledWith("system");
  });

  it("does nothing when the selected language is pressed again", async () => {
    mockPreference = "en-US";
    await render(<LanguageScreen />);
    await fireEvent.press(screen.getByRole("radio", { name: "English" }));
    expect(mockSetPreference).not.toHaveBeenCalled();
  });
});
