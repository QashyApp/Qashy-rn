import { render } from "@testing-library/react-native";
import type { ReactNode } from "react";
import * as Reanimated from "react-native-reanimated";

import { AnimationLevelContext } from "@/components/ui/animation-level-context";
import { ProgressBar } from "@/components/ui/progress-bar";
import { classicTheme } from "@/theme/themes/classic";

jest.mock("@/theme/theme", () => ({
  useQashyTheme: () => ({
    radius: jest.requireActual("@/theme/themes/classic").classicTheme.radius,
    motion: jest.requireActual("@/theme/themes/classic").classicTheme.motion,
    mode: "light",
    accent: "#3E63DD",
    staticAccent: "#3E63DD",
    surface: "#ffffff",
    materialControls: false,
  }),
}));
jest.mock("@/theme/materials", () => ({ materialStyle: () => ({}) }));
jest.mock("@/theme/highlight", () => ({ insetHighlight: () => undefined }));
jest.mock("@/localization/localization", () => ({
  useLocalization: () => ({ isRtl: false }),
}));

function wrapper(level: "all" | "minimal" | "off") {
  return function LevelWrapper({ children }: { children: ReactNode }) {
    return (
      <AnimationLevelContext.Provider value={level}>
        {children}
      </AnimationLevelContext.Provider>
    );
  };
}

describe("ProgressBar", () => {
  afterEach(() => jest.restoreAllMocks());

  it("pulses when a value crosses the default 100% milestone", async () => {
    const sequence = jest.spyOn(Reanimated, "withSequence");
    const view = await render(<ProgressBar value={0.5} />, {
      wrapper: wrapper("all"),
    });
    await view.rerender(<ProgressBar value={1.2} />);
    expect(sequence).toHaveBeenCalledTimes(1);
  });

  it("does not pulse or report a milestone when the bar opts out with an empty list", async () => {
    const sequence = jest.spyOn(Reanimated, "withSequence");
    const onMilestone = jest.fn();
    const view = await render(
      <ProgressBar value={0.5} milestones={[]} onMilestone={onMilestone} />,
      { wrapper: wrapper("all") },
    );
    await view.rerender(
      <ProgressBar value={1.2} milestones={[]} onMilestone={onMilestone} />,
    );
    expect(sequence).not.toHaveBeenCalled();
    expect(onMilestone).not.toHaveBeenCalled();
  });

  it("never lets the fill spring overshoot, and takes its feel from the theme", async () => {
    const spring = jest.spyOn(Reanimated, "withSpring");
    const view = await render(<ProgressBar value={0.2} />, {
      wrapper: wrapper("all"),
    });
    await view.rerender(<ProgressBar value={0.9} />);
    expect(spring).toHaveBeenCalledWith(
      0.9,
      expect.objectContaining({
        ...classicTheme.motion.spring.gentle,
        overshootClamping: true,
      }),
    );
  });
});
