import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';

import type { MonthSwipe } from '@/components/ui/use-month-swipe';

/**
 * Hosts the swipe from `useMonthSwipe`. The outer view stays put (and keeps the background),
 * while the inner one slides with the finger; a plain `View` when there is no swipe (web).
 */
export function MonthSwipeView({ swipe, style, children }: { swipe: MonthSwipe | null; style?: ViewStyle; children: ReactNode }) {
  if (!swipe) return <View style={style}>{children}</View>;
  return (
    <View style={style}>
      <GestureDetector gesture={swipe.gesture}>
        <Animated.View collapsable={false} style={[{ flex: 1 }, swipe.style]}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}
