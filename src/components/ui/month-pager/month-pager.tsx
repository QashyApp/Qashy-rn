import { MonthPagerProps } from "@/components/ui/month-pager/pager-model";
import { PagerImpl } from "@/components/ui/month-pager/pager-impl";

/**
 * Previous / current / next month side by side. The drag tracks the finger 1:1, the
 * month being swiped toward slides in from its side, and release either commits
 * (a quarter of the width, or a flick that has travelled a little), decelerating into place
 * on a critically damped spring, or springs back on the same spring with the release velocity.
 * One haptic tick marks the drag crossing the commit distance (or the release of a flick); a tap
 * on the month switcher's arrows ticks as it is taken, so both feel the same.
 *
 * On web only touch drags swipe (mobile browsers, the installed PWA): mouse and pen are
 * inert so desktop text selection is untouched, and `touch-action: pan-y` leaves vertical
 * scrolling to the browser. A trackpad's sideways scroll steps one month per gesture. Web mounts
 * the neighbours only once a touch drag or wheel step is under way and unmounts them a moment
 * after the last one, so a plain page never holds duplicate content. Pages are mirrored for
 * right-to-left locales, the swipe is gated by the device-local `swipeBetweenMonths` setting,
 * and with reduced motion (or a lower Animations level) the pages still follow the finger 1:1
 * while the settle becomes a short crossfade.
 */
export function MonthPager(props: MonthPagerProps) {
  return <PagerImpl {...props} />;
}
