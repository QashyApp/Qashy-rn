import { ReduceMotion } from "react-native-reanimated";

import { pressSpringFor } from "@/components/ui/motion/durations";
import { classicTheme } from "@/theme/themes/classic";
import { highContrastTheme } from "@/theme/themes/high-contrast";

describe("pressSpringFor", () => {
  it("is the theme's own snappy spring, so a theme that changes its springs reaches press feedback", () => {
    const classic = pressSpringFor(classicTheme.motion, false);
    const contrast = pressSpringFor(highContrastTheme.motion, false);
    expect(classic).toMatchObject(classicTheme.motion.spring.snappy);
    expect(contrast).toMatchObject(highContrastTheme.motion.spring.snappy);
    expect(contrast).not.toEqual(classic);
  });

  it("never overshoots, and follows the motion preference", () => {
    expect(pressSpringFor(classicTheme.motion, false)).toMatchObject({
      overshootClamping: true,
      reduceMotion: ReduceMotion.System,
    });
    expect(pressSpringFor(classicTheme.motion, true).reduceMotion).toBe(
      ReduceMotion.Always,
    );
  });
});
