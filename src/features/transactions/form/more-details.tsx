import type { ReactNode } from 'react';
import { View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { MotionPressable, MotionView } from '@/components/ui/motion';
import { useLocalization } from '@/localization/localization';
import { useQashyTheme } from '@/theme/theme';

/**
 * A collapsible "More details" section: title, date, tags, exchange rate, and
 * note are the fields a fast entry doesn't need to touch on the common path,
 * so they fold behind one pressable row instead of always taking up space.
 * Expansion is fully controlled by the caller, which decides the default
 * (open for an existing transaction, or when a field inside needs attention)
 * and can force it open in response to state changes elsewhere in the form.
 */
export function MoreDetails({
  expanded,
  onToggle,
  children,
}: {
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const theme = useQashyTheme();
  const { space } = theme;
  const { t } = useLocalization();
  return (
    <View style={{ gap: space.md }}>
      <MotionPressable
        accessibilityRole="button"
        accessibilityLabel={t('More details')}
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 44,
        }}>
        <AppText variant="label">More details</AppText>
        {/* There is no "chevron up" glyph in the shared icon map (only
            `chevron.down`), so the open state is the same glyph rotated
            rather than a different one, which also reads as a smoother
            state change than swapping icons. */}
        <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}>
          <AppIcon name="chevron.down" size={16} color={theme.textMuted} />
        </View>
      </MotionPressable>
      {expanded ? (
        <MotionView variant="up" exit animateLayout style={{ gap: space.lg }}>
          {children}
        </MotionView>
      ) : null}
    </View>
  );
}
