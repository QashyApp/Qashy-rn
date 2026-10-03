import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

/**
 * Pins the layout direction of everything inside it. react-native-web resolves
 * logical props (`start`, `end`, `marginStart`, ...) from its own locale
 * context, which only follows a `dir` prop on a View, not the CSS `direction`
 * that mirrors flex rows. Without `dir` the two disagree under RTL.
 */
export function DirectionScope({
  direction,
  style,
  children,
}: {
  direction: "ltr" | "rtl";
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return (
    <View {...({ dir: direction } as object)} style={[{ direction }, style]}>
      {children}
    </View>
  );
}
