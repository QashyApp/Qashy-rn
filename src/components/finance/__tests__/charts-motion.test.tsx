import { fireEvent, render } from "@testing-library/react-native";
import { useRef, type ReactNode } from "react";
import * as Reanimated from "react-native-reanimated";

import { CategoryDonut, SpendLineChart } from "@/components/finance/charts";
import { AnimationLevelContext } from "@/components/ui/animation-level-context";
import { classicTheme } from "@/theme/themes/classic";
import type { DashboardSummary } from "@/domain/models";

jest.mock("@/theme/theme", () => ({
  useQashyTheme: () => {
    const classic = jest.requireActual("@/theme/themes/classic").classicTheme;
    return {
      space: classic.space,
      radius: classic.radius,
      motion: classic.motion,
      charts: classic.charts,
      type: classic.type,
      accent: "#3E63DD",
      border: "#dddddd",
      text: "#111111",
      textMuted: "#666666",
      surfaceSunken: "#f2f2f2",
      staticSurface: "#ffffff",
    };
  },
}));

jest.mock("@/localization/localization", () => ({
  useLocalization: () => ({
    t: (message: string) => message,
    isRtl: false,
    language: "en",
    locale: "en-US",
  }),
}));

const points = [
  { date: "2020-01-01", amountMinor: 1000 },
  { date: "2020-01-02", amountMinor: 2500 },
  { date: "2020-01-03", amountMinor: 0 },
] as unknown as DashboardSummary["dailySpend"];

const items = [
  { category: { id: "a", name: "Food", color: "#E5484D" }, amountMinor: 5000 },
  { category: { id: "b", name: "Rent", color: "#3E63DD" }, amountMinor: 3000 },
] as unknown as DashboardSummary["categorySpend"];

function wrapper(level: "all" | "minimal" | "off") {
  return function LevelWrapper({ children }: { children: ReactNode }) {
    return (
      <AnimationLevelContext.Provider value={level}>
        {children}
      </AnimationLevelContext.Provider>
    );
  };
}

const { slow, fast } = classicTheme.motion.duration;

describe("chart reveal motion", () => {
  afterEach(() => jest.restoreAllMocks());

  describe.each([
    [
      "line",
      <SpendLineChart key="l" points={points} currency="USD" locale="en-US" />,
    ],
    [
      "donut",
      <CategoryDonut key="d" items={items} currency="USD" locale="en-US" />,
    ],
  ])("%s", (_name, chart) => {
    it("draws over the theme's slow duration at the full level", async () => {
      const timing = jest.spyOn(Reanimated, "withTiming");
      await render(chart, { wrapper: wrapper("all") });
      expect(timing).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ duration: slow }),
      );
    });

    it("only fades, quickly, at the minimal level", async () => {
      const timing = jest.spyOn(Reanimated, "withTiming");
      await render(chart, { wrapper: wrapper("minimal") });
      expect(timing).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ duration: fast }),
      );
      expect(timing).not.toHaveBeenCalledWith(
        1,
        expect.objectContaining({ duration: slow }),
      );
    });

    it("is drawn immediately when animations are off", async () => {
      const timing = jest.spyOn(Reanimated, "withTiming");
      await render(chart, { wrapper: wrapper("off") });
      expect(timing).not.toHaveBeenCalled();
    });
  });

  it("does not replay the line's draw when only its width changes", async () => {
    // Reanimated's mock hands back a new shared value every render, which would re-run any
    // effect that lists it; the real one is stable, so the test makes it so.
    jest.spyOn(Reanimated, "useSharedValue").mockImplementation(
      ((initial: unknown) =>
        useRef({
          value: initial,
          get() {
            return this.value;
          },
          set(next: unknown) {
            this.value = next;
          },
        }).current) as unknown as typeof Reanimated.useSharedValue,
    );
    const timing = jest.spyOn(Reanimated, "withTiming");
    const view = await render(
      <SpendLineChart points={points} currency="USD" locale="en-US" />,
      { wrapper: wrapper("all") },
    );
    const drawsBefore = timing.mock.calls.length;
    expect(drawsBefore).toBeGreaterThan(0);
    const chart = view.getByLabelText(/Daily spending/);
    await fireEvent(chart, "layout", {
      nativeEvent: { layout: { width: 333, height: 174 } },
    });
    await fireEvent(chart, "layout", {
      nativeEvent: { layout: { width: 411, height: 174 } },
    });
    expect(timing.mock.calls.length).toBe(drawsBefore);
  });

  it("replays the line's draw when its data changes", async () => {
    const timing = jest.spyOn(Reanimated, "withTiming");
    const view = await render(
      <SpendLineChart points={points} currency="USD" locale="en-US" />,
      { wrapper: wrapper("all") },
    );
    const drawsBefore = timing.mock.calls.length;
    await view.rerender(
      <SpendLineChart
        points={points.map((point) => ({
          ...point,
          amountMinor: point.amountMinor + 100,
        }))}
        currency="USD"
        locale="en-US"
      />,
    );
    expect(timing.mock.calls.length).toBeGreaterThan(drawsBefore);
  });
});
