import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";

import {
  usePageSlide,
  type PageCascade,
} from "@/components/ui/month-pager/slide-context";
import {
  followStep,
  followerFor,
} from "@/components/ui/month-pager/slide-style";

/** The longest frame a follower integrates in one go (ms): a stalled frame must not throw it. */
const MAX_FRAME = 64;

/**
 * One moving part of a month page (an Overview card, a day of transactions). `order` is its
 * place from the top of the page, 0 first. A month swipe may move each part on its own (the
 * cascade style trails each one behind the one above). Inside a page it is the same animated view
 * in every style, so changing the style never remounts its content; there it only moves in the
 * cascade style. Outside a month page it is a plain view.
 */
export function MonthSlideItem({
  order,
  style,
  children,
}: {
  order: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const slide = usePageSlide();
  if (!slide) return <View style={style}>{children}</View>;
  return (
    <FollowingItem
      order={order}
      cascade={slide.cascade}
      following={slide.style === "cascade"}
      style={style}
    >
      {children}
    </FollowingItem>
  );
}

/** Marks the item as not yet seeded: its first reaction puts it exactly in its page. */
const UNSEEDED = Number.NaN;
/** What the follow reaction reads while the item is not following (any other style). */
const NOT_FOLLOWING = -2;

/**
 * Follows its page on a spring of its own, on the UI thread: stiffer for the top item, softer and
 * later further down. Its position is kept in the page's frame (`place`, px from the slot) and drawn
 * relative to the page, so the page can move however it likes underneath. Mounted anywhere, it starts
 * exactly in its page: until the first reaction seeds `place` from the page's offset (on the UI
 * thread, which a render may not read) it is drawn in place. When not `following` it does no work
 * and draws no offset.
 */
function FollowingItem({
  order,
  cascade,
  following,
  style,
  children,
}: {
  order: number;
  cascade: PageCascade;
  following: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { offset, clock, running, base, lag } = cascade;
  const { omega, zeta } = followerFor(order, base);
  // Where the item is, how fast it moves, and when it last moved.
  const place = useSharedValue(UNSEEDED);
  const speed = useSharedValue(0);
  const stamp = useSharedValue(0);

  useAnimatedReaction(
    () => (following ? (running.get() ? clock.get() : -1) : NOT_FOLLOWING),
    (tick, previous) => {
      if (tick === NOT_FOLLOWING) return;
      const target = offset.get();
      // At rest (and on mount): exactly in the page.
      if (tick < 0) {
        place.set(target);
        speed.set(0);
        return;
      }
      const now = performance.now();
      if (previous === null || previous < 0) {
        // The first tick of a run: no time has passed for this item yet. An item that was not
        // following (or has just mounted) starts from its page.
        if (previous === null || previous === NOT_FOLLOWING) {
          place.set(target);
          speed.set(0);
        }
        stamp.set(now);
        return;
      }
      const dt = Math.min(MAX_FRAME, Math.max(0, now - stamp.get())) / 1000;
      stamp.set(now);
      const x = place.get() - target;
      const v = speed.get();
      // Converged: still in its page, nothing to integrate until the page moves again.
      if (x === 0 && v === 0) return;
      const next = followStep(x, v, dt, omega, zeta, lag);
      place.set(target + next.x);
      speed.set(next.v);
    },
    [following, omega, zeta, lag],
  );

  const animated = useAnimatedStyle(() => {
    if (!following) return { transform: [{ translateX: 0 }] };
    const at = place.get();
    return {
      transform: [{ translateX: Number.isNaN(at) ? 0 : at - offset.get() }],
    };
  });
  return (
    <Animated.View collapsable={false} style={[style, animated]}>
      {children}
    </Animated.View>
  );
}
