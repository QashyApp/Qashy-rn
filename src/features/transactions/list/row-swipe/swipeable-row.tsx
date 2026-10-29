import { memo, type ReactNode } from "react";
import { Pressable, type ColorValue } from "react-native";
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";

import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import {
  rowSwipeActionVisual,
  type RowSwipeActionKind,
  type RowSwipeActions,
} from "@/features/transactions/list/row-swipe/row-swipe-actions";
import type { RowSwipeSide } from "@/features/transactions/list/row-swipe/resolve-row-swipe";
import {
  useRowSwipeController,
  type RowSwipeController,
} from "@/features/transactions/list/row-swipe/use-row-swipe";
import { useLocalization } from "@/localization/localization";
import { useQashyTheme } from "@/theme/theme";

/**
 * The offset one row is drawn at: the swipe's open or dragged row, the one still sliding shut, the
 * one sliding out after its action, or rest. A derived value, so only the rows whose offset changes touch their native view.
 */
function useRowOffset(controller: RowSwipeController | null, id: string) {
  const idle = useSharedValue("");
  const zero = useSharedValue(0);
  const activeId = controller?.activeId ?? idle;
  const activeX = controller?.activeX ?? zero;
  const closingId = controller?.closingId ?? idle;
  const closingX = controller?.closingX ?? zero;
  const committingId = controller?.committingId ?? idle;
  const committingX = controller?.committingX ?? zero;
  return useDerivedValue(() => {
    "worklet";
    if (activeId.get() === id) return activeX.get();
    if (closingId.get() === id) return closingX.get();
    if (committingId.get() === id) return committingX.get();
    return 0;
  });
}

/**
 * A row's slab content that slides sideways over the actions it reveals. The content carries the
 * slab's own fill so it covers the action layers until it moves. Without a swipe controller (or
 * with the device setting off) it is just the content in a plain view.
 */
export const SwipeableRow = memo(function SwipeableRow({
  id,
  actions,
  background,
  paddingHorizontal,
  children,
}: {
  id: string;
  actions: RowSwipeActions;
  /** The slab's fill, repeated on the sliding content so it hides the action layers. */
  background: ColorValue;
  paddingHorizontal: number;
  children: ReactNode;
}) {
  const controller = useRowSwipeController();
  const { isRtl } = useLocalization();
  const offset = useRowOffset(controller, id);
  const slide = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.get() }],
  }));
  const live = controller?.enabled === true;
  // Dragging right reveals the layer on the left, which belongs to the start side in LTR only.
  const leftSide: RowSwipeSide = isRtl ? "end" : "start";
  const rightSide: RowSwipeSide = isRtl ? "start" : "end";

  return (
    <>
      {live && controller ? (
        <>
          <ActionLayer
            controller={controller}
            id={id}
            edge="left"
            side={leftSide}
            kind={actions[leftSide]}
            offset={offset}
          />
          <ActionLayer
            controller={controller}
            id={id}
            edge="right"
            side={rightSide}
            kind={actions[rightSide]}
            offset={offset}
          />
        </>
      ) : null}
      <Animated.View
        style={[
          { backgroundColor: background, paddingHorizontal },
          // The row's own touch-action: a finger may scroll it vertically, and the swipe takes
          // the horizontal drag. Selected rows opt out in the slab itself.
          process.env.EXPO_OS === "web"
            ? ({ touchAction: "pan-y" } as object)
            : null,
          live ? slide : null,
        ]}
      >
        {children}
      </Animated.View>
    </>
  );
});

/**
 * One side's revealed action: a full-bleed color behind the row with its button on the edge the row
 * slid away from. Hidden from assistive tech, which gets the same actions on the row itself.
 */
function ActionLayer({
  controller,
  id,
  edge,
  side,
  kind,
  offset,
}: {
  controller: RowSwipeController;
  id: string;
  edge: "left" | "right";
  side: RowSwipeSide;
  kind: RowSwipeActionKind | null;
  offset: SharedValue<number>;
}) {
  const theme = useQashyTheme();
  const { space, iconSize } = theme;
  const reveal = controller.revealWidth;
  const direction = edge === "left" ? 1 : -1;
  const layer = useAnimatedStyle(() => ({
    opacity: offset.get() * direction > 0 ? 1 : 0,
  }));
  // The button follows the row's edge once the row is dragged past the reveal.
  const button = useAnimatedStyle(() => {
    const distance = offset.get() * direction;
    return {
      opacity: Math.min(1, Math.max(0, distance) / (reveal * 0.6)),
      transform: [
        {
          translateX: direction * Math.max(0, distance - reveal),
        },
      ],
    };
  });
  if (!kind) return null;
  const visual = rowSwipeActionVisual(kind, theme);
  return (
    <Animated.View
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      pointerEvents="box-none"
      style={[
        {
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          // Physical edges: the layer sits where the row slid away from, in either language.
          direction: "ltr",
          flexDirection: "row",
          justifyContent: edge === "left" ? "flex-start" : "flex-end",
          backgroundColor: visual.background,
        },
        layer,
      ]}
    >
      <Animated.View style={[{ width: reveal }, button]}>
        <Pressable
          focusable={false}
          accessible={false}
          onPress={() => controller.commit(id, side)}
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: space.xs,
            paddingHorizontal: space.xs,
          }}
        >
          <AppIcon
            name={visual.icon}
            color={visual.foreground}
            size={iconSize.lg}
          />
          <AppText
            variant="caption"
            numberOfLines={2}
            style={{ color: visual.foreground, textAlign: "center" }}
          >
            {visual.label}
          </AppText>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}
