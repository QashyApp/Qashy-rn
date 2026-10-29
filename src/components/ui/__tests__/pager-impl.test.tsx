import { act, render, screen } from "@testing-library/react-native";
import { createRef } from "react";
import type { TestInstance } from "test-renderer";
import { Text } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AnimationLevelContext } from "@/components/ui/animation-level-context";
import { PagerImpl } from "@/components/ui/month-pager/pager-impl";
import type { AnimationLevel } from "@/domain/models";
import type { MonthPagerHandle } from "@/components/ui/month-pager/pager-model";

const mockSettings = { swipeBetweenMonths: false };

jest.mock("@/providers/finance-provider", () => ({
  useFinanceSettings: () => mockSettings,
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

/** Neighbours are hidden from accessibility, so they are looked up including hidden elements. */
const mounted = (month: string) =>
  screen.queryByText(month, { includeHiddenElements: true }) !== null;

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

/** Gives the pager a width, as its first layout would. */
const layout = async () => {
  let node: TestInstance | null = screen.getByText("2026-05-01");
  while (node && typeof node.props.onLayout !== "function") node = node.parent;
  const container = node;
  if (!container) throw new Error("pager container not found");
  await act(async () => {
    container.props.onLayout({ nativeEvent: { layout: { width: 400 } } });
  });
};

async function setup(onChange = jest.fn(), level: AnimationLevel = "all") {
  const ref = createRef<MonthPagerHandle>();
  await render(
    <AnimationLevelContext.Provider value={level}>
      <GestureHandlerRootView>
        <PagerImpl
          ref={ref}
          month="2026-05-01"
          onChange={onChange}
          renderPage={(month) => {
            return <Text>{month}</Text>;
          }}
        />
      </GestureHandlerRootView>
    </AnimationLevelContext.Provider>,
  );
  await layout();
  await advance(100);
  return { ref, onChange };
}

describe("PagerImpl neighbours", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockSettings.swipeBetweenMonths = false;
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("keeps the neighbouring months unmounted while swiping is off", async () => {
    await setup();
    expect(mounted("2026-04-01")).toBe(false);
    expect(mounted("2026-06-01")).toBe(false);
    expect(mounted("2026-05-01")).toBe(true);
  });

  it("warms the neighbours when swiping is on", async () => {
    mockSettings.swipeBetweenMonths = true;
    await setup();
    expect(mounted("2026-04-01")).toBe(true);
    expect(mounted("2026-06-01")).toBe(true);
  });

  it("mounts the neighbours for an arrow press, then lets them go again", async () => {
    const { ref, onChange } = await setup();
    let taken = false;
    await act(async () => {
      taken = ref.current?.goTo(1) ?? false;
    });
    expect(taken).toBe(true);
    // Mounted by the press, ahead of the slide that follows them.
    expect(mounted("2026-06-01")).toBe(true);
    expect(mounted("2026-04-01")).toBe(true);
    // The slide waits for them to render instead of cutting to the new month.
    expect(onChange).not.toHaveBeenCalled();
    await advance(100);
    expect(onChange).toHaveBeenCalledWith("2026-06-01", "right");
    await advance(2000);
    expect(mounted("2026-04-01")).toBe(false);
  });

  it("does not mount anything for a step the newest month refuses", async () => {
    const ref = createRef<MonthPagerHandle>();
    await render(
      <GestureHandlerRootView>
        <PagerImpl
          ref={ref}
          month="2026-05-01"
          max="2026-05-01"
          onChange={jest.fn()}
          renderPage={(month) => <Text>{month}</Text>}
        />
      </GestureHandlerRootView>,
    );
    await layout();
    await advance(100);
    let taken = true;
    await act(async () => {
      taken = ref.current?.goTo(1) ?? true;
    });
    expect(taken).toBe(false);
    expect(mounted("2026-04-01")).toBe(false);
  });

  it("mounts the new month before changing to it when animations are off", async () => {
    const { ref, onChange } = await setup(jest.fn(), "off");
    await act(async () => {
      ref.current?.goTo(-1);
    });
    // Landing on a page that is not rendered yet would show a blank list for a frame or more.
    expect(mounted("2026-04-01")).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    await advance(100);
    expect(onChange).toHaveBeenCalledWith("2026-04-01", "left");
  });
});
