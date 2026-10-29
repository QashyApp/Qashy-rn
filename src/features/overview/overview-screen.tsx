import { CountUpSubject } from "@/components/finance/animated-money";
import { router } from "expo-router";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { View, type ScrollViewInstance } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FloatingActionButton } from "@/components/ui/floating-action-button";
import type { MonthDirection } from "@/components/ui/month-switcher";
import {
  MonthPager,
  navigateMonth,
  restingPosition,
  type MonthPagerHandle,
} from "@/components/ui/month-pager";
import { useLocalization } from "@/localization/localization";
import { floatingActionMetrics } from "@/components/ui/screen-container";
import { UndoBar } from "@/components/ui/undo-bar";
import { useScrollHide } from "@/components/ui/use-scroll-hide";
import { useSectionScrollToTop } from "@/components/ui/use-section-scroll-to-top";
import {
  overviewLayoutReducer,
  WIDGET_RULES,
  type OverviewCard,
  type OverviewLayoutAction,
} from "@/domain/overview-layout";
import { useOverviewLayout } from "@/features/overview/layout/use-overview-layout";
import { applyOptimisticOrder } from "@/features/overview/layout/optimistic-order";
import { OverviewMonthPage } from "@/features/overview/overview-month-page";
import { WIDGET_REGISTRY } from "@/features/overview/widgets/registry";
import { resolveBottomChromeInset, useScreenMetrics } from "@/theme/layout";
import { useQashyTheme } from "@/theme/theme";
import { errorMessage, showError } from "@/utils/confirm";
import { startOfMonth } from "@/utils/date";
import { hapticImpactLight, hapticSelection } from "@/services/haptics";

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
  const { isRtl } = useLocalization();
  const [month, setMonth] = useState(startOfMonth());
  const { visibility: fabVisibility, onScroll } = useScrollHide();
  const scrollRef = useSectionScrollToTop<ScrollViewInstance>();
  const pagerRef = useRef<MonthPagerHandle>(null);
  const dragProgress = useSharedValue(restingPosition(month, isRtl));

  const { layout, status, dispatch } = useOverviewLayout();
  // The order a dropped card was given, until the save settles. Applied at once so the card
  // glides into its new slot instead of returning to the old one and jumping when the write ends.
  const [pendingOrder, setPendingOrder] = useState<readonly string[] | null>(
    null,
  );
  const cards = applyOptimisticOrder(layout.cards, pendingOrder);
  const [editing, setEditing] = useState(false);
  const [configOpenId, setConfigOpenId] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);

  // The latest values, for handlers that must keep one identity (the month page is memoised and
  // its props are the whole point) yet need to read current state when they run.
  const cardsRef = useRef(cards);
  const monthRef = useRef(month);
  const dropSequence = useRef(0);
  useLayoutEffect(() => {
    cardsRef.current = cards;
    monthRef.current = month;
  });

  const changeMonth = useCallback((next: string) => setMonth(next), []);

  // Resolves to whether the change was persisted, so callers never act on a failed change.
  const dispatchGuarded = useCallback(
    async (
      action: OverviewLayoutAction,
      failureTitle: string,
    ): Promise<boolean> => {
      try {
        await dispatch(action);
        return true;
      } catch (reason) {
        showError(failureTitle, errorMessage(reason, "Try again."));
        return false;
      }
    },
    [dispatch],
  );

  const moveCard = useCallback(
    (id: string, delta: 1 | -1) => {
      void dispatchGuarded(
        { type: "moveBy", id, delta },
        "Couldn’t update your overview",
      );
    },
    [dispatchGuarded],
  );

  const resizeCard = useCallback(
    (card: OverviewCard) => {
      void dispatchGuarded(
        { type: "resize", id: card.id, size: nextSizeFor(card) },
        "Couldn’t update your overview",
      );
    },
    [dispatchGuarded],
  );

  const configureCard = useCallback(
    (id: string, config: Record<string, unknown>) => {
      void dispatchGuarded(
        { type: "configure", id, config },
        "Couldn’t update your overview",
      );
    },
    [dispatchGuarded],
  );

  const removeCard = useCallback(
    (card: OverviewCard) => {
      hapticImpactLight();
      const index = cardsRef.current.findIndex(
        (existing) => existing.id === card.id,
      );
      void dispatchGuarded(
        { type: "remove", id: card.id },
        "Couldn’t update your overview",
      ).then((removed) => {
        // Offer undo only once the removal has actually been saved.
        if (removed) setUndo({ card, index });
      });
    },
    [dispatchGuarded],
  );

  const undoRemove = () => {
    if (!undo) return;
    hapticSelection();
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

  // A dragged card was released on `toIndex`. The new order is shown at once and saved behind
  // it; if the save fails the pending order is dropped and the card returns, with the error.
  const dropCard = useCallback(
    (id: string, toIndex: number): boolean => {
      const shown = cardsRef.current;
      const action: OverviewLayoutAction = { type: "move", id, toIndex };
      const next = overviewLayoutReducer({ version: 1, cards: shown }, action);
      if (next.cards.every((card, index) => card === shown[index])) {
        return false;
      }
      dropSequence.current += 1;
      const sequence = dropSequence.current;
      setPendingOrder(next.cards.map((card) => card.id));
      void dispatchGuarded(action, "Couldn’t update your overview").then(() => {
        // Settled either way: the saved layout now matches, or the save failed and the card
        // goes back. A newer drop owns the pending order from here.
        if (dropSequence.current === sequence) setPendingOrder(null);
      });
      return true;
    },
    [dispatchGuarded],
  );

  const enterEditMode = useCallback(() => {
    hapticImpactLight();
    setEditing(true);
  }, []);

  const exitEditMode = useCallback(() => {
    setEditing(false);
    setConfigOpenId(null);
  }, []);

  const toggleConfig = useCallback(
    (id: string) => setConfigOpenId((current) => (current === id ? null : id)),
    [],
  );

  const switchMonth = useCallback(
    (next: string, direction: MonthDirection) =>
      navigateMonth(
        pagerRef.current,
        monthRef.current,
        next,
        direction,
        changeMonth,
      ),
    [changeMonth],
  );

  return (
    // Amounts hold their values through a swipe, then count to the new month once it settles.
    <CountUpSubject subject={month}>
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
              layoutReady={status === "ready"}
              cards={cards}
              configOpenId={configOpenId}
              onToggleConfig={toggleConfig}
              onEnterEdit={enterEditMode}
              onExitEdit={exitEditMode}
              onMonthSwitch={switchMonth}
              onScroll={onScroll}
              scrollRef={scrollRef}
              onMoveCard={moveCard}
              onResizeCard={resizeCard}
              onConfigureCard={configureCard}
              onRemoveCard={removeCard}
              onDropCard={dropCard}
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
    </CountUpSubject>
  );
}
