import { createContext, use } from "react";

import type { AnimationLevel } from "@/domain/models";

/** Kept free of provider imports so the motion primitives can read it without a dependency cycle. */
export const AnimationLevelContext = createContext<AnimationLevel>("all");

/**
 * The in-app animation level: `all` is the full motion system, `minimal` keeps only quick fades
 * (no travel, scaling or layout movement), `off` changes things instantly.
 *
 * It only ever turns motion down. The system's reduced-motion setting is applied separately, at
 * every animation, and always wins over `all`.
 */
export function useAnimationLevel(): AnimationLevel {
  return use(AnimationLevelContext);
}
