import {
  useAnimatedReaction,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";

/**
 * How far (in months) an element drawn for month `index` sits from the pager's `position`,
 * read on the UI thread. Every element that slides with a month pager (a page, a month title)
 * places itself with this, from its own fixed month and the shared position, so what an element
 * shows and where it is drawn can never come from two different moments: React may re-render
 * the month whenever it likes and nothing moves.
 *
 * The one exception is an element that mounts as the current month while the position is still
 * elsewhere (a jump from the month picker, or a page mounted late). React mounts it before the
 * new position reaches the UI thread, which would draw it a frame off-screen. It stays pinned at
 * the centre instead until the position arrives.
 */
export function useMonthSlot(
  index: number,
  position: SharedValue<number>,
  current: boolean,
) {
  // Read at mount only: an element that is already on screen is never pinned later.
  const pinned = useSharedValue(current);
  useAnimatedReaction(
    () => Math.abs(position.get() - index) < 0.001,
    (arrived) => {
      if (arrived && pinned.get()) pinned.set(false);
    },
    [index],
  );
  return pinned;
}

/** The slot distance a {@link useMonthSlot} element is drawn at. */
export function slotDistance(
  index: number,
  position: SharedValue<number>,
  pinned: SharedValue<boolean>,
) {
  "worklet";
  return pinned.get() ? 0 : index - position.get();
}
