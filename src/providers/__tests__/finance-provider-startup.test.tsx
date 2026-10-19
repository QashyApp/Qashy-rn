import { render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import { FinanceProvider } from "@/providers/finance-provider";

// The startup failure screen reads the language without the localization provider, so only the
// repository and the two language reads are replaced.
const mockSnapshot = { ready: false, settings: {} };
const mockEnv = {
  failure: new Error("database is locked") as unknown,
  perApp: null as string | null,
  device: ["en-US"],
};

jest.mock("@/data/local-finance-repository", () => ({
  financeRepository: {
    subscribe: () => () => undefined,
    getSnapshot: () => mockSnapshot,
    initialize: () => Promise.reject(mockEnv.failure),
    sweepArchived: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    generateRecurring: () => Promise.resolve(),
  },
}));
jest.mock("@/providers/exchange-rate-provider", () => ({
  ensurePendingRatesWithCap: () => Promise.resolve(),
}));
jest.mock("@/localization/language-store", () => ({
  readNativeRawPreference: () => mockEnv.perApp,
  readDeviceLocales: () => mockEnv.device,
}));

async function renderProvider() {
  return await render(
    <FinanceProvider>
      <Text>ready</Text>
    </FinanceProvider>,
  );
}

describe("the startup failure screen", () => {
  let consoleError: jest.SpyInstance;
  beforeEach(() => {
    mockEnv.failure = new Error("database is locked");
    mockEnv.perApp = null;
    mockEnv.device = ["en-US"];
    consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });
  afterEach(() => consoleError.mockRestore());

  it("shows a storage failure as one of Qashy's sentences, never the engine's text", async () => {
    const view = await renderProvider();
    expect(
      await view.findByText(
        "The local database is busy. Close other Qashy windows and try again.",
      ),
    ).toBeTruthy();
    expect(view.queryByText(/database is locked/)).toBeNull();
    expect(view.getByText("Try again")).toBeTruthy();
  });

  it("follows the Android per-app locale before the device language", async () => {
    mockEnv.perApp = "he-IL";
    mockEnv.device = ["en-US"];
    const view = await renderProvider();
    expect(
      await view.findByText(
        "מסד הנתונים המקומי עסוק. סגרו חלונות אחרים של Qashy ונסו שוב.",
      ),
    ).toBeTruthy();
    expect(view.getByText("נסו שוב")).toBeTruthy();
  });

  it("lets an English per-app locale win over a Hebrew device", async () => {
    mockEnv.perApp = "en-US";
    mockEnv.device = ["he-IL"];
    const view = await renderProvider();
    expect(await view.findByText("Try again")).toBeTruthy();
  });

  it("reads the legacy iw code as Hebrew, per app", async () => {
    mockEnv.perApp = "iw-IL";
    const view = await renderProvider();
    expect(await view.findByText("נסו שוב")).toBeTruthy();
  });

  it("reads the legacy iw code as Hebrew, per device", async () => {
    mockEnv.perApp = "";
    mockEnv.device = ["iw"];
    const view = await renderProvider();
    expect(await view.findByText("נסו שוב")).toBeTruthy();
  });

  it("falls back to the device language when there is no per-app choice", async () => {
    mockEnv.perApp = "";
    mockEnv.device = ["he"];
    const view = await renderProvider();
    await waitFor(() => expect(view.getByText("נסו שוב")).toBeTruthy());
  });

  it("translates a Qashy message", async () => {
    mockEnv.perApp = "he-IL";
    mockEnv.failure = new Error("Choose a valid account.");
    const view = await renderProvider();
    expect(await view.findByText("בחרו חשבון תקין.")).toBeTruthy();
  });

  it("hides a message nobody translated", async () => {
    mockEnv.perApp = "he-IL";
    mockEnv.failure = new Error("a message nobody translated");
    const view = await renderProvider();
    expect(
      await view.findByText(
        "משהו השתבש במסד הנתונים המקומי. הפעילו מחדש את Qashy ונסו שוב.",
      ),
    ).toBeTruthy();
    expect(view.queryByText(/nobody translated/)).toBeNull();
  });
});
