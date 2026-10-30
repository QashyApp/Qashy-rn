/**
 * Wraps one Overview card while the screen is in edit mode: its content becomes
 * non-interactive (so a stray tap inside it never fires the card's own actions) and a toolbar
 * sits on top with reorder, resize, settings, and remove affordances.
 *
 * Dragging is a `Gesture.Pan` on the grip. The frame follows the finger (plus however far the
 * page has auto-scrolled), works out on the UI thread where the card would land and publishes
 * that to the shared reorder state, which draws the insertion line. On a successful release it
 * hands the target index to the owning screen, which applies the new order at once. The card is
 * held where it was dropped until its slot moves, then springs the rest of the way in while the
 * layout transition glides its neighbours aside, so it never returns to its old place first. A
 * cancelled drag commits nothing and springs back.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Platform,
  View,
  type HostInstance,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { AppText } from "@/components/ui/app-text";
import { IconButton } from "@/components/ui/icon-button";
import { MotionView, useMotionPreference } from "@/components/ui/motion";
import {
  autoScrollStep,
  resolveDropTarget,
} from "@/features/overview/edit/drag-math";
import { moveAccessibilityFocus } from "@/utils/move-accessibility-focus";
import type { CardReorder } from "@/features/overview/edit/use-card-reorder";
import { useLocalization } from "@/localization/localization";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import {
  hapticImpactLight,
  hapticSelection,
  hapticSuccess,
} from "@/services/haptics";
import type { WidgetSize } from "@/domain/overview-layout";

/** How much a card grows while it is held. */
const LIFT_SCALE = 1.02;
/** Touch targets in the toolbar. */
const TARGET = 44;

/** A plain three-bar grip, drawn directly rather than through a not-yet-mapped icon name. */
function DragGripGlyph({ color }: { color: string }) {
  const { space } = useQashyTheme();
  return (
    <View style={{ gap: 3, paddingHorizontal: space.xs }}>
      {[0, 1, 2].map((row) => (
        <View
          key={row}
          style={{
            width: 16,
            height: 2,
            borderRadius: 1,
            backgroundColor: color,
          }}
        />
      ))}
    </View>
  );
}

export function EditableCardFrame({
  id,
  title,
  index,
  total,
  sizes,
  showSizeControl,
  hasConfigSheet,
  configOpen,
  onToggleConfig,
  onMoveUp,
  onMoveDown,
  onCycleSize,
  onRemove,
  reorder,
  onDrop,
  children,
  configSheet,
}: {
  id: string;
  title: string;
  index: number;
  total: number;
  sizes: readonly WidgetSize[];
  showSizeControl: boolean;
  hasConfigSheet: boolean;
  configOpen: boolean;
  onToggleConfig?: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onCycleSize?: () => void;
  onRemove: () => void;
  /** Shared drag state: slot geometry, scroll offset, live drop target. */
  reorder: CardReorder;
  /**
   * The card was released on `toIndex`. Returns `null` when the order does not change. Otherwise
   * the frame waits for its new slot before settling, and settles anyway when the returned
   * promise settles without the slot having moved (the save failed or changed nothing).
   */
  onDrop?: (id: string, toIndex: number) => Promise<unknown> | null;
  children: ReactNode;
  configSheet?: ReactNode;
}) {
  const theme = useQashyTheme();
  const { radius, space, motion } = theme;
  const { t } = useLocalization();
  // Without travel (the system setting, or the in-app Animations level Minimal or Off) there is
  // no lift and no spring; the card simply follows the finger and lands in place.
  const { travel } = useMotionPreference();
  const reduce = !travel;
  const { slots, scrollY, source, target, autoScroll, viewport } = reorder;

  const [lifted, setLifted] = useState(false);
  // The drag offset, including any auto-scroll since the drag began once the finger is up.
  const panY = useSharedValue(0);
  const scale = useSharedValue(1);
  // 1 while a drag is live.
  const phase = useSharedValue(0);
  const scrollAtStart = useSharedValue(0);
  // Set when a drop reordered the cards: the frame stays put until its slot actually moves.
  const settleOnMove = useRef(false);
  // Which drop `settleOnMove` belongs to, so an earlier drop's promise cannot settle a later one.
  const dropSequence = useRef(0);
  const gripRef = useRef<HostInstance>(null);
  // Set when a toolbar button moved the card: the slot index its grip takes the screen reader's
  // focus at once the new order has rendered (the button it was on is disabled at an end).
  const refocusAt = useRef<number | null>(null);

  const announceMove = (direction: "up" | "down") => {
    const nextPosition = direction === "up" ? index : index + 2;
    const message = t(`${title}, position ${nextPosition} of ${total}`);
    if (Platform.OS === "web") {
      if (typeof AccessibilityInfo?.announceForAccessibility === "function") {
        AccessibilityInfo.announceForAccessibility(message);
      }
    } else {
      AccessibilityInfo.announceForAccessibility(message);
    }
  };

  const moveUp = (refocus = false) => {
    if (index === 0) return;
    hapticSelection();
    refocusAt.current = refocus ? index - 1 : null;
    onMoveUp();
    announceMove("up");
  };
  const moveDown = (refocus = false) => {
    if (index === total - 1) return;
    hapticSelection();
    refocusAt.current = refocus ? index + 1 : null;
    onMoveDown();
    announceMove("down");
  };

  const settle = () => {
    settleOnMove.current = false;
    if (reduce) {
      panY.set(0);
      scale.set(1);
      setLifted(false);
      return;
    }
    scale.set(withTiming(1, { duration: motion.duration.fast }));
    panY.set(
      withSpring(
        0,
        { ...motion.spring.snappy, overshootClamping: true },
        (finished) => {
          "worklet";
          if (finished) runOnJS(setLifted)(false);
        },
      ),
    );
  };

  const beginDrag = () => {
    refocusAt.current = null;
    setLifted(true);
    reorder.setDragging(true);
    hapticImpactLight();
  };

  const drop = (toIndex: number) => {
    const to = toIndex < 0 ? index : toIndex;
    const pending = to !== index ? (onDrop?.(id, to) ?? null) : null;
    dropSequence.current += 1;
    const mine = dropSequence.current;
    settleOnMove.current = pending !== null;
    if (pending) {
      hapticSuccess();
      // The slot normally moves first (the store shows the new order at once) and settles the
      // card. If the drop's outcome arrives with the slot unmoved, nothing else would ever
      // release the card, so settle it here rather than leave it lifted and offset.
      const release = () => {
        if (dropSequence.current === mine && settleOnMove.current) settle();
      };
      pending.then(release, release);
    } else {
      hapticImpactLight();
    }
  };

  const finishDrag = () => {
    reorder.setDragging(false);
    // A reorder is being applied: settle once this frame's index changes, not before.
    if (!settleOnMove.current) settle();
  };

  // The new order has rendered. The card is still where it was dropped, which is the same place
  // on screen as before the swap because the layout transition starts from the old slot, so it
  // can now spring the remaining distance to zero.
  useLayoutEffect(() => {
    if (settleOnMove.current) settle();
    if (refocusAt.current === index) {
      refocusAt.current = null;
      moveAccessibilityFocus(gripRef.current);
    }
    // Only a change of slot should run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Where the card would land, from its own slot plus how far it has travelled. Runs on the UI
  // thread every frame the inputs change (so also while the page auto-scrolls under a still
  // finger) and only reaches JS when the index changes.
  useAnimatedReaction(
    () =>
      resolveDropTarget({
        phase: phase.get(),
        slots: slots.get(),
        index,
        panY: panY.get(),
        scrollY: scrollY.get(),
        scrollAtStart: scrollAtStart.get(),
        // The slot held now, so a finger resting near a midpoint cannot flip it back and forth.
        current: target.get(),
      }),
    (next, previous) => {
      if (next === previous) return;
      target.set(next);
      // A tick for each slot crossed, not for the drag starting or ending.
      if (next >= 0 && previous !== null && previous >= 0) {
        runOnJS(hapticSelection)();
      }
    },
    [index],
  );

  const pan = Gesture.Pan()
    .withTestId(`overview-card-drag-${id}`)
    .activateAfterLongPress(Platform.OS === "web" ? 0 : 200)
    // A second finger would shift the card on web, where the pan follows the pointers' average.
    .maxPointers(1)
    // `beginDrag`, `drop` and `finishDrag` read refs only when the gesture runs, never in render.
    // eslint-disable-next-line react-hooks/refs
    .onStart(() => {
      "worklet";
      phase.set(1);
      scrollAtStart.set(scrollY.get());
      source.set(index);
      target.set(index);
      if (!reduce)
        scale.set(withTiming(LIFT_SCALE, { duration: motion.duration.fast }));
      runOnJS(beginDrag)();
    })
    .onUpdate((event) => {
      "worklet";
      panY.set(event.translationY);
      const area = viewport.get();
      autoScroll.set(autoScrollStep(event.absoluteY, area.top, area.height));
    })
    // Only a release that completed commits; a cancelled gesture falls through to `onFinalize`.
    // eslint-disable-next-line react-hooks/refs
    .onEnd((event, success) => {
      "worklet";
      if (!success) return;
      // Resolved from the release itself rather than the last reaction's result, which can lag
      // a fast final move by a frame. Without slots yet it falls back to the published target.
      const landed = resolveDropTarget({
        phase: phase.get(),
        slots: slots.get(),
        index,
        panY: event.translationY,
        scrollY: scrollY.get(),
        scrollAtStart: scrollAtStart.get(),
        current: target.get(),
      });
      runOnJS(drop)(landed >= 0 ? landed : target.get());
    })
    // eslint-disable-next-line react-hooks/refs
    .onFinalize(() => {
      "worklet";
      if (phase.get() !== 1) return;
      // Freeze the card where it is, so nothing scrolling afterwards can move it.
      panY.set(panY.get() + scrollY.get() - scrollAtStart.get());
      phase.set(0);
      source.set(-1);
      target.set(-1);
      autoScroll.set(0);
      runOnJS(finishDrag)();
    });

  const animatedStyle = useAnimatedStyle(() => {
    const scrolled =
      phase.get() === 1 ? scrollY.get() - scrollAtStart.get() : 0;
    return {
      transform: [
        { translateY: panY.get() + scrolled },
        { scale: scale.get() },
      ],
    };
  });

  return (
    // The wrapper takes part in layout (so neighbours glide when a card is dropped, removed or
    // resized) and carries the z-order; the card inside it carries the drag transform.
    <MotionView
      animateLayout
      entrance={false}
      style={{ zIndex: lifted ? 10 : 0 }}
    >
      <Animated.View
        onLayout={(event) =>
          reorder.setCardHeight(id, event.nativeEvent.layout.height)
        }
        style={[
          { borderRadius: radius.card, borderCurve: "continuous" },
          lifted ? materialStyle(theme, "overlay") : null,
          animatedStyle,
        ]}
      >
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: space.xs,
            paddingHorizontal: space.sm,
            paddingVertical: space.xs,
          }}
        >
          <GestureDetector gesture={pan}>
            <View
              ref={gripRef}
              accessible
              accessibilityRole="button"
              accessibilityLabel={t(`Drag to reorder ${title}`)}
              // A screen reader cannot hold and drag, so the grip offers the same moves as actions.
              accessibilityActions={[
                { name: "moveUp", label: t("Move up") },
                { name: "moveDown", label: t("Move down") },
                { name: "remove", label: t("Remove") },
              ]}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === "moveUp") moveUp();
                else if (event.nativeEvent.actionName === "moveDown")
                  moveDown();
                else if (event.nativeEvent.actionName === "remove") onRemove();
              }}
              style={{
                minWidth: TARGET,
                minHeight: TARGET,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <DragGripGlyph color={theme.textMuted as string} />
            </View>
          </GestureDetector>
          <AppText
            literal
            variant="label"
            // Wraps the buttons below the title before it squeezes it out of sight.
            style={{ flexGrow: 1, flexShrink: 1, flexBasis: 72 }}
            numberOfLines={1}
          >
            {title}
          </AppText>
          <IconButton
            label={`Move ${title} up`}
            icon="arrow.up"
            size={TARGET}
            disabled={index === 0}
            onPress={() => moveUp(true)}
          />
          <IconButton
            label={`Move ${title} down`}
            icon="arrow.down"
            size={TARGET}
            disabled={index === total - 1}
            onPress={() => moveDown(true)}
          />
          {showSizeControl && sizes.length > 1 ? (
            <IconButton
              label={`Change ${title} size`}
              icon="arrow.up.left.and.arrow.down.right"
              size={TARGET}
              onPress={() => {
                hapticSelection();
                onCycleSize?.();
              }}
            />
          ) : null}
          {hasConfigSheet ? (
            <IconButton
              label={`${title} settings`}
              icon="gear"
              size={TARGET}
              accessibilityState={{ expanded: configOpen }}
              onPress={onToggleConfig}
            />
          ) : null}
          <IconButton
            label={`Remove ${title}`}
            icon="trash"
            size={TARGET}
            onPress={onRemove}
          />
        </View>
        {hasConfigSheet && configOpen ? (
          <View
            style={{ paddingHorizontal: space.md, paddingBottom: space.md }}
          >
            {configSheet}
          </View>
        ) : null}
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {children}
        </View>
      </Animated.View>
    </MotionView>
  );
}
