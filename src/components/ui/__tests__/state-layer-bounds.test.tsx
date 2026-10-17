import { render } from "@testing-library/react-native";
import { StyleSheet, View, type ViewStyle } from "react-native";

import { AnimationLevelContext } from "@/components/ui/animation-level-context";
import { MotionPressable } from "@/components/ui/motion";
import { StateLayerBoundsContext } from "@/components/ui/state-layer-bounds";

jest.mock("@/theme/theme", () => {
  const actual = jest.requireActual("@/theme/theme");
  return {
    ...actual,
    useQashyTheme: () => actual.accentTokens("#5966E9", false),
  };
});

// Web draws the JS wash; Android draws a native ripple unless reduced motion or an
// outer shadow forces the wash.
const WASH = "#000000";

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
  // The suite runs as Android; the wash is the web path, so pin the platform.
  const { Platform } = jest.requireActual("react-native");
  const initialOS = Platform.OS;
  beforeEach(() => {
    Platform.OS = "web";
  });
  afterEach(() => {
    Platform.OS = initialOS;
  });

  it("bleeds to a clipping container's edges and squares off there", async () => {
    const view = await render(
      <StateLayerBoundsContext.Provider value={{ x: 16, top: 4, bottom: 0 }}>
        <MotionPressable
          stateLayerColor={WASH}
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
        stateLayerColor={WASH}
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

  describe("on Android", () => {
    beforeEach(() => {
      Platform.OS = "android";
    });

    const ripples = (view: Rendered) =>
      view.root?.queryAll(
        (n) =>
          n.props?.nativeForegroundAndroid !== undefined ||
          n.props?.nativeBackgroundAndroid !== undefined,
      ) ?? [];
    const styled = (view: Rendered, match: (s: ViewStyle) => boolean) =>
      view.root?.queryAll((n) => {
        const flat = StyleSheet.flatten(n.props?.style) as
          ViewStyle | undefined;
        return flat !== undefined && match(flat);
      }) ?? [];

    it("bleeds a native foreground ripple to the container's edges", async () => {
      const view = await render(
        <StateLayerBoundsContext.Provider value={{ x: 16, top: 4, bottom: 0 }}>
          <View>
            <MotionPressable
              stateLayerColor={WASH}
              stateLayerShape="container"
              style={{ borderRadius: 18, minHeight: 58 }}
            />
          </View>
        </StateLayerBoundsContext.Provider>,
      );
      expect(ripples(view).length).toBeGreaterThan(0);
      expect(ripples(view)[0].props.nativeForegroundAndroid).toMatchObject({
        type: "RippleAndroid",
        color: -16777216, // processColor("#000000")
        borderless: false,
        alpha: 0.1,
      });
      // The JS wash is not drawn as well.
      expect(
        view.root?.queryAll(
          (n) =>
            n.props?.pointerEvents === "none" &&
            StyleSheet.flatten(n.props?.style)?.position === "absolute",
        ),
      ).toHaveLength(0);
      // Margins pull the row out by the bleed; padding and min height keep its footprint.
      expect(
        styled(view, (s) => s.marginTop === -4 && s.marginStart === -16).length,
      ).toBeGreaterThan(0);
      expect(
        styled(
          view,
          (s) =>
            s.paddingTop === 4 &&
            s.paddingBottom === 0 &&
            s.paddingStart === 16 &&
            s.paddingEnd === 16 &&
            s.minHeight === 62,
        ).length,
      ).toBeGreaterThan(0);
    });

    it("clips a standalone control's ripple to its own radius", async () => {
      const view = await render(
        <MotionPressable
          stateLayerColor={WASH}
          style={{ borderRadius: 18, minHeight: 44 }}
        />,
      );
      expect(ripples(view).length).toBeGreaterThan(0);
      expect(
        styled(view, (s) => s.overflow === "hidden" && s.borderRadius === 18),
      ).toHaveLength(1);
    });

    it("keeps the wash for a control with an outer shadow", async () => {
      const view = await render(
        <MotionPressable
          stateLayerColor={WASH}
          style={{
            borderRadius: 18,
            minHeight: 44,
            boxShadow: "0 1px 2px rgba(0,0,0,0.12)",
          }}
        />,
      );
      expect(ripples(view)).toHaveLength(0);
      expect(layerStyle(view)).toMatchObject({ borderRadius: 18 });
    });

    it("lets a caller's own ripple win", async () => {
      const view = await render(
        <MotionPressable
          android_ripple={{ color: "#ff0000" }}
          style={{ borderRadius: 18, minHeight: 44 }}
        />,
      );
      // A caller's ripple is a background ripple here; ours is always the foreground one.
      expect(ripples(view)[0].props.nativeForegroundAndroid).toBeUndefined();
      expect(ripples(view)[0].props.nativeBackgroundAndroid).toBeDefined();
      expect(
        view.root?.queryAll((n) => n.props?.pointerEvents === "none"),
      ).toHaveLength(0);
    });
  });

  it("falls back to the wash on Android under reduced motion", async () => {
    Platform.OS = "android";
    try {
      const view = await render(
        <AnimationLevelContext.Provider value="off">
          <StateLayerBoundsContext.Provider
            value={{ x: 16, top: 4, bottom: 0 }}
          >
            <MotionPressable
              stateLayerColor={WASH}
              stateLayerShape="container"
              style={{ borderRadius: 18, minHeight: 58 }}
            />
          </StateLayerBoundsContext.Provider>
        </AnimationLevelContext.Provider>,
      );
      expect(
        view.root?.queryAll(
          (n) =>
            n.props?.nativeForegroundAndroid !== undefined ||
            n.props?.nativeBackgroundAndroid !== undefined,
        ),
      ).toHaveLength(0);
      expect(layerStyle(view)).toMatchObject({ top: -4, left: -16 });
    } finally {
      Platform.OS = initialOS;
    }
  });

  it("ignores published bounds unless the call site asks to bleed", async () => {
    const view = await render(
      <StateLayerBoundsContext.Provider value={{ x: 16, top: 4, bottom: 4 }}>
        <MotionPressable
          stateLayerColor={WASH}
          style={{ borderRadius: 18, minHeight: 58 }}
        />
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
