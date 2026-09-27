import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { ProgressRing } from '@/components/ui/progress-bar';
import { materialStyle } from '@/theme/materials';
import { useQashyTheme } from '@/theme/theme';
import { radius, space, withAlpha } from '@/theme/tokens';

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
    progress.set(withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration, easing: Easing.inOut(Easing.sin), reduceMotion: ReduceMotion.System }),
        -1,
        true,
      ),
    ));
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
  const reduceMotion = useReducedMotion();
  const raised = materialStyle(theme, 'raised');
  const accent = materialStyle(theme, 'accent');

  const balanceFloat = useFloat(0, 3400, reduceMotion);
  const ringFloat = useFloat(260, 3800, reduceMotion);
  const chipFloat = useFloat(520, 3200, reduceMotion);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: 248, height: 208, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={[
          {
            width: 92,
            height: 92,
            borderRadius: 30,
            borderCurve: 'continuous',
            alignItems: 'center',
            justifyContent: 'center',
          },
          accent,
        ]}>
        <Svg width={48} height={48} viewBox="0 0 1024 1024">
          <Circle cx={512} cy={492} r={284} fill="none" stroke={theme.onAccent as string} strokeOpacity={0.35} strokeWidth={48} />
          <Path d="M636 664l116 116" fill="none" stroke={theme.onAccent as string} strokeLinecap="round" strokeWidth={76} />
          <Path
            d="M600 604c-26 26-60 40-102 40-98 0-170-74-170-180s72-180 170-180 170 74 170 180c0 32-6 60-18 84"
            fill="none"
            stroke={theme.onAccent as string}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={76}
          />
        </Svg>
      </View>

      {/* Mini balance card, leading edge. */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            start: 0,
            top: 8,
            width: 92,
            padding: space.sm,
            borderRadius: radius.tile,
            borderCurve: 'continuous',
            gap: space.xxs,
          },
          raised,
          balanceFloat,
        ]}>
        <AppText literal variant="eyebrow" muted>NET WORTH</AppText>
        <AppText literal figure variant="label" style={{ color: theme.positive }}>+2,480</AppText>
      </Animated.View>

      {/* Mini budget ring, trailing edge. */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            end: 4,
            top: 0,
            padding: space.xs,
            borderRadius: radius.pill,
          },
          raised,
          ringFloat,
        ]}>
        <ProgressRing value={0.62} size={52} strokeWidth={6}>
          <AppText literal variant="caption" style={{ fontWeight: '700' }}>62%</AppText>
        </ProgressRing>
      </Animated.View>

      {/* Mini category chip, bottom-center. */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            bottom: 4,
            alignSelf: 'center',
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.xs,
            paddingStart: space.xs,
            paddingEnd: space.md,
            paddingVertical: space.xs,
            borderRadius: radius.pill,
          },
          raised,
          chipFloat,
        ]}>
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: radius.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: withAlpha(theme.staticAccent, 0.16),
          }}>
          <AppIcon name="cart" color={theme.staticAccent} size={13} />
        </View>
        <AppText literal variant="caption" style={{ fontWeight: '500' }}>Groceries</AppText>
      </Animated.View>
    </View>
  );
}
