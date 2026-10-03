import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { GestureDetector, type PanGesture } from 'react-native-gesture-handler';

/** Hosts the swipe gesture from `useMonthSwipe`; a plain `View` when there is none (web). */
export function MonthSwipeView({ gesture, style, children }: { gesture: PanGesture | null; style?: ViewStyle; children: ReactNode }) {
  if (!gesture) return <View style={style}>{children}</View>;
  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false} style={style}>{children}</View>
    </GestureDetector>
  );
}
