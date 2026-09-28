import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Pins the layout direction of everything inside it. On native the `direction`
 * style is all that is needed; `direction-scope.web.tsx` also feeds
 * react-native-web's own locale context.
 */
export function DirectionScope({
  direction,
  style,
  children,
}: {
  direction: 'ltr' | 'rtl';
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return <View style={[{ direction }, style]}>{children}</View>;
}
