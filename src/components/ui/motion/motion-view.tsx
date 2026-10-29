import { useContext, useMemo } from "react";
import { type ViewProps } from "react-native";
import Animated, {
  LinearTransition,
  ReduceMotion,
} from "react-native-reanimated";

import {
  EASE_STANDARD,
  useMotionDurations,
  useMotionPreference,
} from "@/components/ui/motion/durations";
import { splitWrapperStyle } from "@/components/ui/motion/style-helpers";
import {
  MotionVariant,
  exitingAnimation,
  useEntrance,
} from "@/components/ui/motion/entrance";
import {
  ExitContext,
  LayoutTransitionContext,
  useEntranceAllowed,
} from "@/components/ui/motion/entrance-scope";

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
  const { instant, travel } = useMotionPreference();
  const exiting = useMemo(
    () =>
      exit && exitsAllowed && !instant
        ? exitingAnimation(durations)
        : undefined,
    [exit, exitsAllowed, instant, durations],
  );
  // Only the transition is gated, never `animateLayout` itself: that would change the tree
  // shape and remount the content.
  const layoutAllowed = useContext(LayoutTransitionContext);
  const layout = useMemo(
    () =>
      animateLayout && layoutAllowed && travel
        ? LinearTransition.duration(durations.layout)
            .easing(EASE_STANDARD)
            .reduceMotion(ReduceMotion.System)
        : undefined,
    [animateLayout, layoutAllowed, travel, durations.layout],
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
