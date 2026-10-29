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
 * cascade style trails each one behind the one above); outside a month page, and in every other
 * style or at reduced motion, it is a plain view.
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
  const cascade = usePageSlide()?.cascade;
  if (!cascade) return <View style={style}>{children}</View>;
  return (
    <FollowingItem order={order} cascade={cascade} style={style}>
      {children}
    </FollowingItem>
  );
}

/**
 * Follows its page on a spring of its own, on the UI thread: stiffer for the top item, softer and
 * later further down. Its position is kept in the page's frame (`place`, px from the slot) and drawn
 * relative to the page, so the page can move however it likes underneath. Mounted anywhere, it starts
 * exactly in its page.
 */
function FollowingItem({
  order,
  cascade,
  style,
  children,
}: {
  order: number;
  cascade: PageCascade;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { offset, clock, running, base, lag } = cascade;
  const { omega, zeta } = followerFor(order, base);
  // Where the item is, how fast it moves, and when it last moved.
  const place = useSharedValue(0);
  const speed = useSharedValue(0);
  const stamp = useSharedValue(0);

  useAnimatedReaction(
    () => (running.get() ? clock.get() : -1),
    (tick, previous) => {
      const target = offset.get();
      // At rest (and on mount): exactly in the page.
      if (tick < 0) {
        place.set(target);
        speed.set(0);
        return;
      }
      const now = performance.now();
      if (previous === null || previous < 0) {
        // The first tick of a run: no time has passed for this item yet.
        if (previous === null) {
          place.set(target);
          speed.set(0);
        }
        stamp.set(now);
        return;
      }
      const dt = Math.min(MAX_FRAME, Math.max(0, now - stamp.get())) / 1000;
      stamp.set(now);
      const next = followStep(
        place.get() - target,
        speed.get(),
        dt,
        omega,
        zeta,
        lag,
      );
      place.set(target + next.x);
      speed.set(next.v);
    },
    [omega, zeta, lag],
  );

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: place.get() - offset.get() }],
  }));
  return (
    <Animated.View collapsable={false} style={[style, animated]}>
      {children}
    </Animated.View>
  );
}
