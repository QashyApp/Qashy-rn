import { fireEvent, render, screen } from "@testing-library/react-native";

import { effectiveAccentMode, ThemePicker } from "@/components/ui/theme-picker";
import { classicTheme } from "@/theme/themes/classic";
import type { ThemeDefinition } from "@/theme/themes/types";

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

const fixedTheme: ThemeDefinition = {
  ...classicTheme,
  id: "high-contrast",
  name: "High contrast",
  accent: { ...classicTheme.accent, mode: "fixed" },
};

describe("ThemePicker", () => {
  it("is a radiogroup of radios named by theme name and description, with the selected one checked", async () => {
    await render(
      <ThemePicker
        value="classic"
        onChange={jest.fn()}
        themes={[classicTheme, fixedTheme]}
      />,
    );

    expect(screen.getByLabelText("Theme").props.accessibilityRole).toBe(
      "radiogroup",
    );
    const classic = screen.getByRole("radio", {
      name: /^Classic\. Soft, tactile surfaces/,
    });
    const contrast = screen.getByRole("radio", {
      name: /^High contrast\. Maximum contrast/,
    });
    expect(classic.props.accessibilityState).toMatchObject({ checked: true });
    expect(contrast.props.accessibilityState).toMatchObject({ checked: false });
  });

  it("reports the chosen theme id on press", async () => {
    const onChange = jest.fn();
    await render(
      <ThemePicker
        value="classic"
        onChange={onChange}
        themes={[classicTheme, fixedTheme]}
      />,
    );

    await fireEvent.press(
      screen.getByRole("radio", { name: /^High contrast/ }),
    );
    expect(onChange).toHaveBeenCalledWith("high-contrast");
  });

  it('keeps theme names out of the mode radios (e2e matches "Dark" by substring)', async () => {
    await render(
      <ThemePicker
        value="classic"
        onChange={jest.fn()}
        themes={[classicTheme, fixedTheme]}
      />,
    );
    expect(
      screen.queryAllByRole("radio", { name: /dark|light/i }),
    ).toHaveLength(0);
  });
});

describe("effectiveAccentMode", () => {
  it("treats the system accent as fixed anywhere but Android", () => {
    const system: ThemeDefinition = {
      ...classicTheme,
      accent: { ...classicTheme.accent, mode: "system" },
    };
    expect(effectiveAccentMode(system, "ios")).toBe("fixed");
    expect(effectiveAccentMode(system, "web")).toBe("fixed");
    expect(effectiveAccentMode(system, "android")).toBe("system");
    expect(effectiveAccentMode(fixedTheme, "android")).toBe("fixed");
    expect(effectiveAccentMode(classicTheme, "web")).toBe("user");
  });
});
