import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

/**
 * One moving part of a month page (an Overview card, a day of transactions). `order` is its
 * place from the top of the page, 0 first. A month swipe may move each part on its own (the
 * cascade style trails each one behind the one above); outside a month page it is a plain view.
 */
export function MonthSlideItem({
  order: _order,
  style,
  children,
}: {
  order: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return <View style={style}>{children}</View>;
}
