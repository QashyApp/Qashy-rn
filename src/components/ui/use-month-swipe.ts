import { useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';

import { useLocalization } from '@/localization/localization';
import { useFinanceState } from '@/providers/finance-provider';
import { moveMonth } from '@/utils/date';
import { hapticSelection } from '@/utils/haptics';
import type { MonthDirection } from '@/components/ui/month-switcher';

const SWIPE_DISTANCE = 64;
const SWIPE_VELOCITY = 600;

/**
 * Horizontal swipe to step months, gated by the device-local `swipeBetweenMonths`
 * setting. Returns a gesture for `GestureDetector` (disabled while the setting is off, so the
 * view tree never changes shape), or `null` on web, where a mouse drag would fight text selection.
 *
 * Vertical movement fails the gesture early so the list keeps scrolling normally.
 * Swiping toward the start edge moves forward in time, flipped in right-to-left locales.
 */
export function useMonthSwipe({
  month,
  onChange,
  max,
  disabled = false,
}: {
  month: string;
  onChange: (month: string, direction: MonthDirection) => void;
  max?: string;
  disabled?: boolean;
}) {
  const { settings } = useFinanceState();
  const { isRtl } = useLocalization();
  const supported = process.env.EXPO_OS !== 'web';
  const active = settings.swipeBetweenMonths && !disabled;

  return useMemo(() => {
    if (!supported) return null;
    const step = (delta: number) => {
      const next = moveMonth(month, delta);
      if (delta > 0 && max != null && next > max) return;
      hapticSelection();
      onChange(next, delta > 0 ? 'right' : 'left');
    };
    return Gesture.Pan()
      .enabled(Boolean(active))
      .runOnJS(true)
      .activeOffsetX([-24, 24])
      .failOffsetY([-14, 14])
      .onEnd((event) => {
        const far = Math.abs(event.translationX) >= SWIPE_DISTANCE || Math.abs(event.velocityX) >= SWIPE_VELOCITY;
        if (!far) return;
        const towardStart = event.translationX > 0;
        // Content follows the finger: dragging toward the end edge reveals the next month.
        const forward = isRtl ? towardStart : !towardStart;
        step(forward ? 1 : -1);
      });
  }, [supported, active, month, onChange, max, isRtl]);
}
