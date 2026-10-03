import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";

import { AppearanceScreen } from "@/features/more/appearance-screen";
import { FULL_EXAMPLE, MINIMAL_EXAMPLE } from "@/theme/custom/examples";
import { parseCustomTheme, type CustomThemeFile } from "@/theme/custom/schema";
import { exportCustomThemeJson } from "@/theme/custom/theme-import";
import type { ThemeDefinition } from "@/theme/themes/types";

const mockUpdateSettings = jest.fn();
const mockSave = jest.fn();
const mockRemove = jest.fn();
const mockPick = jest.fn();
const mockSaveFile = jest.fn();
const mockConfirm = jest.fn();
const mockShowError = jest.fn();
let mockThemeId = "classic";
let mockFiles: CustomThemeFile[] = [];

const themeOf = (file: CustomThemeFile): ThemeDefinition => {
  const result = parseCustomTheme(file);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.theme;
};

jest.mock("@/theme/theme", () => {
  const actual = jest.requireActual("@/theme/theme");
  return {
    ...actual,
    useQashyTheme: () => actual.accentTokens("#5966E9", false),
  };
});
jest.mock("@/theme/custom/use-custom-themes", () => ({
  useCustomThemes: () => ({
    status: "ready",
    files: mockFiles,
    themes: mockFiles.map(themeOf),
    warnings: [],
    save: mockSave,
    remove: mockRemove,
  }),
}));
jest.mock("@/features/more/custom-theme-files", () => ({
  pickThemeFileText: (...args: unknown[]) => mockPick(...args),
  saveThemeFile: (...args: unknown[]) => mockSaveFile(...args),
}));
jest.mock("@/utils/confirm", () => ({
  ...jest.requireActual("@/utils/confirm"),
  confirmDestructive: (...args: unknown[]) => mockConfirm(...args),
  showError: (...args: unknown[]) => mockShowError(...args),
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
  useFinanceRepository: () => ({ updateSettings: mockUpdateSettings }),
  useFinanceState: () => ({
    settings: {
      revision: 1,
      locale: "en-US",
      baseCurrency: "USD",
      themeId: mockThemeId,
      themeMode: "light",
      accentSource: "preset",
      accentHex: "#5966E9",
    },
  }),
}));

describe("AppearanceScreen custom themes", () => {
  beforeEach(() => {
    for (const mock of [
      mockUpdateSettings,
      mockSave,
      mockRemove,
      mockPick,
      mockSaveFile,
      mockConfirm,
      mockShowError,
    ])
      mock.mockReset();
    mockUpdateSettings.mockResolvedValue({ revision: 2 });
    mockSave.mockResolvedValue(undefined);
    mockRemove.mockResolvedValue(undefined);
    mockConfirm.mockResolvedValue(true);
    mockThemeId = "classic";
    mockFiles = [];
  });

  it("imports a valid theme file, saves it and selects it", async () => {
    mockPick.mockResolvedValue(exportCustomThemeJson(MINIMAL_EXAMPLE));
    await render(<AppearanceScreen />);

    await fireEvent.press(screen.getByRole("button", { name: "Import theme" }));

    await waitFor(() =>
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        themeId: MINIMAL_EXAMPLE.id,
      }),
    );
    expect(mockSave).toHaveBeenCalledWith(MINIMAL_EXAMPLE);
    expect(mockShowError).not.toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(screen.getByText("Theme imported.")).toBeTruthy();
  });

  it("changes nothing and lists path-addressed errors (at most five) when the file is invalid", async () => {
    const bad = {
      ...MINIMAL_EXAMPLE,
      a: 1,
      b: 2,
      c: 3,
      d: 4,
      e: 5,
      f: 6,
      g: 7,
    };
    mockPick.mockResolvedValue(JSON.stringify(bad));
    await render(<AppearanceScreen />);

    await fireEvent.press(screen.getByRole("button", { name: "Import theme" }));

    await waitFor(() => expect(mockShowError).toHaveBeenCalled());
    const [title, message] = mockShowError.mock.calls[0] as [string, string];
    expect(title).toBe("Couldn’t import theme");
    expect(message).toContain("$.a");
    expect(message.split("\n")).toHaveLength(6);
    expect(message).toContain("…and 2 more");
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it("changes nothing for text that is not JSON, and for a cancelled picker", async () => {
    await render(<AppearanceScreen />);
    mockPick.mockResolvedValueOnce("{nope");
    await fireEvent.press(screen.getByRole("button", { name: "Import theme" }));
    await waitFor(() => expect(mockShowError).toHaveBeenCalledTimes(1));
    mockPick.mockResolvedValueOnce(null);
    await fireEvent.press(screen.getByRole("button", { name: "Import theme" }));
    await waitFor(() => expect(mockPick).toHaveBeenCalledTimes(2));
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it("shows the store limit error as a readable message and does not select the theme", async () => {
    mockPick.mockResolvedValue(exportCustomThemeJson(MINIMAL_EXAMPLE));
    mockSave.mockRejectedValue(
      new Error("At most 8 custom themes can be stored; delete one first."),
    );
    await render(<AppearanceScreen />);

    await fireEvent.press(screen.getByRole("button", { name: "Import theme" }));

    await waitFor(() =>
      expect(mockShowError).toHaveBeenCalledWith(
        "Couldn’t import theme",
        "At most 8 custom themes can be stored; delete one first.",
      ),
    );
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it("replaces a theme with the same id only after confirmation", async () => {
    mockFiles = [MINIMAL_EXAMPLE];
    mockPick.mockResolvedValue(
      exportCustomThemeJson({ ...MINIMAL_EXAMPLE, name: "Changed" }),
    );
    mockConfirm.mockResolvedValueOnce(false);
    await render(<AppearanceScreen />);

    await fireEvent.press(screen.getByRole("button", { name: "Import theme" }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    expect(mockSave).not.toHaveBeenCalled();

    mockConfirm.mockResolvedValueOnce(true);
    await fireEvent.press(screen.getByRole("button", { name: "Import theme" }));
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ id: MINIMAL_EXAMPLE.id, name: "Changed" }),
      ),
    );
  });

  it("lists custom themes with a Custom badge and exports the selected one", async () => {
    mockFiles = [FULL_EXAMPLE];
    mockThemeId = FULL_EXAMPLE.id;
    await render(<AppearanceScreen />);

    expect(
      screen.getByRole("radio", {
        name: new RegExp(`^${FULL_EXAMPLE.name}\\. Custom`),
      }),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Export theme" }));
    await waitFor(() =>
      expect(mockSaveFile).toHaveBeenCalledWith(
        `qashy-theme-${FULL_EXAMPLE.id}.json`,
        exportCustomThemeJson(FULL_EXAMPLE),
        "Export theme",
      ),
    );
  });

  it("disables export when the selected theme is built in", async () => {
    mockFiles = [FULL_EXAMPLE];
    await render(<AppearanceScreen />);
    expect(
      screen.getByRole("button", { name: "Export theme" }).props
        .accessibilityState,
    ).toMatchObject({ disabled: true });
  });

  it("deleting the active custom theme switches to classic first, then removes it", async () => {
    mockFiles = [FULL_EXAMPLE];
    mockThemeId = FULL_EXAMPLE.id;
    await render(<AppearanceScreen />);

    await fireEvent.press(
      screen.getByRole("button", {
        name: `Delete theme: ${FULL_EXAMPLE.name}`,
      }),
    );

    await waitFor(() =>
      expect(mockRemove).toHaveBeenCalledWith(FULL_EXAMPLE.id),
    );
    expect(mockUpdateSettings).toHaveBeenCalledWith({ themeId: "classic" });
    expect(mockUpdateSettings.mock.invocationCallOrder[0]).toBeLessThan(
      mockRemove.mock.invocationCallOrder[0],
    );
  });

  it("deleting an inactive custom theme leaves the selection alone, and cancelling deletes nothing", async () => {
    mockFiles = [FULL_EXAMPLE];
    await render(<AppearanceScreen />);
    mockConfirm.mockResolvedValueOnce(false);
    await fireEvent.press(
      screen.getByRole("button", {
        name: `Delete theme: ${FULL_EXAMPLE.name}`,
      }),
    );
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    expect(mockRemove).not.toHaveBeenCalled();

    await fireEvent.press(
      screen.getByRole("button", {
        name: `Delete theme: ${FULL_EXAMPLE.name}`,
      }),
    );
    await waitFor(() =>
      expect(mockRemove).toHaveBeenCalledWith(FULL_EXAMPLE.id),
    );
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it("keeps the theme when it cannot leave it first", async () => {
    mockFiles = [FULL_EXAMPLE];
    mockThemeId = FULL_EXAMPLE.id;
    mockUpdateSettings.mockRejectedValue(new Error("nope"));
    await render(<AppearanceScreen />);
    await fireEvent.press(
      screen.getByRole("button", {
        name: `Delete theme: ${FULL_EXAMPLE.name}`,
      }),
    );
    await waitFor(() => expect(mockShowError).toHaveBeenCalled());
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
