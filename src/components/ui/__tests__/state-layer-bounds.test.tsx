import { render } from "@testing-library/react-native";
import { StyleSheet, type ViewStyle } from "react-native";

import { MotionPressable } from "@/components/ui/motion";
import { StateLayerBoundsContext } from "@/components/ui/state-layer-bounds";

jest.mock("@/theme/theme", () => {
  const actual = jest.requireActual("@/theme/theme");
  return {
    ...actual,
    useQashyTheme: () => actual.accentTokens("#5966E9", false),
  };
});

type Rendered = Awaited<ReturnType<typeof render>>;

/** The one absolutely positioned child MotionPressable draws: the state layer. */
function layerStyle(view: Rendered): ViewStyle {
  const layers =
    view.root?.queryAll(
      (node) =>
        node.props?.pointerEvents === "none" &&
        StyleSheet.flatten(node.props?.style)?.position === "absolute",
    ) ?? [];
  expect(layers).toHaveLength(1);
  return StyleSheet.flatten(layers[0].props.style) as ViewStyle;
}

describe("MotionPressable state layer bounds", () => {
  it("bleeds to a clipping container's edges and squares off there", async () => {
    const view = await render(
      <StateLayerBoundsContext.Provider value={{ x: 16, top: 4, bottom: 0 }}>
        <MotionPressable
          stateLayerShape="container"
          style={{ borderRadius: 18, minHeight: 58 }}
        />
      </StateLayerBoundsContext.Provider>,
    );

    expect(layerStyle(view)).toMatchObject({
      top: -4,
      right: -16,
      bottom: 0,
      left: -16,
      borderRadius: 0,
    });
  });

  it("keeps the row's own radius when no container publishes bounds", async () => {
    const view = await render(
      <MotionPressable
        stateLayerShape="container"
        style={{ borderRadius: 18, minHeight: 58 }}
      />,
    );

    expect(layerStyle(view)).toMatchObject({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      borderRadius: 18,
    });
  });

  it("ignores published bounds unless the call site asks to bleed", async () => {
    const view = await render(
      <StateLayerBoundsContext.Provider value={{ x: 16, top: 4, bottom: 4 }}>
        <MotionPressable style={{ borderRadius: 18, minHeight: 58 }} />
      </StateLayerBoundsContext.Provider>,
    );

    expect(layerStyle(view)).toMatchObject({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      borderRadius: 18,
    });
  });
});
