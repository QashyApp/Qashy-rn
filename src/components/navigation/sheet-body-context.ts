import { createContext, use } from "react";
import type { Gesture } from "react-native-gesture-handler";

/**
 * What a sheet body's scroll view needs to share its touches with the sheet.
 *
 * The Android sheet (`AndroidSheet`) lets the body be dragged as well as the header: a pull down
 * from the top of the content closes it, a pull up from the lower detent expands it, and anything
 * else is the scroll view's own scroll. For that the sheet has to know the scroll offset and its
 * pan has to run beside the scroll view's, so a scroll view in a sheet:
 *
 * 1. wraps itself in a `GestureDetector` with `scrollGesture`,
 * 2. reports its content offset through `reportOffset` on every scroll event,
 * 3. calls `register` while it is mounted (the returned function unregisters), and
 * 4. gives `scrollEnabled` to the scroll view: it is false while the sheet sits below its top
 *    detent, where an upward drag expands the sheet instead of scrolling the content.
 *
 * A body that never registers keeps the header as its only drag handle, so a scroll view the sheet
 * knows nothing about is never pulled out from under the user's finger.
 */
export interface SheetBody {
  scrollGesture: ReturnType<typeof Gesture.Native>;
  scrollEnabled: boolean;
  reportOffset: (offsetY: number) => void;
  register: () => () => void;
}

export const SheetBodyContext = createContext<SheetBody | null>(null);

/** The sheet body's scroll hand-off, or null outside the Android sheet (web and native sheets). */
export function useSheetBody() {
  return use(SheetBodyContext);
}
