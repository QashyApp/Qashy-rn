import { MonthPagerProps } from "@/components/ui/month-pager/pager-model";
import { PagerImpl } from "@/components/ui/month-pager/pager-impl";

/**
 * Previous / current / next month side by side. The drag tracks the finger 1:1, the
 * month being swiped toward slides in from its side, and release either commits
 * (a quarter of the width, or a flick), decelerating into place on a critically damped
 * spring, or springs back.
 *
 * On web only touch drags swipe (mobile browsers, the installed PWA): mouse and pen are
 * inert so desktop text selection is untouched, and `touch-action: pan-y` leaves vertical
 * scrolling to the browser. Web mounts the neighbours only once a touch drag is under way,
 * so a plain page never holds duplicate content. Pages are mirrored for right-to-left locales, the swipe is
 * gated by the device-local `swipeBetweenMonths` setting, and with reduced motion the
 * slide becomes a short crossfade.
 */
export function MonthPager(props: MonthPagerProps) {
  return <PagerImpl {...props} />;
}
