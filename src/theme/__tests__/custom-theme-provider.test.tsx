import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { FULL_EXAMPLE } from "@/theme/custom/examples";
import { parseCustomTheme } from "@/theme/custom/schema";
import { QashyThemeProvider, useQashyTheme } from "@/theme/theme";
import { classicTheme } from "@/theme/themes/classic";
import type { ThemeDefinition } from "@/theme/themes/types";

let mockThemeId = "classic";
let mockCustom: readonly ThemeDefinition[] = [];

jest.mock("@expo/ui", () => ({
  Host: ({ children }: { children: unknown }) => children,
}));
jest.mock("@/data/local-finance-repository", () => ({ syncingStorage: {} }));
jest.mock("@/theme/custom/use-custom-themes", () => ({
  useCustomThemes: () => ({
    themes: mockCustom,
    files: [],
    warnings: [],
    status: "ready",
    save: jest.fn(),
    remove: jest.fn(),
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
jest.mock("@/providers/finance-provider", () => ({
  useFinanceState: () => ({
    settings: {
      themeId: mockThemeId,
      themeMode: "light",
      accentSource: "preset",
      accentHex: "#5966E9",
    },
  }),
}));

function Probe() {
  const theme = useQashyTheme();
  return <Text testID="bg">{String(theme.background)}</Text>;
}

const custom = (() => {
  const result = parseCustomTheme(FULL_EXAMPLE);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result;
})();

describe("QashyThemeProvider with custom themes", () => {
  beforeEach(() => {
    mockThemeId = "classic";
    mockCustom = [];
  });

  it("applies the palette of a resolvable custom theme", async () => {
    mockThemeId = custom.theme.id;
    mockCustom = [custom.theme];
    await render(
      <QashyThemeProvider>
        <Probe />
      </QashyThemeProvider>,
    );
    expect(custom.theme.palette.light.background).not.toBe(
      classicTheme.palette.light.background,
    );
    expect(screen.getByTestId("bg").props.children).toBe(
      custom.theme.palette.light.background,
    );
  });

  it("falls back to classic, without throwing, when the selected custom id cannot be resolved", async () => {
    mockThemeId = "deleted-theme";
    await render(
      <QashyThemeProvider>
        <Probe />
      </QashyThemeProvider>,
    );
    expect(screen.getByTestId("bg").props.children).toBe(
      classicTheme.palette.light.background,
    );
  });
});
