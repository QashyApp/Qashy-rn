import { fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import type { TestInstance } from "test-renderer";

import { AnimationLevelContext } from "@/components/ui/animation-level-context";
import { MonthSwitcher } from "@/components/ui/month-switcher";
import type { AnimationLevel } from "@/domain/models";

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

jest.mock("@/services/haptics", () => ({ hapticSelection: jest.fn() }));

const switcher = (
  value: string,
  props: { max?: string } = {},
  onChange = jest.fn(),
) => <MonthSwitcher value={value} onChange={onChange} {...props} />;

/** The month title is the button that opens the picker. */
const title = () => screen.getByLabelText(/Choose month$/);

const action = async (name: string) =>
  fireEvent(title(), "accessibilityAction", {
    nativeEvent: { actionName: name },
  });

describe("MonthSwitcher accessibility", () => {
  let announce: jest.SpyInstance;
  beforeEach(() => {
    announce = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
  });
  afterEach(() => {
    announce.mockRestore();
  });

  it("steps through increment and decrement on the title", async () => {
    const onChange = jest.fn();
    await render(switcher("2026-05-01", {}, onChange));
    await action("increment");
    expect(onChange).toHaveBeenLastCalledWith("2026-06-01", "right");
    await action("decrement");
    expect(onChange).toHaveBeenLastCalledWith("2026-04-01", "left");
  });

  it("does not step past the newest month", async () => {
    const onChange = jest.fn();
    await render(switcher("2026-05-01", { max: "2026-05-01" }, onChange));
    await action("increment");
    expect(onChange).not.toHaveBeenCalled();
    await action("decrement");
    expect(onChange).toHaveBeenCalledWith("2026-04-01", "left");
  });

  it("announces the new month when it changes, not on first mount", async () => {
    const view = await render(switcher("2026-05-01"));
    expect(announce).not.toHaveBeenCalled();
    await view.rerender(switcher("2026-06-01"));
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(expect.stringContaining("June"));
    await view.rerender(switcher("2026-06-01"));
    expect(announce).toHaveBeenCalledTimes(1);
  });
});

describe("MonthSwitcher picker", () => {
  const openedModalAnimation = async (level: AnimationLevel) => {
    await render(
      <AnimationLevelContext.Provider value={level}>
        {switcher("2026-05-01")}
      </AnimationLevelContext.Provider>,
    );
    await fireEvent.press(title());
    // The picker's year buttons live inside the modal.
    let node: TestInstance | null = screen.getByLabelText("Previous year");
    while (node && node.props.animationType === undefined) node = node.parent;
    return node?.props.animationType;
  };

  it("fades in at the full level", async () => {
    expect(await openedModalAnimation("all")).toBe("fade");
  });

  it("appears at once when animations are off", async () => {
    expect(await openedModalAnimation("off")).toBe("none");
  });
});
