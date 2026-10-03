import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { DirectionScope } from "@/components/ui/direction-scope";
import { ProgressRing } from "@/components/ui/progress-bar";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import { withAlpha } from "@/theme/tokens";

/** The hero is English and left-to-right in every UI language, so its text opts out of the RTL defaults `AppText` applies. */
const HERO_TEXT = { writingDirection: "ltr", textAlign: "left" } as const;

/**
 * A slow, gentle vertical drift (±4px) for a floating card. Disabled entirely
 * under reduced motion rather than merely skipped — a shared value that never
 * animates costs nothing, but building the interpolated style is still free
 * to leave in place either way.
 */
function useFloat(delay: number, duration: number, disabled: boolean) {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (disabled) return;
    progress.set(
      withDelay(
        delay,
        withRepeat(
          withTiming(1, {
            duration,
            easing: Easing.inOut(Easing.sin),
            reduceMotion: ReduceMotion.System,
          }),
          -1,
          true,
        ),
      ),
    );
  }, [delay, disabled, duration, progress]);

  return useAnimatedStyle(() => ({
    transform: [{ translateY: disabled ? 0 : -4 + progress.value * 8 }],
  }));
}

/**
 * The welcome hero: the Qashy mark on a raised tactile tile, orbited by three
 * small raised cards that hint at what the app does — a balance figure, a
 * budget ring, a category chip — each drifting independently and slightly out
 * of phase so the group reads as alive rather than mechanical. Purely
 * decorative: hidden from assistive tech, whose users get the heading and
 * language choice that follow instead.
 */
export function WelcomeHero() {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const reduceMotion = useReducedMotion();
  const raised = materialStyle(theme, "raised");
  const accent = materialStyle(theme, "accent");

  const balanceFloat = useFloat(0, 3400, reduceMotion);
  const ringFloat = useFloat(260, 3800, reduceMotion);
  const chipFloat = useFloat(520, 3200, reduceMotion);

  return (
    <DirectionScope direction="ltr">
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 248,
          height: 208,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={[
            {
              width: 92,
              height: 92,
              borderRadius: 30,
              borderCurve: "continuous",
              alignItems: "center",
              justifyContent: "center",
            },
            accent,
          ]}
        >
          <Svg width={56} height={56} viewBox="0 0 1024 1024">
            <Circle
              cx={512}
              cy={512}
              r={360}
              fill="none"
              stroke={theme.onAccent as string}
              strokeWidth={92}
            />
            <Rect
              x={655}
              y={712.5}
              width={214}
              height={99}
              rx={26}
              fill={theme.onAccent as string}
              transform="rotate(45 762 762)"
            />
            <Rect
              x={496.5}
              y={282}
              width={31}
              height={460}
              rx={15}
              fill={theme.onAccent as string}
            />
            <Path
              d="M584 418C562 397 538 388 512 388C470 388 440 410 440 445C440 480 470 495 512 506C556 518 586 536 586 574C586 612 556 640 512 640C482 640 455 630 436 612"
              fill="none"
              stroke={theme.onAccent as string}
              strokeWidth={78}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>

        {/* Mini balance card, leading edge. */}
        <Animated.View
          style={[
            {
              position: "absolute",
              start: 0,
              top: 8,
              width: 92,
              padding: space.sm,
              borderRadius: radius.tile,
              borderCurve: "continuous",
              gap: space.xxs,
            },
            raised,
            balanceFloat,
          ]}
        >
          <AppText literal variant="eyebrow" muted style={HERO_TEXT}>
            NET WORTH
          </AppText>
          <AppText
            literal
            figure
            variant="label"
            style={[HERO_TEXT, { color: theme.positive }]}
          >
            +2,480
          </AppText>
        </Animated.View>

        {/* Mini budget ring, trailing edge. */}
        <Animated.View
          style={[
            {
              position: "absolute",
              end: 4,
              top: 0,
              padding: space.xs,
              borderRadius: radius.pill,
            },
            raised,
            ringFloat,
          ]}
        >
          <ProgressRing value={0.62} size={52} strokeWidth={6}>
            <AppText
              literal
              variant="caption"
              style={[HERO_TEXT, { fontWeight: "700", textAlign: "center" }]}
            >
              62%
            </AppText>
          </ProgressRing>
        </Animated.View>

        {/* Mini category chip, bottom-center. */}
        <Animated.View
          style={[
            {
              position: "absolute",
              bottom: 4,
              alignSelf: "center",
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs,
              paddingStart: space.xs,
              paddingEnd: space.md,
              paddingVertical: space.xs,
              borderRadius: radius.pill,
            },
            raised,
            chipFloat,
          ]}
        >
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: radius.pill,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: withAlpha(theme.staticAccent, 0.16),
            }}
          >
            <AppIcon name="cart" color={theme.staticAccent} size={13} />
          </View>
          <AppText
            literal
            variant="caption"
            style={[HERO_TEXT, { fontWeight: "500" }]}
          >
            Groceries
          </AppText>
        </Animated.View>
      </View>
    </DirectionScope>
  );
}
