import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import {
  RESUME_UNDO_MS,
  SCREEN_READER_UNDO_MS,
} from "@/components/ui/undo-duration";
import { UndoBar } from "@/components/ui/undo-bar";

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

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

// The bar is an unfocusable live region (and mid-entrance, so transparent): its text is the handle,
// and touch events bubble from it to the bar.
const bar = () => screen.getByText(/^Moved/, { includeHiddenElements: true });

describe("UndoBar countdown", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest
      .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
      .mockResolvedValue(false);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const mount = async (duration = 5000) => {
    const onDismiss = jest.fn();
    const view = await render(
      <UndoBar
        message="Moved 3"
        onAction={jest.fn()}
        onDismiss={onDismiss}
        duration={duration}
      />,
    );
    return { onDismiss, ...view };
  };

  it("dismisses after its duration", async () => {
    const { onDismiss } = await mount();
    await advance(4999);
    expect(onDismiss).not.toHaveBeenCalled();
    await advance(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("waits while touched and resumes with what was left", async () => {
    const { onDismiss } = await mount();
    await advance(1000);
    await fireEvent(bar(), "touchStart");
    await advance(60_000);
    expect(onDismiss).not.toHaveBeenCalled();
    await fireEvent(bar(), "touchEnd");
    // 4000 ms were left.
    await advance(3999);
    expect(onDismiss).not.toHaveBeenCalled();
    await advance(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("never resumes with less than there is time to act in", async () => {
    const { onDismiss } = await mount();
    await advance(4900);
    await fireEvent(bar(), "touchStart");
    await advance(10_000);
    await fireEvent(bar(), "touchEnd");
    await advance(RESUME_UNDO_MS - 1);
    expect(onDismiss).not.toHaveBeenCalled();
    await advance(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("stays held until every hold has let go", async () => {
    const { onDismiss } = await mount();
    await fireEvent(bar(), "touchStart");
    await fireEvent(screen.getByText("Undo"), "focus");
    await fireEvent(bar(), "touchEnd");
    await advance(30_000);
    expect(onDismiss).not.toHaveBeenCalled();
    await fireEvent(screen.getByText("Undo"), "blur");
    await advance(5000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("starts over for a new message", async () => {
    const { onDismiss, rerender } = await mount();
    await advance(4000);
    await rerender(
      <UndoBar
        message="Moved 4"
        onAction={jest.fn()}
        onDismiss={onDismiss}
        duration={5000}
      />,
    );
    await advance(4999);
    expect(onDismiss).not.toHaveBeenCalled();
    await advance(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("is not reset by a fresh onDismiss closure on every render", async () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = await render(
      <UndoBar message="Moved" onAction={jest.fn()} onDismiss={first} />,
    );
    await advance(3000);
    await rerender(
      <UndoBar message="Moved" onAction={jest.fn()} onDismiss={second} />,
    );
    await advance(2000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stays at least ten seconds with a screen reader running", async () => {
    jest
      .spyOn(AccessibilityInfo, "isScreenReaderEnabled")
      .mockResolvedValue(true);
    const { onDismiss } = await mount(5000);
    await advance(5000);
    expect(onDismiss).not.toHaveBeenCalled();
    await advance(SCREEN_READER_UNDO_MS - 5000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
