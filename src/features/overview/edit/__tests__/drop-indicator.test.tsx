import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import {
  DROP_LINE_Z_INDEX,
  DropIndicator,
} from "@/features/overview/edit/drop-indicator";
import type { CardReorder } from "@/features/overview/edit/use-card-reorder";

jest.mock("react-native-reanimated", () => {
  const Reanimated = jest.requireActual("react-native-reanimated/mock");
  Reanimated.useReducedMotion = () => false;
  return Reanimated;
});

jest.mock("@/theme/theme", () => ({
  useQashyTheme: () => ({
    ...(({ space, radius, tile, iconSize, motion, type }) => ({
      space,
      radius,
      tile,
      iconSize,
      motion,
      type,
    }))(jest.requireActual("@/theme/themes/classic").classicTheme),
    accent: "#4040ff",
  }),
}));

describe("DropIndicator", () => {
  it("is drawn above the lifted card (z-index 10)", async () => {
    const reorder = {
      slots: { get: () => [] },
      source: { get: () => -1 },
      target: { get: () => -1 },
      gap: 20,
    } as unknown as CardReorder;
    await render(<DropIndicator reorder={reorder} />);

    const style = StyleSheet.flatten(
      screen.root?.props.style ?? screen.toJSON(),
    );
    expect(DROP_LINE_Z_INDEX).toBeGreaterThan(10);
    expect(style?.zIndex).toBe(DROP_LINE_Z_INDEX);
  });
});
