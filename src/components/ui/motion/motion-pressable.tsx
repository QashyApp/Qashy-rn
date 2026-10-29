import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Platform,
  Pressable,
  type ColorValue,
  type PointerEvent,
  type PressableProps,
  type PressableStateCallbackType,
  type ViewStyle,
} from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import {
  useStateLayerBounds,
  type StateLayerBounds,
} from "@/components/ui/state-layer-bounds";
import { useQashyTheme } from "@/theme/theme";
import {
  EASE_STANDARD,
  springConfig,
  useMotionDurations,
  useMotionPreference,
} from "@/components/ui/motion/durations";
import {
  flattenViewStyle,
  isWorkletSafe,
  splitWrapperStyle,
  wrapperStyleKeySet,
} from "@/components/ui/motion/style-helpers";
import { useEntrance } from "@/components/ui/motion/entrance";
import { useEntranceAllowed } from "@/components/ui/motion/entrance-scope";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// PressableStateCallbackType in RN 0.86 is { pressed: boolean } only. The motion
// system tracks hover separately via onHoverIn/Out and the shared values below, so
// extend the type locally rather than pretending RN provides it.
type ExtendedPressableState = PressableStateCallbackType & { hovered: boolean };

type HoverEvent = Parameters<NonNullable<PressableProps["onHoverIn"]>>[0];
const REST_STATE: ExtendedPressableState = { pressed: false, hovered: false };
const PRESSED_STATE: ExtendedPressableState = { pressed: true, hovered: false };
const HOVERED_STATE: ExtendedPressableState = { pressed: false, hovered: true };

type MotionPressableProps = Omit<PressableProps, "children" | "style"> & {
  children?: ReactNode | ((state: ExtendedPressableState) => ReactNode);
  style?: PressableProps["style"];
  pressedScale?: number;
  hoverScale?: number;
  liftOnHover?: boolean;
  active?: boolean;
  /**
   * How long (ms) a touch has to stay down before the control answers it visually (the press
   * scale and the wash). `onPress` itself is never delayed, and a tap shorter than this still shows
   * its feedback as it lifts. The default keeps rows in a scrolling list from flashing the moment
   * a scroll starts on them; pass `0` for a control that is not inside a scroller.
   */
  delayPressIn?: number;
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

/** See `delayPressIn`: about a frame or four, shorter than any deliberate press. */
const DEFAULT_PRESS_DELAY_MS = 70;

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
  delayPressIn = DEFAULT_PRESS_DELAY_MS,
  enteringVariant: _enteringVariant,
  enteringDelay: _enteringDelay,
  stateLayer = true,
  stateLayerColor,
  stateLayerShape = "own",
  entranceStyle,
  ...props
}: MotionPressableProps & { entranceStyle: ReturnType<typeof useEntrance> }) {
  // Press feedback is movement, so only the full level keeps it. Opacity (the wash) stays below it.
  const { travel, instant } = useMotionPreference();
  const reduceMotion = !travel;
  // How the wash and the settle-back animate: the system setting is honoured by Reanimated
  // itself, the in-app Off level has to ask for it.
  const motionPreference = instant ? ReduceMotion.Always : ReduceMotion.System;
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
    reduceMotion: motionPreference,
  } as const;
  // A translate theme sinks a control by shifting it down instead of shrinking it, and
  // never scales on hover or on the 'active' pop either.
  // An overlay theme (flat material) neither shrinks nor shifts: the pressed material's tonal
  // fill is the whole feedback.
  const translatePress = motion.press === "translate";
  const staticPress = motion.press !== "scale";
  // A row whose layer bleeds to its container's edges must not move at all: a scale or a lift
  // would pull the wash off the edges it was drawn to meet. The wash alone answers there.
  // Below the full animation level nothing scales or lifts (press, hover or the active pop).
  const interactive = !staticPress && bleed === null && travel;
  const timingConfig = {
    duration: durations.exit,
    easing: EASE_STANDARD,
    reduceMotion: motionPreference,
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
  // react-native-web's Pressable names the delay `delayPressIn`; React Native's is still unstable_.
  const pressDelay: PressableProps =
    process.env.EXPO_OS === "web"
      ? ({ delayPressIn } as PressableProps)
      : { unstable_pressDelay: delayPressIn };
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
          {...pressDelay}
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
