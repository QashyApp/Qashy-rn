import { useMemo } from "react";
import {
  Easing,
  ReduceMotion,
  useReducedMotion,
} from "react-native-reanimated";

import { useAnimationLevel } from "@/components/ui/animation-level-context";
import { useQashyTheme } from "@/theme/theme";
import type { MotionSpec, SpringSpec } from "@/theme/themes/types";

// ── The motion system ───────────────────────────────────────────────────────
// One curve family, two durations, one travel distance, no overshoot. Motion
// here exists to explain a change, never to announce itself: content settles
// into the place it already belongs instead of flying in from off-screen, and
// nothing bounces — an overshoot on a surface the user did not physically drag
// is the single thing that makes an interface read as a toy.
export interface MotionDurations {
  /** Anything arriving or changing in place. */
  enter: number;
  /** Anything leaving. Exits are always faster than entrances. */
  exit: number;
  /** Reflow after an insert, delete, or resize. */
  layout: number;
}

/** Durations for a theme's motion spec. Pure, so tests and non-hook code can call it. */
export function motionDurationsFor(motion: MotionSpec): MotionDurations {
  return {
    enter: motion.duration.base,
    exit: motion.duration.fast,
    layout: motion.duration.base,
  };
}

/**
 * The in-app animation level and the system reduce-motion setting, folded into the two answers
 * every animation needs:
 *
 * - `instant`: nothing animates. True at the `off` level or under system reduce-motion. Pass
 *   `reduceMotion: instant ? ReduceMotion.Always : ReduceMotion.System` to Reanimated.
 * - `travel`: content may move or scale. False at `minimal` (quick fades only), at `off`, and
 *   under system reduce-motion. Opacity fades may still run when `travel` is false.
 *
 * This is the one place the two sources are combined. Every animated component reads it, so a
 * level change applies everywhere at once.
 */
export function useMotionPreference(): { instant: boolean; travel: boolean } {
  const systemReduce = useReducedMotion();
  const level = useAnimationLevel();
  const instant = systemReduce || level === "off";
  return { instant, travel: !instant && level === "all" };
}

/** The active theme's durations, shortened to quick fades at the `minimal` animation level. */
export function useMotionDurations(): MotionDurations {
  const { motion } = useQashyTheme();
  const level = useAnimationLevel();
  return useMemo(() => {
    const durations = motionDurationsFor(motion);
    if (level !== "minimal") return durations;
    return {
      enter: Math.min(durations.enter, motion.duration.fast),
      exit: Math.min(durations.exit, motion.duration.fast),
      layout: 0,
    };
  }, [motion, level]);
}

// How far anything travels while it fades. Small enough to read as a settle
// rather than a flight; the fade carries the change, the offset only hints at
// where it came from.
export const TRAVEL = 8;

// Reanimated's web implementation runs entering/exiting/layout through CSS, and
// it can only translate a bare `WebEasings` name or an `Easing.bezier`. A
// composed easing like `Easing.out(Easing.cubic)` is neither, so it warned
// "Selected easing is not currently supported on web" for every animated mount
// — dozens per screen — and then silently ran the animation *linear*. Both
// curves below are `Easing.bezier`, so they resolve identically on the CSS path
// and the worklet path and can be shared by every animation in the app.
export const EASE_STANDARD = Easing.bezier(0.2, 0, 0, 1);
export const EASE_EXIT = Easing.bezier(0.4, 0, 1, 1);
// A symmetric curve for things that go out and come back (a pulse, a toggle).
const EASE_IN_OUT = Easing.bezier(0.4, 0, 0.2, 1);

/** The shared curves, for `withTiming` calls outside this file. */
export const motionCurves = {
  standard: EASE_STANDARD,
  exit: EASE_EXIT,
  inOut: EASE_IN_OUT,
} as const;

/**
 * The press spring for a theme: its own `snappy` spring, clamped. Overshoot stays clamped: a control
 * the user did not drag must never visibly bounce past its resting shape. Pure, so tests and
 * non-hook code can call it.
 */
export function pressSpringFor(
  motion: MotionSpec,
  instant: boolean,
): PressSpring {
  return {
    ...motion.spring.snappy,
    overshootClamping: true,
    reduceMotion: instant ? ReduceMotion.Always : ReduceMotion.System,
  };
}

type PressSpring = SpringSpec & {
  overshootClamping: true;
  reduceMotion: ReduceMotion;
};

/**
 * The active theme's press spring, so a theme that slows or stiffens its own springs (High
 * contrast) reaches press feedback too. Stable between renders unless the theme or the motion
 * preference changes.
 */
export function usePressSpring(): PressSpring {
  const { motion } = useQashyTheme();
  const { instant } = useMotionPreference();
  return useMemo(() => pressSpringFor(motion, instant), [motion, instant]);
}
