import { useEffect, useRef, useState, type ReactNode } from "react";
import { View, type ColorValue } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

import {
  motionCurves,
  usePageMotionRef,
  useRevealAllowedAtMount,
} from "@/components/ui/motion";
import { useLocalization } from "@/localization/localization";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import { QASHY_INDIGO } from "@/theme/tokens";
import { insetHighlight } from "@/theme/highlight";

const fillSpring = {
  damping: 16,
  stiffness: 210,
  mass: 0.8,
  reduceMotion: ReduceMotion.System,
} as const;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function ProgressBar({
  value,
  color,
  label,
  milestones = [1],
  onMilestone,
  size = "regular",
  segments,
}: {
  value: number;
  color?: ColorValue;
  /** Describes what this bar measures for assistive technology. */
  label?: string;
  /** Ratios that trigger a celebratory pulse when crossed upward after mount. */
  milestones?: number[];
  onMilestone?: (milestone: number) => void;
  /** `thin` is 6px tall, for a bar nested inside a denser row. */
  size?: "regular" | "thin";
  /** Number of equal segments to mark on the track (e.g. 7 for a week). Purely visual. */
  segments?: number;
}) {
  const theme = useQashyTheme();
  const { radius } = theme;
  const { isRtl } = useLocalization();
  // Math.min(1, NaN) is NaN, so a non-finite ratio would otherwise reach
  // withSpring() and accessibilityValue.
  const safeValue = Number.isFinite(value) ? value : 0;
  const clamped = Math.max(0, Math.min(1, safeValue));
  const reduceMotion = useReducedMotion();
  const revealAllowed = useRevealAllowedAtMount();
  const drawnAtMount = reduceMotion || !revealAllowed;
  const progress = useSharedValue(drawnAtMount ? clamped : 0);
  const pulse = useSharedValue(1);
  const colorMix = useSharedValue(1);
  const pageMotion = usePageMotionRef();
  // theme.accent is an opaque PlatformColor object under Material You, and
  // String() on it yields "[object Object]", which paints nothing. Reanimated's
  // interpolateColor needs a real parsable color, so keep a hex on both sides.
  const staticFallback =
    typeof theme.staticAccent === "string" && theme.staticAccent
      ? theme.staticAccent
      : QASHY_INDIGO;
  const fillColor =
    typeof color === "string"
      ? color
      : color === undefined && typeof theme.accent === "string"
        ? theme.accent
        : staticFallback;
  // Render-phase pair swap (same pattern as the transactions overlay state) so
  // a color change crossfades from the previously shown color.
  const [colorPair, setColorPair] = useState({
    from: fillColor,
    to: fillColor,
  });
  if (colorPair.to !== fillColor) {
    setColorPair({ from: colorPair.to, to: fillColor });
  }
  const mountedRef = useRef(false);
  const previousValueRef = useRef(safeValue);
  const milestoneRef = useRef({ milestones, onMilestone });

  // Runs before the value effect below, so crossings always see the latest
  // milestone config without re-triggering on array identity changes.
  useEffect(() => {
    milestoneRef.current = { milestones, onMilestone };
  });

  useEffect(() => {
    if (colorPair.from === colorPair.to) return;
    if (!pageMotion.current) {
      colorMix.set(1);
      return;
    }
    colorMix.set(0);
    colorMix.set(
      withTiming(1, {
        duration: 260,
        easing: motionCurves.standard,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [colorMix, colorPair, pageMotion]);

  useEffect(() => {
    const previous = previousValueRef.current;
    previousValueRef.current = safeValue;
    if (!mountedRef.current) {
      mountedRef.current = true;
      // A neighbouring month arrives already filled.
      if (!pageMotion.current) {
        progress.set(clamped);
        return;
      }
      progress.set(
        withTiming(clamped, {
          duration: 420,
          easing: motionCurves.standard,
          reduceMotion: ReduceMotion.System,
        }),
      );
      return;
    }
    progress.set(withSpring(clamped, fillSpring));
    const crossed = milestoneRef.current.milestones.filter(
      (milestone) => previous < milestone && safeValue >= milestone,
    );
    if (!crossed.length) return;
    milestoneRef.current.onMilestone?.(Math.max(...crossed));
    if (reduceMotion) return;
    pulse.set(
      withSequence(
        withTiming(1.45, { duration: 150, easing: motionCurves.standard }),
        withTiming(1, { duration: 240, easing: motionCurves.inOut }),
      ),
    );
  }, [clamped, progress, pulse, reduceMotion, safeValue, pageMotion]);

  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: pulse.value }],
  }));
  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: progress.value }],
  }));
  const fillColorStyle = useAnimatedStyle(() => ({
    backgroundColor:
      colorPair.from === colorPair.to
        ? colorPair.to
        : interpolateColor(
            colorMix.value,
            [0, 1],
            [colorPair.from, colorPair.to],
          ),
  }));

  const trackHeight = size === "thin" ? 6 : 10;

  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[
        {
          height: trackHeight,
          borderRadius: radius.pill,
          overflow: "hidden",
        },
        materialStyle(theme, "sunken"),
        trackStyle,
      ]}
    >
      {/* The fill sits 1px inside the track on every edge, so the sunken well
          is always visible as a thin ring around a raised-looking fill. */}
      <View
        style={{
          position: "absolute",
          top: 1,
          bottom: 1,
          start: 1,
          end: 1,
          borderRadius: radius.pill,
          overflow: "hidden",
        }}
      >
        <Animated.View
          style={[
            {
              height: "100%",
              width: "100%",
              // The fill grows from the reading-start edge.
              transformOrigin: isRtl ? "right center" : "left center",
            },
            fillStyle,
          ]}
        >
          <Animated.View
            style={[
              {
                flex: 1,
                borderRadius: radius.pill,
                // Inner top highlight so the fill reads as raised material,
                // not just a flat tinted bar inside the well.
                boxShadow: insetHighlight(theme.mode),
              },
              fillColorStyle,
            ]}
          />
        </Animated.View>
      </View>
      {segments && segments > 1
        ? Array.from({ length: segments - 1 }, (_, index) => (
            <View
              key={index}
              pointerEvents="none"
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                start: `${((index + 1) / segments) * 100}%`,
                width: 2,
                marginStart: -1,
                backgroundColor: theme.surface,
              }}
            />
          ))
        : null}
    </Animated.View>
  );
}

/**
 * A circular counterpart to `ProgressBar`, for a compact stat that wants a
 * ring rather than a bar (a goal card, a budget tile). The track is the same
 * sunken material as a linear track; the arc is a raised accent stroke with
 * round caps, laid over it.
 */
export function ProgressRing({
  value,
  size = 64,
  strokeWidth = 8,
  color,
  label,
  children,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  color?: ColorValue;
  /** Describes what this ring measures for assistive technology. */
  label?: string;
  /** Centered content (an icon, a short figure) layered over the ring. */
  children?: ReactNode;
}) {
  const theme = useQashyTheme();
  const safeValue = Number.isFinite(value) ? value : 0;
  const clamped = Math.max(0, Math.min(1, safeValue));
  const reduceMotion = useReducedMotion();
  const revealAllowed = useRevealAllowedAtMount();
  const drawnAtMount = reduceMotion || !revealAllowed;
  const progress = useSharedValue(drawnAtMount ? clamped : 0);

  const staticFallback =
    typeof theme.staticAccent === "string" && theme.staticAccent
      ? theme.staticAccent
      : QASHY_INDIGO;
  const strokeColor =
    typeof color === "string"
      ? color
      : color === undefined && typeof theme.accent === "string"
        ? theme.accent
        : staticFallback;
  const trackColor =
    typeof theme.surfaceSunken === "string"
      ? theme.surfaceSunken
      : staticFallback;

  const pageMotion = usePageMotionRef();
  useEffect(() => {
    progress.set(
      reduceMotion || !pageMotion.current
        ? clamped
        : withTiming(clamped, {
            duration: 420,
            easing: Easing.bezier(0.2, 0, 0, 1),
            reduceMotion: ReduceMotion.System,
          }),
    );
  }, [clamped, progress, reduceMotion, pageMotion]);

  const radiusPx = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radiusPx;

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - Math.min(1, progress.value)),
  }));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg
        width={size}
        height={size}
        style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}
      >
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radiusPx}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radiusPx}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={animatedProps}
        />
      </Svg>
      {children}
    </View>
  );
}
