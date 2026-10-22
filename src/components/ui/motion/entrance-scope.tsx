import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { View, type ViewProps } from "react-native";

import { useAnimationLevel } from "@/components/ui/animation-level-context";

type SettledRef = { current: boolean };

const ScreenEntranceContext = createContext<SettledRef | null>(null);

const NEVER_SETTLED: SettledRef = { current: false };

/**
 * Whether `exit` elements may fade out when removed. Off inside a pager page that is being paged
 * away: the page is removed as a whole, and its exits would linger as ghosts over the next month.
 */
export const ExitContext = createContext(true);

/**
 * Whether `animateLayout` elements may run their layout transition right now. Off inside a
 * pager page while it is a neighbour or has only just become current: the page itself is
 * what moves, and a card transitioning on its own looks detached from the rest of the page.
 */
export const LayoutTransitionContext = createContext(true);

/**
 * Suppresses the per-element entrances of anything that mounts beneath it while
 * `suppressed` is true. A pager's neighbouring page arrives through the pager's
 * own slide; letting its month-keyed entrances play as well read as a second,
 * smaller swipe. The tree shape never depends on `suppressed`, so a neighbour
 * that becomes the current page keeps its instances and does not replay anything.
 */
export function EntranceScope({
  suppressed,
  settled,
  layoutTransitions = true,
  exits = true,
  children,
}: {
  suppressed: boolean;
  /**
   * Read at mount like the screen's own flag: entrances beneath only play once this is true
   * (and the screen has settled). A pager page uses it so a page that mounts already current
   * arrives without replaying its entrances.
   */
  settled?: SettledRef;
  /** False pauses the layout transitions of `animateLayout` elements beneath it. */
  layoutTransitions?: boolean;
  /** False removes `exit` elements beneath it instantly instead of fading them out. */
  exits?: boolean;
  children: ReactNode;
}) {
  const parent = useContext(ScreenEntranceContext);
  const parentLayout = useContext(LayoutTransitionContext);
  const parentExits = useContext(ExitContext);
  const combined = useMemo<SettledRef | null>(
    () =>
      settled
        ? {
            get current() {
              return settled.current && (parent === null || parent.current);
            },
          }
        : parent,
    [settled, parent],
  );
  return (
    <ScreenEntranceContext.Provider
      value={suppressed ? NEVER_SETTLED : combined}
    >
      <LayoutTransitionContext.Provider
        value={parentLayout && layoutTransitions}
      >
        <ExitContext.Provider value={parentExits && exits}>
          {children}
        </ExitContext.Provider>
      </LayoutTransitionContext.Provider>
    </ScreenEntranceContext.Provider>
  );
}

/**
 * Whether a self-drawing element (a chart reveal, a progress fill) may animate right now, as a
 * ref read inside effects. False inside a pager page that is a neighbour or has only just
 * become current: such an element should arrive already drawn, moving only with its page.
 * A ref, so the page settling never re-runs the effects that read it.
 */
export function usePageMotionRef(): { readonly current: boolean } {
  const allowed = useContext(LayoutTransitionContext);
  // Also held back while the screen is still loading: a chart on a freshly opened tab arrives
  // drawn, and only later data changes animate it.
  const screen = useContext(ScreenEntranceContext);
  const allowedRef = useRef(allowed);
  useLayoutEffect(() => {
    allowedRef.current = allowed;
  });
  return useMemo(
    () => ({
      get current() {
        return allowedRef.current && (screen === null || screen.current);
      },
    }),
    [screen],
  );
}

/**
 * Whether a self-drawing element may play its first reveal, decided once at mount. When it may
 * not, the element should start already drawn rather than spend a frame empty.
 */
export function useRevealAllowedAtMount(): boolean {
  const allowed = useContext(LayoutTransitionContext);
  const screen = useContext(ScreenEntranceContext);
  const [allowedAtMount] = useState(
    () => allowed && (screen === null || screen.current),
  );
  return allowedAtMount;
}

/**
 * How long a freshly mounted screen holds back entrances and self-drawing reveals. Generous on
 * purpose: Overview's cards and charts mount several frames after the screen (they wait for
 * their own layout and data), and none of that first load should animate.
 */
const SCREEN_SETTLE_MS = 450;

/**
 * Wraps a screen's content and suppresses the per-element entrances and reveals underneath it
 * while it first loads, so a freshly opened screen simply appears.
 */
export function ScreenTransition({ style, ...props }: ViewProps) {
  const settled = useRef(false);
  // An enclosing scope (a pager page that is a neighbour or not yet settled) still holds back.
  const parent = useContext(ScreenEntranceContext);
  const combined = useMemo<SettledRef>(
    () =>
      parent
        ? {
            get current() {
              return settled.current && parent.current;
            },
          }
        : settled,
    [parent],
  );

  useEffect(() => {
    // Long enough to cover children that mount after measuring themselves or loading data.
    const timer = setTimeout(() => {
      settled.current = true;
    }, SCREEN_SETTLE_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <ScreenEntranceContext.Provider value={combined}>
      <View {...props} style={style} />
    </ScreenEntranceContext.Provider>
  );
}

/**
 * Whether an element that is mounting right now has earned an entrance.
 *
 * Reanimated fires `entering` whenever a node mounts, and navigating to a tab
 * mounts every node on that screen at once — so the whole screen replayed its
 * choreography on every single visit. That reads as a performance rather than a
 * response. Inside a `ScreenTransition`, anything mounting as part of the
 * screen's first paint skips its entrance and simply arrives with the screen's
 * own cross-fade; anything mounting *later* — a new transaction, an expanded
 * section, a filter result — still animates, because there the motion is
 * feedback for something the user just did.
 *
 * The answer is captured once, at mount, so an element that arrived with the
 * screen cannot start animating later just because it re-rendered.
 */
export function useEntranceAllowed(enabled: boolean) {
  const settled = useContext(ScreenEntranceContext);
  const level = useAnimationLevel();
  const [allowedAtMount] = useState(() => settled === null || settled.current);
  return enabled && allowedAtMount && level !== "off";
}
