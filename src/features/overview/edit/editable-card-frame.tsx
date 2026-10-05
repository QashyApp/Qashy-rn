/**
 * Wraps one Overview card while the screen is in edit mode: its content becomes
 * non-interactive (so a stray tap inside it never fires the card's own actions) and a toolbar
 * sits on top with reorder, resize, settings, and remove affordances.
 *
 * Dragging is handled here per-card with a `Gesture.Pan` on the drag handle. The frame does not
 * know about its siblings' positions — the owning list (`overview-screen.tsx`, in edit mode)
 * measures every card's on-screen `y`/`height` via `onCardLayout` and, on drop, turns the
 * accumulated vertical offset into a target index that it dispatches as a `move` action. This
 * frame only reports the live drag offset (for its own lift/follow animation) and the final
 * offset at release.
 */

import { useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Platform,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { AppText } from "@/components/ui/app-text";
import { IconButton } from "@/components/ui/icon-button";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import { hapticSelection } from "@/utils/haptics";
import type { WidgetSize } from "@/features/overview/layout/overview-layout";

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
  onDragOffset,
  onDragEnd,
  onLayout,
  children,
  configSheet,
}: {
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
  /** Live vertical offset in pixels while a drag on this card is in progress. */
  onDragOffset?: (offsetY: number) => void;
  /** Final vertical offset at release, so the owning list can resolve a target index. */
  onDragEnd?: (offsetY: number) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  children: ReactNode;
  configSheet?: ReactNode;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const reduceMotion = useReducedMotion();
  const [dragging, setDragging] = useState(false);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);

  const announceMove = (direction: "up" | "down") => {
    const nextPosition = direction === "up" ? index : index + 2;
    const message = `${title}, position ${nextPosition} of ${total}`;
    if (Platform.OS === "web") {
      if (typeof AccessibilityInfo?.announceForAccessibility === "function") {
        AccessibilityInfo.announceForAccessibility(message);
      }
    } else {
      AccessibilityInfo.announceForAccessibility(message);
    }
  };

  const moveUp = () => {
    if (index === 0) return;
    onMoveUp();
    announceMove("up");
  };
  const moveDown = () => {
    if (index === total - 1) return;
    onMoveDown();
    announceMove("down");
  };

  const beginDrag = () => {
    setDragging(true);
    hapticSelection();
  };
  const endDrag = () => {
    setDragging(false);
    hapticSelection();
  };

  const pan = Gesture.Pan()
    .activateAfterLongPress(Platform.OS === "web" ? 0 : 200)
    .onStart(() => {
      runOnJS(beginDrag)();
      scale.set(reduceMotion ? 1 : withTiming(1.02, { duration: 120 }));
    })
    .onUpdate((event) => {
      translateY.set(event.translationY);
      if (onDragOffset) runOnJS(onDragOffset)(event.translationY);
    })
    .onEnd((event) => {
      if (onDragEnd) runOnJS(onDragEnd)(event.translationY);
      runOnJS(endDrag)();
      translateY.set(
        reduceMotion ? 0 : withSpring(0, { damping: 18, stiffness: 220 }),
      );
      scale.set(reduceMotion ? 1 : withTiming(1, { duration: 120 }));
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
    zIndex: dragging ? 10 : 0,
  }));

  return (
    <Animated.View
      onLayout={onLayout}
      style={[
        { borderRadius: radius.card, borderCurve: "continuous" },
        dragging ? materialStyle(theme, "overlay") : null,
        animatedStyle,
      ]}
      accessibilityActions={[
        { name: "moveUp", label: "Move up" },
        { name: "moveDown", label: "Move down" },
        { name: "remove", label: "Remove" },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "moveUp") moveUp();
        else if (event.nativeEvent.actionName === "moveDown") moveDown();
        else if (event.nativeEvent.actionName === "remove") onRemove();
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          paddingHorizontal: space.sm,
          paddingVertical: space.xs,
        }}
      >
        <GestureDetector gesture={pan}>
          <View
            accessibilityLabel={`Drag to reorder ${title}`}
            style={{ padding: space.sm }}
          >
            <DragGripGlyph color={theme.textMuted as string} />
          </View>
        </GestureDetector>
        <AppText literal variant="label" style={{ flex: 1 }} numberOfLines={1}>
          {title}
        </AppText>
        <IconButton
          label={`Move ${title} up`}
          icon="arrow.up"
          size={40}
          disabled={index === 0}
          onPress={moveUp}
        />
        <IconButton
          label={`Move ${title} down`}
          icon="arrow.down"
          size={40}
          disabled={index === total - 1}
          onPress={moveDown}
        />
        {showSizeControl && sizes.length > 1 ? (
          <IconButton
            label={`Change ${title} size`}
            icon="arrow.up.left.and.arrow.down.right"
            size={40}
            onPress={onCycleSize}
          />
        ) : null}
        {hasConfigSheet ? (
          <IconButton
            label={`${title} settings`}
            icon="gear"
            size={40}
            accessibilityState={{ expanded: configOpen }}
            onPress={onToggleConfig}
          />
        ) : null}
        <IconButton
          label={`Remove ${title}`}
          icon="trash"
          size={40}
          onPress={onRemove}
        />
      </View>
      {hasConfigSheet && configOpen ? (
        <View style={{ paddingHorizontal: space.md, paddingBottom: space.md }}>
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
  );
}
