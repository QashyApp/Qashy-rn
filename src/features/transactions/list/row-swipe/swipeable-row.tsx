import { memo, type ReactNode } from "react";
import { Pressable, View, type ColorValue } from "react-native";
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { useMotionPreference } from "@/components/ui/motion";
import {
  rowSwipeActionVisual,
  type RowSwipeActionKind,
  type RowSwipeActions,
} from "@/features/transactions/list/row-swipe/row-swipe-actions";
import {
  commitDistance,
  iconScale,
  type RowSwipeSide,
} from "@/features/transactions/list/row-swipe/resolve-row-swipe";
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
  // The row's drawn width, for the commit line the action layers react to.
  const width = useSharedValue(0);
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
            width={width}
          />
          <ActionLayer
            controller={controller}
            id={id}
            edge="right"
            side={rightSide}
            kind={actions[rightSide]}
            offset={offset}
            width={width}
          />
        </>
      ) : null}
      <Animated.View
        onLayout={
          live
            ? (event) => width.set(event.nativeEvent.layout.width)
            : undefined
        }
        style={[
          { backgroundColor: background, paddingHorizontal },
          // The row's own touch-action: a finger may scroll it vertically, and the swipe takes
          // the horizontal drag. (A drag-select does not need it off: it begins after a hold, and
          // the page cancels touchmove once that hold has armed it, see `useDragSelect`.)
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
 *
 * Past the commit line (where letting go takes the action) the button stretches from the reveal
 * width to fill everything the row has uncovered, and its label changes to "Release to ...". Up to
 * the line the icon grows from 0.8 to full size. All of it is derived from the row's offset on the
 * UI thread. With reduced motion or Animations off the icon does not scale and nothing animates,
 * but the label still changes; at Animations "minimal" the label fades and nothing else moves.
 */
function ActionLayer({
  controller,
  id,
  edge,
  side,
  kind,
  offset,
  width,
}: {
  controller: RowSwipeController;
  id: string;
  edge: "left" | "right";
  side: RowSwipeSide;
  kind: RowSwipeActionKind | null;
  offset: SharedValue<number>;
  width: SharedValue<number>;
}) {
  const theme = useQashyTheme();
  const { space, iconSize, motion } = theme;
  const { instant, travel } = useMotionPreference();
  const fade = motion.duration.fast;
  const reveal = controller.revealWidth;
  const direction = edge === "left" ? 1 : -1;
  const confirmingId = controller.confirmingId;
  // 1 once the drag is past the commit line: at once (`past`), and eased (`armed`) for the fades.
  const past = useSharedValue(0);
  const armed = useSharedValue(0);
  useAnimatedReaction(
    () => {
      const rowWidth = width.get();
      return (
        rowWidth > 0 &&
        offset.get() * direction >= commitDistance(rowWidth, reveal)
      );
    },
    (isPast, wasPast) => {
      if (isPast === wasPast) return;
      const target = isPast ? 1 : 0;
      past.set(target);
      armed.set(instant ? target : withTiming(target, { duration: fade }));
    },
    [instant, fade, reveal, direction],
  );
  const layer = useAnimatedStyle(() => ({
    opacity: offset.get() * direction > 0 ? 1 : 0,
  }));
  // The button follows the row's edge once the row is dragged past the reveal, and past the commit
  // line grows to fill the revealed area (travel only; otherwise it changes at once).
  const button = useAnimatedStyle(() => {
    const distance = offset.get() * direction;
    const stretch = travel ? armed.get() : past.get();
    const follow = Math.max(0, distance - reveal);
    return {
      width: reveal + follow * stretch,
      opacity: Math.min(1, Math.max(0, distance) / (reveal * 0.6)),
      transform: [{ translateX: direction * follow * (1 - stretch) }],
    };
  });
  const icon = useAnimatedStyle(() => {
    const rowWidth = width.get();
    const scale =
      !travel || rowWidth <= 0 || confirmingId.get() === id
        ? 1
        : iconScale(offset.get() * direction, rowWidth, reveal);
    return {
      opacity: confirmingId.get() === id && kind !== "markPaid" ? 0 : 1,
      transform: [{ scale }],
    };
  });
  const check = useAnimatedStyle(() => ({
    opacity: confirmingId.get() === id ? 1 : 0,
  }));
  const label = useAnimatedStyle(() => ({ opacity: 1 - armed.get() }));
  const releaseLabel = useAnimatedStyle(() => ({ opacity: armed.get() }));
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
          <View
            style={{
              width: iconSize.lg,
              height: iconSize.lg,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Animated.View style={icon}>
              <AppIcon
                name={visual.icon}
                color={visual.foreground}
                size={iconSize.lg}
              />
            </Animated.View>
            {kind === "markPaid" ? null : (
              <Animated.View
                style={[{ position: "absolute" }, check]}
                pointerEvents="none"
              >
                <AppIcon
                  name="checkmark"
                  color={visual.foreground}
                  size={iconSize.lg}
                />
              </Animated.View>
            )}
          </View>
          <View style={{ alignSelf: "stretch", alignItems: "center" }}>
            <Animated.View style={label}>
              <AppText
                variant="caption"
                numberOfLines={2}
                style={{ color: visual.foreground, textAlign: "center" }}
              >
                {visual.label}
              </AppText>
            </Animated.View>
            <Animated.View
              pointerEvents="none"
              style={[
                { position: "absolute", top: 0, left: 0, right: 0 },
                releaseLabel,
              ]}
            >
              <AppText
                variant="caption"
                numberOfLines={2}
                style={{ color: visual.foreground, textAlign: "center" }}
              >
                {visual.releaseLabel}
              </AppText>
            </Animated.View>
          </View>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}
