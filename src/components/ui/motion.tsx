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
import {
  Platform,
  Pressable,
  StyleSheet,
  type ColorValue,
  View,
  type PointerEvent,
  type PressableProps,
  type PressableStateCallbackType,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { useAnimationLevel } from "@/components/ui/animation-level-context";
import {
  useStateLayerBounds,
  type StateLayerBounds,
} from "@/components/ui/state-layer-bounds";
import { useQashyTheme } from "@/theme/theme";
import type { MotionSpec } from "@/theme/themes/types";

// ── The motion system ───────────────────────────────────────────────────────
// One curve family, two durations, one travel distance, no overshoot. Motion
// here exists to explain a change, never to announce itself: content settles
// into the place it already belongs instead of flying in from off-screen, and
// nothing bounces — an overshoot on a surface the user did not physically drag
// is the single thing that makes an interface read as a toy.
export interface MotionDurations {
  /** Anything arriving or changing in place. */
  enter: number;
  /** Anything leaving. Exits are always faster than entrances. */
  exit: number;
  /** Reflow after an insert, delete, or resize. */
  layout: number;
}

/** Durations for a theme's motion spec. Pure, so tests and non-hook code can call it. */
export function motionDurationsFor(motion: MotionSpec): MotionDurations {
  return {
    enter: motion.duration.base,
    exit: motion.duration.fast,
    layout: motion.duration.base,
  };
}

/**
 * The in-app animation level and the system reduce-motion setting, folded into the two answers
 * every animation needs:
 *
 * - `instant`: nothing animates. True at the `off` level or under system reduce-motion. Pass
 *   `reduceMotion: instant ? ReduceMotion.Always : ReduceMotion.System` to Reanimated.
 * - `travel`: content may move or scale. False at `minimal` (quick fades only), at `off`, and
 *   under system reduce-motion. Opacity fades may still run when `travel` is false.
 *
 * This is the one place the two sources are combined. Every animated component reads it, so a
 * level change applies everywhere at once.
 */
export function useMotionPreference(): { instant: boolean; travel: boolean } {
  const systemReduce = useReducedMotion();
  const level = useAnimationLevel();
  const instant = systemReduce || level === "off";
  return { instant, travel: !instant && level === "all" };
}

/** The active theme's durations, shortened to quick fades at the `minimal` animation level. */
export function useMotionDurations(): MotionDurations {
  const { motion } = useQashyTheme();
  const level = useAnimationLevel();
  return useMemo(() => {
    const durations = motionDurationsFor(motion);
    if (level !== "minimal") return durations;
    return {
      enter: Math.min(durations.enter, motion.duration.fast),
      exit: Math.min(durations.exit, motion.duration.fast),
      layout: 0,
    };
  }, [motion, level]);
}

// How far anything travels while it fades. Small enough to read as a settle
// rather than a flight; the fade carries the change, the offset only hints at
// where it came from.
const TRAVEL = 8;

// Reanimated's web implementation runs entering/exiting/layout through CSS, and
// it can only translate a bare `WebEasings` name or an `Easing.bezier`. A
// composed easing like `Easing.out(Easing.cubic)` is neither, so it warned
// "Selected easing is not currently supported on web" for every animated mount
// — dozens per screen — and then silently ran the animation *linear*. Both
// curves below are `Easing.bezier`, so they resolve identically on the CSS path
// and the worklet path and can be shared by every animation in the app.
const EASE_STANDARD = Easing.bezier(0.2, 0, 0, 1);
const EASE_EXIT = Easing.bezier(0.4, 0, 1, 1);
// A symmetric curve for things that go out and come back (a pulse, a toggle).
const EASE_IN_OUT = Easing.bezier(0.4, 0, 0.2, 1);

/** The shared curves, for `withTiming` calls outside this file. */
export const motionCurves = {
  standard: EASE_STANDARD,
  exit: EASE_EXIT,
  inOut: EASE_IN_OUT,
} as const;

// Dew's press spring: a touch more energy than the old soft language — higher stiffness and a
// little less mass — so a tap lands its sink quickly. Overshoot stays clamped: a control the
// user did not drag must never visibly bounce past its resting shape.
const springConfig = {
  damping: 18,
  stiffness: 430,
  mass: 0.66,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
} as const;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// PressableStateCallbackType in RN 0.86 is { pressed: boolean } only. The motion
// system tracks hover separately via onHoverIn/Out and the shared values below, so
// extend the type locally rather than pretending RN provides it.
type ExtendedPressableState = PressableStateCallbackType & { hovered: boolean };

type HoverEvent = Parameters<NonNullable<PressableProps["onHoverIn"]>>[0];
const REST_STATE: ExtendedPressableState = { pressed: false, hovered: false };
const PRESSED_STATE: ExtendedPressableState = { pressed: true, hovered: false };
const HOVERED_STATE: ExtendedPressableState = { pressed: false, hovered: true };

export type MotionVariant = "fade" | "up" | "down" | "left" | "right" | "zoom";
// Moved onto the animated wrapper: box-model and flex participation belong to
// the outer element, otherwise the wrapper collapses to content size and a
// `flex: 1` pressable has nothing to fill.
const wrapperStyleKeys = [
  "alignSelf",
  "bottom",
  "display",
  "end",
  "flex",
  "flexBasis",
  "flexGrow",
  "flexShrink",
  "left",
  "margin",
  "marginBlock",
  "marginBlockEnd",
  "marginBlockStart",
  "marginBottom",
  "marginEnd",
  "marginHorizontal",
  "marginInline",
  "marginInlineEnd",
  "marginInlineStart",
  "marginLeft",
  "marginRight",
  "marginStart",
  "marginTop",
  "marginVertical",
  "position",
  "right",
  "start",
  "top",
  "zIndex",
] as const satisfies readonly (keyof ViewStyle)[];

// Mirrored onto the wrapper but kept on the pressable, so the wrapper cannot
// shrink below an explicitly sized control and a percentage size still resolves
// against the real parent. The min/max pair matters the same way: a capped node
// centred by `alignSelf` would otherwise left-align inside a full-width wrapper.
const mirroredStyleKeys = [
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
] as const satisfies readonly (keyof ViewStyle)[];

const wrapperStyleKeySet: ReadonlySet<string> = new Set<string>(
  wrapperStyleKeys,
);

/**
 * `StyleSheet.flatten` for plain styles. RN 0.88 types the parameter with its imprecise
 * *animated* style union, which lags `ViewStyle` (`transitionDuration` gained `string[]`),
 * so a plain style no longer satisfies it even though it is exactly what the runtime wants.
 */
export function flattenViewStyle(style: ViewProps["style"]): ViewStyle {
  return (StyleSheet.flatten(
    style as unknown as Parameters<typeof StyleSheet.flatten>[0],
  ) ?? {}) as ViewStyle;
}

function splitWrapperStyle(style: ViewProps["style"]) {
  const flattenedStyle = flattenViewStyle(style);
  const wrapperStyle: ViewStyle = {};
  const contentStyle: ViewStyle = { ...flattenedStyle };
  wrapperStyleKeys.forEach((key) => {
    const value = flattenedStyle[key];
    if (value === undefined) return;
    Object.assign(wrapperStyle, { [key]: value });
    delete contentStyle[key];
  });
  mirroredStyleKeys.forEach((key) => {
    const value = flattenedStyle[key];
    if (value === undefined) return;
    Object.assign(wrapperStyle, { [key]: value });
  });
  return { wrapperStyle, contentStyle };
}

/**
 * Reanimated can only carry primitives across to the UI thread. A PlatformColor
 * (Material You) is an opaque object, so a style that swaps one on press has to
 * stay on the JS thread.
 */
function isWorkletSafe(value: unknown) {
  return typeof value === "number" || typeof value === "string";
}

// Where each variant starts before it settles into place. The presets ship with
// a 25px offset and ZoomIn starts from scale 0, which is what made every mount
// look like it was being performed.
const ENTRANCE_START: Record<
  MotionVariant,
  { translateX: number; translateY: number; scale: number }
> = {
  fade: { translateX: 0, translateY: 0, scale: 1 },
  up: { translateX: 0, translateY: -TRAVEL, scale: 1 },
  down: { translateX: 0, translateY: TRAVEL, scale: 1 },
  left: { translateX: -TRAVEL, translateY: 0, scale: 1 },
  right: { translateX: TRAVEL, translateY: 0, scale: 1 },
  zoom: { translateX: 0, translateY: 0, scale: 0.94 },
};

/**
 * The entrance, driven by a shared value rather than Reanimated's `entering`.
 *
 * Softening the presets used to mean `withInitialValues`, which makes Reanimated
 * generate a keyframe whose name is not in its built-in `Animations` registry.
 * On web that is the one branch of `setElementAnimation` that schedules cleanup,
 * and cleanup for an ENTERING animation calls `setElementPosition` — so roughly
 * 200ms after mount every softened element was permanently given
 * `position: absolute` and a snapshot `top/left/width/height`. Content dropped
 * out of flow across the whole site: button labels landed outside their button,
 * which then collapsed to its own padding.
 *
 * A shared value reaches the same start states without generating a keyframe,
 * and runs identically on the worklet path and on web. `exiting` and `layout`
 * stay on Reanimated: they need an element the tree no longer owns, and neither
 * goes through the branch above.
 */
function useEntrance(
  variant: MotionVariant,
  delay: number,
  duration: number,
  enabled: boolean,
) {
  const progress = useSharedValue(enabled ? 0 : 1);

  useEffect(() => {
    if (!enabled) return;
    progress.set(
      withDelay(
        delay,
        withTiming(1, {
          duration,
          easing: EASE_STANDARD,
          reduceMotion: ReduceMotion.System,
        }),
      ),
    );
  }, [delay, duration, enabled, progress]);

  // At the minimal level everything arrives as a plain fade, with no travel or scaling.
  const level = useAnimationLevel();
  const start = ENTRANCE_START[level === "minimal" ? "fade" : variant];
  const style = useAnimatedStyle(() => {
    const remaining = 1 - progress.value;
    return {
      opacity: progress.value,
      transform: [
        { translateX: start.translateX * remaining },
        { translateY: start.translateY * remaining },
        { scale: 1 - (1 - start.scale) * remaining },
      ],
    };
  });

  // Elements that arrive with their screen never carry an opacity or transform
  // they did not ask for.
  return enabled ? style : null;
}

// Every exit is a plain fade, whatever the entrance was. Direction is
// information about where content is *going*, and content being removed isn't
// going anywhere — the incoming element already carries the direction. Keeping
// exits uniform also sidesteps the presets' fixed 25px exit offset, which
// `withInitialValues` cannot reach because it only overrides the start state.
function exitingAnimation(durations: MotionDurations) {
  return FadeOut.duration(durations.exit)
    .easing(EASE_EXIT)
    .reduceMotion(ReduceMotion.System);
}

type SettledRef = { current: boolean };

const ScreenEntranceContext = createContext<SettledRef | null>(null);

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
function useEntranceAllowed(enabled: boolean) {
  const settled = useContext(ScreenEntranceContext);
  const level = useAnimationLevel();
  const [allowedAtMount] = useState(() => settled === null || settled.current);
  return enabled && allowedAtMount && level !== "off";
}

const NEVER_SETTLED: SettledRef = { current: false };

/**
 * Whether `exit` elements may fade out when removed. Off inside a pager page that is being paged
 * away: the page is removed as a whole, and its exits would linger as ghosts over the next month.
 */
const ExitContext = createContext(true);

/**
 * Whether `animateLayout` elements may run their layout transition right now. Off inside a
 * pager page while it is a neighbour or has only just become current: the page itself is
 * what moves, and a card transitioning on its own looks detached from the rest of the page.
 */
const LayoutTransitionContext = createContext(true);

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

type MotionViewProps = ViewProps & {
  variant?: MotionVariant;
  delay?: number;
  duration?: number;
  animateLayout?: boolean;
  exit?: boolean;
  /**
   * Opt out of the entrance entirely. For virtualised rows, where "mounting"
   * only means the row scrolled into the render window.
   */
  entrance?: boolean;
};

/** The exit and layout animations, shared by the entrance and static variants of `MotionView`. */
function useMotionViewParts(animateLayout: boolean, exit: boolean) {
  const durations = useMotionDurations();
  const exitsAllowed = useContext(ExitContext);
  const level = useAnimationLevel();
  const exiting = useMemo(
    () =>
      exit && exitsAllowed && level !== "off"
        ? exitingAnimation(durations)
        : undefined,
    [exit, exitsAllowed, level, durations],
  );
  // Only the transition is gated, never `animateLayout` itself: that would change the tree
  // shape and remount the content.
  const layoutAllowed = useContext(LayoutTransitionContext);
  const layout = useMemo(
    () =>
      animateLayout && layoutAllowed && level === "all"
        ? LinearTransition.duration(durations.layout)
            .easing(EASE_STANDARD)
            .reduceMotion(ReduceMotion.System)
        : undefined,
    [animateLayout, layoutAllowed, level, durations.layout],
  );
  return { durations, exiting, layout };
}

function renderMotionView(
  props: ViewProps,
  animateLayout: boolean,
  parts: {
    exiting: ReturnType<typeof useMotionViewParts>["exiting"];
    layout: ReturnType<typeof useMotionViewParts>["layout"];
  },
  entranceStyle: ReturnType<typeof useEntrance>,
) {
  // Reanimated plays entering, exiting and layout transitions through one layout-animation
  // system, and a node that carries one of those while its own style animates `opacity`
  // makes the two fight: Reanimated warns and one quietly overwrites the other. So the
  // wrapper owns layout participation and the exit; the inner view owns the entrance's
  // opacity and transform. `collapsable={false}` also keeps the wrapper alive for its
  // child's exit.
  const wrapForExit =
    !animateLayout && parts.exiting !== undefined && entranceStyle !== null;
  if (!animateLayout && !wrapForExit) {
    const { style: plainStyle, ...plainProps } = props;
    return (
      <Animated.View
        {...plainProps}
        exiting={parts.exiting}
        style={[plainStyle, entranceStyle]}
      />
    );
  }

  const { style, ...viewProps } = props;
  const { wrapperStyle, contentStyle } = splitWrapperStyle(style);
  return (
    <Animated.View
      collapsable={false}
      exiting={parts.exiting}
      layout={animateLayout ? parts.layout : undefined}
      style={wrapperStyle}
    >
      <Animated.View {...viewProps} style={[contentStyle, entranceStyle]} />
    </Animated.View>
  );
}

export function MotionView(props: MotionViewProps) {
  // `entrance={false}` is a static opt-out (virtualised rows) and is never toggled on a mounted
  // view, so choosing the component here cannot remount anything. The opted-out path skips the
  // shared value and animated style the entrance allocates, once per row of a long list.
  return props.entrance === false ? (
    <StaticMotionView {...props} />
  ) : (
    <EntranceMotionView {...props} />
  );
}

function StaticMotionView({
  variant: _variant,
  delay: _delay,
  duration: _duration,
  animateLayout = false,
  exit = false,
  entrance: _entrance,
  ...props
}: MotionViewProps) {
  const parts = useMotionViewParts(animateLayout, exit);
  return renderMotionView(props, animateLayout, parts, null);
}

function EntranceMotionView({
  variant = "up",
  delay = 0,
  duration,
  animateLayout = false,
  exit = false,
  entrance = true,
  ...props
}: MotionViewProps) {
  const parts = useMotionViewParts(animateLayout, exit);
  const allowEntrance = useEntranceAllowed(entrance);
  const entranceStyle = useEntrance(
    variant,
    delay,
    duration ?? parts.durations.enter,
    allowEntrance,
  );
  return renderMotionView(props, animateLayout, parts, entranceStyle);
}

type MotionPressableProps = Omit<PressableProps, "children" | "style"> & {
  children?: ReactNode | ((state: ExtendedPressableState) => ReactNode);
  style?: PressableProps["style"];
  pressedScale?: number;
  hoverScale?: number;
  liftOnHover?: boolean;
  active?: boolean;
  enteringVariant?: "fade" | "zoom";
  enteringDelay?: number;
  /**
   * Material 3 state layer: a translucent wash of the control's content color that fades in on
   * hover (8%) and press (10%). Drawn by themes whose controls answer with state layers (the flat
   * engine, and the soft Dew look, which opts in via `material.stateLayers`); `false` opts out.
   */
  stateLayer?: boolean;
  /** The wash color. Defaults to the theme's text color; pass the control's own `on…` color. */
  stateLayerColor?: ColorValue;
  /**
   * Where the layer takes its shape from. `own` (default): the control's own `borderRadius`.
   * `container`: this is a full-width row inside a clipping list container — the layer bleeds
   * into the container's padding and lets the container's clip round it, so a first or last row
   * follows the card's corners instead of floating as a rectangle inside them. Set the row's own
   * `borderRadius` anyway: the browser's focus ring follows it, and it is the layer's shape
   * wherever no container publishes bounds. A bleeding row does not scale or lift on hover or
   * press — the wash alone answers, or it would pull away from the edges it was drawn to meet.
   */
  stateLayerShape?: "own" | "container";
};

const STATE_LAYER_HOVER = 0.08;
const STATE_LAYER_PRESS = 0.1;

/** A layer inset that reaches `value` px outward. Zero stays `0`, not `-0`. */
function outward(value: number) {
  return value === 0 ? 0 : -value;
}

const SIZE_KEYS = [
  "minHeight",
  "height",
  "maxHeight",
  "minWidth",
  "width",
  "maxWidth",
] as const satisfies readonly (keyof ViewStyle)[];

/**
 * Whether the style paints a shadow outside the control's box. The clipping view the native
 * ripple needs would cut it off; inset shadows stay inside and are fine.
 */
function hasOuterShadow(style: ViewStyle): boolean {
  const { boxShadow, elevation, shadowOpacity } = style as ViewStyle & {
    shadowOpacity?: number;
  };
  if (typeof elevation === "number" && elevation > 0) return true;
  if (typeof shadowOpacity === "number" && shadowOpacity > 0) return true;
  if (boxShadow == null || boxShadow === "none") return false;
  if (typeof boxShadow === "string") {
    // Split on top-level commas only; rgba(...) carries commas of its own.
    const layers = boxShadow.replace(/\([^)]*\)/g, "()").split(",");
    return layers.some((layer) => !/\binset\b/.test(layer));
  }
  return boxShadow.some((layer) => !(layer as { inset?: boolean }).inset);
}

/**
 * Grows a full-width row by its container's padding so a native ripple, which can only fill its
 * own view, reaches the container's edges: negative margins pull the row out, equal padding keeps
 * the content where it was, and every size constraint grows by the same amount so the row's
 * layout footprint is unchanged. `null` when the style uses a value this cannot adjust exactly
 * (physical left/right padding or margin, a percentage size); the caller then draws the JS wash.
 */
function bleedRowStyle(
  style: ViewStyle,
  bounds: StateLayerBounds,
): ViewStyle | null {
  const loose = style as Record<string, unknown>;
  if (
    ["paddingLeft", "paddingRight", "marginLeft", "marginRight"].some(
      (key) => loose[key] !== undefined,
    )
  )
    return null;
  const pick = (keys: string[]): number | null => {
    for (const key of keys) {
      const value = loose[key];
      if (value === undefined) continue;
      return typeof value === "number" ? value : null;
    }
    return 0;
  };
  const padTop = pick(["paddingTop", "paddingVertical", "padding"]);
  const padBottom = pick(["paddingBottom", "paddingVertical", "padding"]);
  const padStart = pick(["paddingStart", "paddingHorizontal", "padding"]);
  const padEnd = pick(["paddingEnd", "paddingHorizontal", "padding"]);
  const marTop = pick(["marginTop", "marginVertical", "margin"]);
  const marBottom = pick(["marginBottom", "marginVertical", "margin"]);
  const marStart = pick(["marginStart", "marginHorizontal", "margin"]);
  const marEnd = pick(["marginEnd", "marginHorizontal", "margin"]);
  if (
    padTop === null ||
    padBottom === null ||
    padStart === null ||
    padEnd === null ||
    marTop === null ||
    marBottom === null ||
    marStart === null ||
    marEnd === null
  )
    return null;
  const next: ViewStyle = {
    ...style,
    paddingTop: padTop + bounds.top,
    paddingBottom: padBottom + bounds.bottom,
    paddingStart: padStart + bounds.x,
    paddingEnd: padEnd + bounds.x,
    marginTop: marTop - bounds.top,
    marginBottom: marBottom - bounds.bottom,
    marginStart: marStart - bounds.x,
    marginEnd: marEnd - bounds.x,
  };
  for (const key of SIZE_KEYS) {
    const value = style[key];
    if (value === undefined) continue;
    if (typeof value !== "number") return null;
    (next as Record<string, unknown>)[key] =
      value +
      (key.endsWith("eight") ? bounds.top + bounds.bottom : bounds.x * 2);
  }
  return next;
}

export function MotionPressable(props: MotionPressableProps) {
  // `enteringVariant` is fixed per call site, so choosing the component here never remounts a
  // live control. Most pressables have no entrance; they skip the shared value and animated
  // style it allocates, which adds up across a list of rows.
  return props.enteringVariant ? (
    <EnteringPressable {...props} />
  ) : (
    <MotionPressableBase {...props} entranceStyle={null} />
  );
}

function EnteringPressable({
  enteringVariant,
  enteringDelay = 0,
  ...props
}: MotionPressableProps) {
  const durations = useMotionDurations();
  const allowEntrance = useEntranceAllowed(Boolean(enteringVariant));
  const entranceStyle = useEntrance(
    enteringVariant ?? "fade",
    enteringDelay,
    durations.enter,
    allowEntrance,
  );
  return <MotionPressableBase {...props} entranceStyle={entranceStyle} />;
}

function MotionPressableBase({
  children,
  style,
  onPressIn,
  onPressOut,
  onHoverIn,
  onHoverOut,
  disabled = false,
  pressedScale,
  hoverScale = 1.008,
  liftOnHover = true,
  active = false,
  enteringVariant: _enteringVariant,
  enteringDelay: _enteringDelay,
  stateLayer = true,
  stateLayerColor,
  stateLayerShape = "own",
  entranceStyle,
  ...props
}: MotionPressableProps & { entranceStyle: ReturnType<typeof useEntrance> }) {
  // Press feedback is movement, so only the full level keeps it.
  const { travel } = useMotionPreference();
  const reduceMotion = !travel;
  const { motion, stateLayers, text: themeText } = useQashyTheme();
  const layerEnabled = stateLayers && stateLayer && !disabled;
  const layerColor = stateLayerColor ?? themeText;
  const containerBounds = useStateLayerBounds();
  const bleed = stateLayerShape === "container" ? containerBounds : null;
  // The theme's own press depth, unless the call site knows better.
  const pressDepth = pressedScale ?? motion.pressScale;
  const layer = useSharedValue(0);
  const layerStyle = useAnimatedStyle(() => ({ opacity: layer.value }));
  const durations = useMotionDurations();
  // The wash fades on the theme's quickest duration: feedback the finger can still catch.
  const layerTiming = {
    duration: durations.exit,
    easing: EASE_STANDARD,
    reduceMotion: ReduceMotion.System,
  } as const;
  // A translate theme sinks a control by shifting it down instead of shrinking it, and
  // never scales on hover or on the 'active' pop either.
  // An overlay theme (flat material) neither shrinks nor shifts: the pressed material's tonal
  // fill is the whole feedback.
  const translatePress = motion.press === "translate";
  const staticPress = motion.press !== "scale";
  // A row whose layer bleeds to its container's edges must not move at all: a scale or a lift
  // would pull the wash off the edges it was drawn to meet. The wash alone answers there.
  const interactive = !staticPress && bleed === null;
  const timingConfig = {
    duration: durations.exit,
    easing: EASE_STANDARD,
    reduceMotion: ReduceMotion.System,
  } as const;
  const initiallyPressed = Boolean(props.testOnly_pressed);
  const scale = useSharedValue(1);
  const translateY = useSharedValue(0);
  const isPressed = useSharedValue(initiallyPressed ? 1 : 0);
  const isHovered = useSharedValue(0);
  // Read synchronously by the JS-thread handlers below; the shared values above
  // exist purely so styles can react without a React render.
  const pressedRef = useRef(initiallyPressed);
  const hoveredRef = useRef(false);
  const [jsPressed, setJsPressed] = useState(initiallyPressed);
  const [jsHovered, setJsHovered] = useState(false);

  // The pop marks becoming active; a control that mounts already active (the selected chip
  // on a freshly opened screen) just appears.
  const wasActive = useRef(active);
  useEffect(() => {
    const became = active && !wasActive.current;
    wasActive.current = active;
    if (!became || reduceMotion || !interactive) return;
    scale.set(1.035);
    scale.set(withSpring(1, springConfig));
  }, [active, interactive, reduceMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  const resolveStyle = (pressableState: ExtendedPressableState): ViewStyle =>
    flattenViewStyle(
      typeof style === "function"
        ? (style as unknown as (s: ExtendedPressableState) => ViewStyle)(
            pressableState,
          )
        : style,
    );

  // Evaluate the caller's style callback once per state up front. Everything a
  // press changes then becomes data the UI thread can pick between, instead of
  // something that needs a re-render to recompute.
  const restStyle = resolveStyle(REST_STATE);
  const pressedStyle =
    typeof style === "function" ? resolveStyle(PRESSED_STATE) : restStyle;
  const hoveredStyle =
    typeof style === "function" ? resolveStyle(HOVERED_STATE) : restStyle;
  const stateKeys = (
    Array.from(
      new Set([
        ...Object.keys(restStyle),
        ...Object.keys(pressedStyle),
        ...Object.keys(hoveredStyle),
      ]),
    ) as (keyof ViewStyle)[]
  ).filter(
    (key) =>
      !wrapperStyleKeySet.has(key) &&
      (restStyle[key] !== pressedStyle[key] ||
        restStyle[key] !== hoveredStyle[key]),
  );
  const canDriveFromUiThread = stateKeys.every(
    (key) =>
      isWorkletSafe(restStyle[key]) &&
      isWorkletSafe(pressedStyle[key]) &&
      isWorkletSafe(hoveredStyle[key]),
  );
  // A function child, or a value Reanimated cannot carry, still needs the old
  // render-per-touch behaviour so consumers keep working.
  const usesJsState =
    typeof children === "function" ||
    (stateKeys.length > 0 && !canDriveFromUiThread);

  // Android answers a press with the native Material ripple instead of the JS wash, covering the
  // wash's area and shape (`bleedRowStyle` and the clip below). Whatever cannot be matched
  // exactly keeps the wash: reduced motion (a ripple's animation cannot be controlled), a control
  // with an outer shadow (the clip would cut it), per-state padding/size, or a style
  // `bleedRowStyle` cannot adjust. A call site's own `android_ripple` always wins.
  const ownRadius = restStyle.borderRadius;
  const bleedStyle =
    bleed === null || Platform.OS !== "android"
      ? null
      : bleedRowStyle(restStyle, bleed);
  const nativeRipple =
    Platform.OS === "android" &&
    layerEnabled &&
    !reduceMotion &&
    !usesJsState &&
    !props.android_ripple &&
    (bleed === null
      ? ownRadius === undefined || typeof ownRadius === "number"
      : bleedStyle !== null &&
        !stateKeys.some((key) =>
          /^(padding|margin|min|max|height|width)/.test(key),
        )) &&
    ![restStyle, pressedStyle, hoveredStyle].some(hasOuterShadow);
  const showStateLayer = layerEnabled && !props.android_ripple && !nativeRipple;
  // A standalone control clips its own ripple. A ripple fills its view's rectangle whatever the
  // radius, and RN's overflow clip only covers a view's children, so the rounded clip sits on the
  // view that wraps the Pressable. A bleeding row needs none: the clipping card rounds it.
  const rippleClip: ViewStyle | null =
    nativeRipple &&
    bleed === null &&
    typeof ownRadius === "number" &&
    ownRadius > 0
      ? { overflow: "hidden", borderRadius: ownRadius }
      : null;

  const state: ExtendedPressableState = usesJsState
    ? { pressed: jsPressed, hovered: jsHovered }
    : REST_STATE;
  const flattenedStyle = usesJsState
    ? resolveStyle(state)
    : nativeRipple && bleedStyle
      ? bleedStyle
      : restStyle;
  const overrideKeys = usesJsState ? [] : (stateKeys as string[]);
  const restValues = overrideKeys.map(
    (key) => restStyle[key as keyof ViewStyle],
  );
  const pressedValues = overrideKeys.map(
    (key) => pressedStyle[key as keyof ViewStyle],
  );
  const hoveredValues = overrideKeys.map(
    (key) => hoveredStyle[key as keyof ViewStyle],
  );

  const overrideStyle = useAnimatedStyle(() => {
    const pressedNow = isPressed.value > 0;
    const hoveredNow = isHovered.value > 0;
    const next: Record<string, unknown> = {};
    for (let index = 0; index < overrideKeys.length; index += 1) {
      next[overrideKeys[index]] = pressedNow
        ? pressedValues[index]
        : hoveredNow
          ? hoveredValues[index]
          : restValues[index];
    }
    return next as ViewStyle;
  });

  // react-native-web activates a Pressable on Enter for every role but only on Space for
  // `button`, so a focused radio, checkbox, switch or tab ignored Space. These controls are
  // expected to answer to both.
  const pressRole = props.role ?? props.accessibilityRole;
  const spaceActivates =
    process.env.EXPO_OS === "web" &&
    (pressRole === "radio" ||
      pressRole === "checkbox" ||
      pressRole === "switch" ||
      pressRole === "tab");
  const spaceKeyProps = spaceActivates
    ? {
        onKeyDown: (event: { key?: string; preventDefault?: () => void }) => {
          if (event.key !== " ") return;
          event.preventDefault?.();
          if (!disabled) props.onPress?.(event as never);
        },
      }
    : null;
  const handleHoverIn = (event: HoverEvent) => {
    hoveredRef.current = true;
    isHovered.set(1);
    if (layerEnabled)
      layer.set(
        withTiming(
          pressedRef.current ? STATE_LAYER_PRESS : STATE_LAYER_HOVER,
          layerTiming,
        ),
      );
    if (usesJsState) setJsHovered(true);
    if (!pressedRef.current && !disabled) {
      scale.set(withTiming(interactive ? hoverScale : 1, timingConfig));
      translateY.set(
        withTiming(interactive && liftOnHover ? -1 : 0, timingConfig),
      );
    }
    onHoverIn?.(event);
  };
  const handleHoverOut = (event: HoverEvent) => {
    hoveredRef.current = false;
    isHovered.set(0);
    if (layerEnabled && !pressedRef.current)
      layer.set(withTiming(0, layerTiming));
    if (usesJsState) setJsHovered(false);
    if (!pressedRef.current) {
      scale.set(withTiming(1, timingConfig));
      translateY.set(withTiming(0, timingConfig));
    }
    onHoverOut?.(event);
  };

  // On web, hover comes from the stable outer wrapper rather than the Pressable's onHoverIn:
  // react-native-web swaps the Pressable's host element when its role changes (a button becomes
  // a div), but binds its hover listeners only to the first element, so hover went dead after a
  // selection-mode toggle. React's delegated pointer props survive the swap, and the element is
  // never remounted, so a touch held across the toggle (drag-select) keeps its target.
  const hoverFromWrapper = process.env.EXPO_OS === "web";
  const webHover = hoverFromWrapper
    ? {
        onPointerEnter: (event: PointerEvent) => {
          if (!disabled && event.nativeEvent.pointerType !== "touch")
            handleHoverIn(event as never);
        },
        onPointerLeave: (event: PointerEvent) => {
          if (hoveredRef.current && event.nativeEvent.pointerType !== "touch")
            handleHoverOut(event as never);
        },
      }
    : null;
  const { wrapperStyle, contentStyle: pressableStyle } =
    splitWrapperStyle(flattenedStyle);
  const resolvedChildren =
    typeof children === "function" ? children(state) : children;

  return (
    <Animated.View
      collapsable={false}
      style={[wrapperStyle, entranceStyle]}
      {...webHover}
    >
      <Animated.View style={[animatedStyle, rippleClip]}>
        <AnimatedPressable
          {...props}
          {...spaceKeyProps}
          android_ripple={
            props.android_ripple ??
            (nativeRipple
              ? {
                  color: layerColor,
                  alpha: STATE_LAYER_PRESS,
                  borderless: false,
                  foreground: true,
                }
              : undefined)
          }
          disabled={disabled}
          onHoverIn={hoverFromWrapper ? undefined : handleHoverIn}
          onHoverOut={hoverFromWrapper ? undefined : handleHoverOut}
          onPressIn={(event) => {
            pressedRef.current = true;
            isPressed.set(1);
            if (layerEnabled)
              layer.set(withTiming(STATE_LAYER_PRESS, layerTiming));
            if (usesJsState) setJsPressed(true);
            if (!disabled) {
              scale.set(withSpring(interactive ? pressDepth : 1, springConfig));
              translateY.set(
                withTiming(
                  interactive && translatePress ? motion.pressTranslate : 0,
                  timingConfig,
                ),
              );
            }
            onPressIn?.(event);
          }}
          onPressOut={(event) => {
            pressedRef.current = false;
            isPressed.set(0);
            if (layerEnabled)
              layer.set(
                withTiming(
                  hoveredRef.current ? STATE_LAYER_HOVER : 0,
                  layerTiming,
                ),
              );
            if (usesJsState) setJsPressed(false);
            scale.set(
              withSpring(
                hoveredRef.current && interactive ? hoverScale : 1,
                springConfig,
              ),
            );
            translateY.set(
              withTiming(
                hoveredRef.current && interactive && liftOnHover ? -1 : 0,
                timingConfig,
              ),
            );
            onPressOut?.(event);
          }}
          style={[pressableStyle, overrideStyle]}
        >
          {showStateLayer ? (
            <Animated.View
              pointerEvents="none"
              style={[
                {
                  position: "absolute",
                  // Bleeding reaches the container's edges; the container's own clip rounds the
                  // first and last rows, so the layer itself stays square there.
                  top: bleed ? outward(bleed.top) : 0,
                  right: bleed ? outward(bleed.x) : 0,
                  bottom: bleed ? outward(bleed.bottom) : 0,
                  left: bleed ? outward(bleed.x) : 0,
                  borderRadius: bleed ? 0 : (restStyle.borderRadius ?? 0),
                  backgroundColor: layerColor,
                },
                layerStyle,
              ]}
            />
          ) : null}
          {resolvedChildren}
        </AnimatedPressable>
      </Animated.View>
    </Animated.View>
  );
}
