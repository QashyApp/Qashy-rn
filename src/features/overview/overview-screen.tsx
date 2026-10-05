import { router } from "expo-router";
import { useRef, useState } from "react";
import { ScrollView, View, type LayoutChangeEvent } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FloatingActionButton } from "@/components/ui/floating-action-button";
import {
  MonthPager,
  navigateMonth,
  type MonthPagerHandle,
} from "@/components/ui/month-pager";
import { floatingActionMetrics } from "@/components/ui/screen-container";
import { UndoBar } from "@/components/ui/undo-bar";
import { useScrollHide } from "@/components/ui/use-scroll-hide";
import { useSectionScrollToTop } from "@/components/ui/use-section-scroll-to-top";
import {
  DEFAULT_OVERVIEW_LAYOUT,
  WIDGET_RULES,
  type OverviewCard,
  type OverviewLayoutAction,
} from "@/features/overview/layout/overview-layout";
import { useOverviewLayout } from "@/features/overview/layout/use-overview-layout";
import { OverviewMonthPage } from "@/features/overview/overview-month-page";
import { WIDGET_REGISTRY } from "@/features/overview/widgets/registry";
import { resolveBottomChromeInset, useScreenMetrics } from "@/theme/layout";
import { useQashyTheme } from "@/theme/theme";
import { errorMessage, showError } from "@/utils/confirm";
import { startOfMonth } from "@/utils/date";
import { hapticImpactLight } from "@/utils/haptics";

interface UndoState {
  readonly card: OverviewCard;
  readonly index: number;
}

function nextSizeFor(card: OverviewCard) {
  const sizes = WIDGET_RULES[card.type].sizes;
  const currentIndex = sizes.indexOf(card.size);
  const nextIndex = (currentIndex + 1) % sizes.length;
  return sizes[nextIndex];
}

export function OverviewScreen() {
  const theme = useQashyTheme();
  const { space } = theme;
  const metrics = useScreenMetrics();
  const insets = useSafeAreaInsets();
  const [month, setMonth] = useState(startOfMonth());
  const { visibility: fabVisibility, onScroll } = useScrollHide();
  const scrollRef = useSectionScrollToTop<ScrollView>();
  const pagerRef = useRef<MonthPagerHandle>(null);
  const dragProgress = useSharedValue(0);

  const { layout, status, dispatch } = useOverviewLayout();
  const cards =
    status === "loading" ? DEFAULT_OVERVIEW_LAYOUT.cards : layout.cards;
  const [editing, setEditing] = useState(false);
  const [configOpenId, setConfigOpenId] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const cardLayoutsRef = useRef(
    new Map<string, { y: number; height: number }>(),
  );

  const changeMonth = (next: string) => setMonth(next);

  const dispatchGuarded = async (
    action: OverviewLayoutAction,
    failureTitle: string,
  ) => {
    try {
      await dispatch(action);
    } catch (reason) {
      showError(failureTitle, errorMessage(reason, "Try again."));
    }
  };

  const moveCard = (id: string, delta: 1 | -1) => {
    void dispatchGuarded(
      { type: "moveBy", id, delta },
      "Couldn’t update your overview",
    );
  };

  const resizeCard = (card: OverviewCard) => {
    void dispatchGuarded(
      { type: "resize", id: card.id, size: nextSizeFor(card) },
      "Couldn’t update your overview",
    );
  };

  const configureCard = (id: string, config: Record<string, unknown>) => {
    void dispatchGuarded(
      { type: "configure", id, config },
      "Couldn’t update your overview",
    );
  };

  const removeCard = (card: OverviewCard) => {
    const index = cards.findIndex((existing) => existing.id === card.id);
    void dispatchGuarded(
      { type: "remove", id: card.id },
      "Couldn’t update your overview",
    ).then(() => {
      setUndo({ card, index });
    });
  };

  const undoRemove = () => {
    if (!undo) return;
    void dispatchGuarded(
      {
        type: "add",
        card: {
          id: undo.card.id,
          type: undo.card.type,
          size: undo.card.size,
          config: undo.card.config,
        },
        index: undo.index,
      },
      "Couldn’t restore this card",
    );
    setUndo(null);
  };

  const handleCardLayout = (id: string) => (event: LayoutChangeEvent) => {
    cardLayoutsRef.current.set(id, {
      y: event.nativeEvent.layout.y,
      height: event.nativeEvent.layout.height,
    });
  };

  const handleDragEnd = (card: OverviewCard, offsetY: number) => {
    const fromIndex = cards.findIndex((existing) => existing.id === card.id);
    const own = cardLayoutsRef.current.get(card.id);
    if (fromIndex === -1 || !own) return;
    const draggedMid = own.y + own.height / 2 + offsetY;
    let targetIndex = 0;
    cards.forEach((existing) => {
      if (existing.id === card.id) return;
      const layoutInfo = cardLayoutsRef.current.get(existing.id);
      if (!layoutInfo) return;
      if (layoutInfo.y + layoutInfo.height / 2 < draggedMid) targetIndex += 1;
    });
    if (targetIndex === fromIndex) return;
    void dispatchGuarded(
      { type: "move", id: card.id, toIndex: targetIndex },
      "Couldn’t update your overview",
    );
  };

  const enterEditMode = () => {
    hapticImpactLight();
    setEditing(true);
  };

  const exitEditMode = () => {
    setEditing(false);
    setConfigOpenId(null);
  };

  const toggleConfig = (id: string) =>
    setConfigOpenId((current) => (current === id ? null : id));

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* A swipe does not move the window: it drives `dragProgress`, which slides the month
          title and the figures that differ, and the rest fades when the month commits. */}
      <MonthPager
        ref={pagerRef}
        slide={false}
        dragProgress={dragProgress}
        month={month}
        disabled={editing}
        onChange={changeMonth}
        style={{ flex: 1 }}
        renderPage={(pageMonth, { isCurrent }) => (
          <OverviewMonthPage
            month={pageMonth}
            isCurrent={isCurrent}
            dragProgress={dragProgress}
            editing={editing}
            cards={cards}
            configOpenId={configOpenId}
            onToggleConfig={toggleConfig}
            onEnterEdit={enterEditMode}
            onExitEdit={exitEditMode}
            onMonthSwitch={(next, direction) =>
              navigateMonth(
                pagerRef.current,
                month,
                next,
                direction,
                changeMonth,
              )
            }
            onScroll={onScroll}
            scrollRef={scrollRef}
            onMoveCard={moveCard}
            onResizeCard={resizeCard}
            onConfigureCard={configureCard}
            onRemoveCard={removeCard}
            onDragEnd={handleDragEnd}
            onCardLayout={handleCardLayout}
          />
        )}
      />
      {undo ? (
        <UndoBar
          message={`${WIDGET_REGISTRY[undo.card.type]?.title ?? ""} removed`}
          onAction={undoRemove}
          onDismiss={() => setUndo(null)}
          style={{
            position: "absolute",
            left: space.lg,
            right: space.lg,
            bottom: resolveBottomChromeInset(metrics, insets.bottom, space)
              .stackedOverlayBottom,
          }}
        />
      ) : null}
      <FloatingActionButton
        label="Add transaction"
        visibility={fabVisibility}
        onPress={() =>
          router.push({
            pathname: "/transaction",
            params: { returnTo: "/overview" },
          })
        }
        style={floatingActionMetrics(metrics, insets, space)}
      />
    </View>
  );
}
