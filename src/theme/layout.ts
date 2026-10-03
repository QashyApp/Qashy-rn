import { createContext, use } from "react";
import { useWindowDimensions } from "react-native";

import type { SpaceScale } from "@/theme/themes/types";

const IS_WEB = process.env.EXPO_OS === "web";

/** At or above this viewport width the web shell shows a rail instead of the bottom bar. */
export const NAV_RAIL_BREAKPOINT = 768;
/** At or above this viewport width the rail expands from icons into the full sidebar. */
export const NAV_SIDEBAR_BREAKPOINT = 1200;
export const NAV_RAIL_WIDTH = 84;
export const NAV_SIDEBAR_WIDTH = 244;

/** Horizontal space the persistent web navigation takes away from screen content. */
export function navigationRailWidth(windowWidth: number) {
  if (!IS_WEB || windowWidth < NAV_RAIL_BREAKPOINT) return 0;
  return windowWidth < NAV_SIDEBAR_BREAKPOINT
    ? NAV_RAIL_WIDTH
    : NAV_SIDEBAR_WIDTH;
}

/**
 * The width of the box a screen actually renders into.
 *
 * The web shell publishes this so screens stop deriving their layout from the
 * window. A screen sitting beside the 84px rail has ~84px less room than
 * `useWindowDimensions` reports, so window-derived breakpoints fired early: a
 * 900px window switched Overview to two columns inside an 816px box, and the
 * chart's pre-measurement estimate was a rail too wide and snapped once it
 * measured itself.
 *
 * Routes outside the shell (onboarding, form sheets, not-found) have no
 * provider above them, and the null default correctly falls back to the window.
 */
export const ContentWidthContext = createContext<number | null>(null);

/** Height of the inset floating tab bar (Android "floating" navigation style). */
export const FLOATING_BAR_HEIGHT = 64;

/**
 * How much of the bottom edge the floating tab bar covers (safe-area inset, its own margin and its
 * height). The tabs layout provides it while the floating bar is showing; everywhere else it is 0.
 * It is the single source for every bottom offset that has to clear the bar: scroll padding, the
 * FAB, the batch bar and the undo bar.
 */
export const BottomBarClearanceContext = createContext(0);

export function floatingBarClearance(safeBottom: number, margin: number) {
  return safeBottom + margin + FLOATING_BAR_HEIGHT;
}

export interface BottomChromeInset {
  /** Distance from the screen bottom to the resting floating action button. */
  overlayBottom: number;
  /** The transient batch-selection bar, which takes the FAB's spot while open. */
  batchBarBottom: number;
  /** An undo snackbar stacked above the FAB. */
  stackedOverlayBottom: number;
  /** Bottom padding that scrolls the last row clear of the FAB and the bar. */
  contentPaddingBottom: number;
}

/**
 * Pure resolver for every bottom offset that depends on the navigation chrome. The three cases are the
 * floating Android bar, the web bottom bar, and a docked native bar that reserves its own space.
 */
export function resolveBottomChromeInset(
  metrics: Pick<ScreenMetrics, "hasBottomNavigation" | "floatingBarClearance">,
  safeBottom: number,
  space: SpaceScale,
): BottomChromeInset {
  if (metrics.floatingBarClearance > 0) {
    const overlayBottom = metrics.floatingBarClearance + space.lg;
    return {
      overlayBottom,
      batchBarBottom: overlayBottom,
      stackedOverlayBottom: overlayBottom + 64,
      contentPaddingBottom: overlayBottom + 80 + space.lg,
    };
  }
  const stackedOverlayBottom = safeBottom + space.xxl + 64;
  if (metrics.hasBottomNavigation) {
    return {
      overlayBottom: 92 + safeBottom,
      batchBarBottom: 92 + safeBottom,
      stackedOverlayBottom,
      contentPaddingBottom: 160 + safeBottom,
    };
  }
  return {
    overlayBottom: space.xxl + (IS_WEB ? safeBottom : 0),
    batchBarBottom: space.xxl + safeBottom,
    stackedOverlayBottom,
    contentPaddingBottom: space.xxxl + 80,
  };
}

export interface ScreenMetrics {
  /** Bottom area the floating tab bar covers, or 0 when none floats over the content. */
  floatingBarClearance: number;
  /** The viewport. Use only for things anchored to the viewport, not to content. */
  windowWidth: number;
  /** The room a screen has to lay itself out in. Use this for layout breakpoints. */
  contentWidth: number;
  /** True while the rail or sidebar takes horizontal space beside the content. */
  hasNavigationRail: boolean;
  /** True while the web bottom bar floats over the end of the content. */
  hasBottomNavigation: boolean;
  /**
   * True while the expanded sidebar is showing, which is the only place with
   * room for a permanent primary action. Screens use it to stand their floating
   * button down: a FAB is a mobile answer to "there is nowhere else to put
   * this", and on a desktop with a 244px sidebar that is no longer true.
   */
  hasSidebar: boolean;
}

export function useScreenMetrics(): ScreenMetrics {
  const { width } = useWindowDimensions();
  const provided = use(ContentWidthContext);
  const floatingBarClearance = use(BottomBarClearanceContext);
  const contentWidth = provided ?? width;
  return {
    windowWidth: width,
    floatingBarClearance,
    contentWidth,
    hasNavigationRail: contentWidth < width,
    hasBottomNavigation:
      IS_WEB && provided !== null && width < NAV_RAIL_BREAKPOINT,
    hasSidebar: IS_WEB && provided !== null && width >= NAV_SIDEBAR_BREAKPOINT,
  };
}
