import { type PressableProps, type ViewStyle } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { MotionPressable } from '@/components/ui/motion';
import { useLocalization } from '@/localization/localization';
import { materialStyle } from '@/theme/materials';
import { useQashyTheme } from '@/theme/theme';
import { motion } from '@/theme/tokens';

export function IconButton({
  label,
  icon,
  onPress,
  size = 44,
  iconSize = 19,
  variant = 'plain',
  disabled = false,
  enteringVariant,
  enteringDelay,
  style,
  accessibilityState,
  ...props
}: Omit<PressableProps, 'children'> & {
  label: string;
  icon: string;
  size?: number;
  iconSize?: number;
  variant?: 'plain' | 'surface' | 'accent';
  enteringVariant?: 'fade' | 'zoom';
  enteringDelay?: number;
}) {
  const theme = useQashyTheme();
  const { t } = useLocalization();
  const isDisabled = Boolean(disabled);
  const color = variant === 'accent' ? theme.onAccent : theme.textMuted;
  // 'plain' is a ghost button: no fill or shadow at rest, but it still presses
  // in like a raised control once touched, so it doesn't feel inert.
  const materialFor = (pressed: boolean): ViewStyle => {
    if (variant === 'accent') return materialStyle(theme, pressed ? 'accentPressed' : 'accent');
    if (variant === 'surface') return materialStyle(theme, pressed ? 'controlPressed' : 'control');
    return pressed ? materialStyle(theme, 'controlPressed') : { backgroundColor: 'transparent' };
  };
  return (
    <MotionPressable
      accessibilityLabel={t(label)}
      accessibilityRole="button"
      accessibilityState={{ ...accessibilityState, disabled: isDisabled }}
      {...props}
      disabled={isDisabled}
      enteringVariant={enteringVariant}
      enteringDelay={enteringDelay}
      onPress={onPress}
      pressedScale={motion.pressScale}
      hoverScale={1.04}
      style={(state) => [
        {
          width: size,
          height: size,
          minWidth: 44,
          minHeight: 44,
          borderRadius: 999,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: isDisabled ? 0.4 : 1,
        },
        materialFor(state.pressed),
        typeof style === 'function' ? style(state) : style,
        // Applied last so a caller style (for example the floating action
        // button's shadow layer) can never paint a disabled control at full
        // opacity.
        isDisabled ? { opacity: 0.4 } : null,
      ]}>
      <AppIcon name={icon} color={color} size={iconSize} />
    </MotionPressable>
  );
}
