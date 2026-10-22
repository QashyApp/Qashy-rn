import { type ReactNode, type Ref } from "react";
import { type ViewStyle } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import { type SharedValue } from "react-native-reanimated";

import type { MonthDirection } from "@/components/ui/month-switcher";
import { moveMonth } from "@/utils/date";

export const WEB = process.env.EXPO_OS === "web";

/**
 * Style for the scroll container inside a pager page. `touch-action` only counts up to the nearest
 * scroll container, so the pager's own `pan-y` is overridden by the page's scroller (`auto`) and
 * the browser claims horizontal drags (cancelling the pointer, or navigating history). The
 * scroller has to carry `pan-y` itself for a finger swipe to reach the gesture handler.
 */
export const PAGER_SCROLLER_STYLE: ViewStyle | undefined = WEB
  ? ({ touchAction: "pan-y" } as ViewStyle)
  : undefined;

/**
 * Where a pager's `dragProgress` rests on `month`. A screen seeds its shared value with this, so a
 * control placing names by the position is correct from its very first render, not only after
 * the pager's first write.
 */
export function restingPosition(month: string, isRtl: boolean) {
  return -monthIndex(month) * (isRtl ? -1 : 1);
}

/** A month's position on a continuous axis, so neighbouring months are exactly one apart. */
export function monthIndex(month: string) {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
}

/** The first day of the month at `index` on that axis (`YYYY-MM-01`). */
export function monthAtIndex(index: number) {
  const year = Math.floor((index - 1) / 12);
  const month = index - year * 12;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export interface MonthPagerHandle {
  /** Slide one month forward (`1`) or back (`-1`), exactly like a committed swipe. */
  goTo(direction: 1 | -1): void;
}

export interface MonthPageInfo {
  /** Only the current page should own scroll callbacks, scrolling and heavy content. */
  isCurrent: boolean;
}

type ExternalGesture = Parameters<
  ReturnType<typeof Gesture.Pan>["requireExternalGestureToFail"]
>[number];

export interface MonthPagerProps {
  /** First day of the current month (`YYYY-MM-01`). */
  month: string;
  /** First day of the newest allowed month. Omit to allow any future month. */
  max?: string;
  /** Renders only the current page and ignores the gesture. */
  disabled?: boolean;
  onChange: (month: string, direction: MonthDirection) => void;
  renderPage: (month: string, info: MonthPageInfo) => ReactNode;
  /**
   * Gestures (for example a horizontal `Gesture.Native()` scroller inside a page) that
   * must fail before a swipe may start, so inner horizontal scrolling wins.
   */
  blockedBy?: readonly ExternalGesture[];
  /**
   * Written with the pager's absolute position, in page widths: the drag (0 at rest, -1 once the
   * next month has slid fully in) minus the centre month's index (plus it, right-to-left). A
   * control outside the pager, such as the month title, places the month with index `k` at
   * `(k * sign + dragProgress)` page widths, so it moves with the same gesture and stays correct
   * through a month change.
   */
  dragProgress?: SharedValue<number>;
  /**
   * `false` keeps the page where it is: the swipe still tracks the finger, settles and commits
   * exactly the same, but only `dragProgress` moves, for a screen that slides just the parts
   * that change. No neighbouring pages are mounted and the page is not re-created per month.
   */
  slide?: boolean;
  style?: ViewStyle;
  ref?: Ref<MonthPagerHandle>;
}

/**
 * Routes a `MonthSwitcher` change through the pager so a tap on the previous or next
 * month slides exactly like a swipe, and anything farther (the picker) just jumps.
 */
export function navigateMonth(
  pager: MonthPagerHandle | null,
  current: string,
  next: string,
  direction: MonthDirection,
  jump: (month: string, direction: MonthDirection) => void,
) {
  if (pager && next === moveMonth(current, 1)) pager.goTo(1);
  else if (pager && next === moveMonth(current, -1)) pager.goTo(-1);
  else jump(next, direction);
}
