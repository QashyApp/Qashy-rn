import { router } from "expo-router";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  StyleSheet,
  View,
  type HostInstance,
  type ScrollViewInstance,
} from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FloatingActionButton } from "@/components/ui/floating-action-button";
import {
  MonthSwitcher,
  type MonthDirection,
} from "@/components/ui/month-switcher";
import {
  MonthPager,
  navigateMonth,
  restingPosition,
  type MonthPagerHandle,
} from "@/components/ui/month-pager";
import { useLocalization } from "@/localization/localization";
import { PageHeading } from "@/components/ui/page-heading";
import {
  floatingActionMetrics,
  screenContentMetrics,
} from "@/components/ui/screen-container";
import { TextButton } from "@/components/ui/text-button";
import { UndoBar } from "@/components/ui/undo-bar";
import { useScrollHide } from "@/components/ui/use-scroll-hide";
import { useSectionScrollToTop } from "@/components/ui/use-section-scroll-to-top";
import { WIDGET_RULES, type OverviewCard } from "@/domain/overview-layout";
import { moveAccessibilityFocus } from "@/features/overview/edit/move-accessibility-focus";
import { useExitEditOnBack } from "@/features/overview/edit/use-exit-edit-on-back";
import { createCardDropper } from "@/features/overview/layout/card-dropper";
import type { LayoutStoreAction } from "@/features/overview/layout/layout-actions";
import { useOverviewLayout } from "@/features/overview/layout/use-overview-layout";
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
  const {
    visibility: fabVisibility,
    onScroll,
    show: showFab,
  } = useScrollHide();
  const scrollRef = useSectionScrollToTop<ScrollViewInstance>();
  const pagerRef = useRef<MonthPagerHandle>(null);
  const dragProgress = useSharedValue(restingPosition(month, isRtl));

  // `layout` is what the store shows: the saved layout with every unsettled change (a card just
  // dropped, say) already applied, and taken back by the store if its save fails. Nothing here
  // keeps a pending order of its own, so a remount mid-save shows the same order.
  const { layout, status, dispatch } = useOverviewLayout();
  const cards = layout.cards;
  const [editing, setEditing] = useState(false);
  const [configOpenId, setConfigOpenId] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);

  // The latest values, for handlers that must keep one identity (the month page is memoised and
  // its props are the whole point) yet need to read current state when they run.
  const cardsRef = useRef(cards);
  const monthRef = useRef(month);
  useLayoutEffect(() => {
    cardsRef.current = cards;
    monthRef.current = month;
  });

  const changeMonth = useCallback((next: string) => setMonth(next), []);

  // Resolves to whether the change was persisted, so callers never act on a failed change.
  const dispatchGuarded = useCallback(
    async (
      action: LayoutStoreAction,
      failureTitle: string,
    ): Promise<boolean> => {
      try {
        // `false` when the action changed nothing (no failure, but nothing was saved either).
        return await dispatch(action);
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

  // A dragged card was released on `toIndex`. The store shows the new order at once and saves it
  // behind it; if the save fails the store takes it back, and the error is shown.
  const dropCard = useMemo(
    () =>
      // `cardsRef` is read only when a card is dropped, never while rendering.
      // eslint-disable-next-line react-hooks/refs
      createCardDropper({
        getCards: () => cardsRef.current,
        save: (action) =>
          dispatchGuarded(action, "Couldn’t update your overview"),
      }),
    [dispatchGuarded],
  );

  // Editing needs the saved layout; the placeholder shown while it is unavailable is read-only.
  const canEdit = status === "ready";
  const enterEditMode = useCallback(() => {
    if (!canEdit) return;
    hapticImpactLight();
    setEditing(true);
  }, [canEdit]);

  const exitEditMode = useCallback(() => {
    setEditing(false);
    setConfigOpenId(null);
  }, []);

  useExitEditOnBack(editing, exitEditMode);

  // Swapping Customize for Done (and back) would leave a screen reader on a button that is gone,
  // so focus follows the swap. Not on the first render.
  const customizeRef = useRef<HostInstance>(null);
  const doneRef = useRef<HostInstance>(null);
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (wasEditing.current === editing) return;
    wasEditing.current = editing;
    const frame = requestAnimationFrame(() =>
      moveAccessibilityFocus(editing ? doneRef.current : customizeRef.current),
    );
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  // The floating button follows the current page's scrolling alone, and another month's page
  // has its own offset: after a change of month it starts shown, and the next scroll event of
  // the new page takes over from there.
  useEffect(() => {
    showFab();
  }, [month, showFab]);

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

  // The pinned header and the pages' content share one column, so both derive their width and
  // gutters from the same call. The page adds the bottom room for the floating button.
  const content = useMemo(
    () => screenContentMetrics(metrics, insets, space),
    [metrics, insets, space],
  );
  const headerStyle = {
    width: content.width,
    maxWidth: content.maxWidth,
    alignSelf: content.alignSelf,
    paddingLeft: content.paddingLeft,
    paddingRight: content.paddingRight,
    paddingTop: content.paddingTop,
    paddingBottom: space.md,
    gap: space.md,
  } as const;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* The heading and the month switcher with Customize stay put while the month pages slide
          beneath them. On web the heading is the document's h1; native shows the section
          stack's own navigation header instead. */}
      <View
        style={{
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.border,
          backgroundColor: theme.background,
        }}
      >
        <View style={headerStyle}>
          {/* Web only: native shows the stack's own header instead, so no empty row remains. */}
          <PageHeading title="Overview" />
          {/* The month switcher with Customize (or Done) right after it. The row wraps rather
              than clipping when a large font or a longer label leaves no room for both. */}
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              alignSelf: "flex-start",
              columnGap: space.sm,
              rowGap: space.xs,
            }}
          >
            <MonthSwitcher
              value={month}
              onChange={switchMonth}
              dragProgress={dragProgress}
            />
            {editing ? (
              <TextButton
                title="Done"
                icon="checkmark"
                onPress={exitEditMode}
                // `TextButton` forwards `ref` to its pressable (React 19 passes it as a prop) but
                // does not declare it, so it travels in a spread.
                {...{ ref: doneRef }}
              />
            ) : (
              // While the saved layout loads the button keeps its place, invisible and inert, so
              // the switcher does not shift when it appears. If the layout is unavailable it
              // stays visible but disabled: the placeholder cards cannot be edited.
              <View
                style={{ opacity: status === "loading" ? 0 : 1 }}
                pointerEvents={canEdit ? "auto" : "none"}
                accessibilityElementsHidden={status === "loading"}
                importantForAccessibility={
                  status === "loading" ? "no-hide-descendants" : "auto"
                }
              >
                <TextButton
                  title="Customize"
                  icon="gear"
                  disabled={!canEdit}
                  onPress={enterEditMode}
                  {...{ ref: customizeRef }}
                />
              </View>
            )}
          </View>
        </View>
      </View>
      <MonthPager
        ref={pagerRef}
        dragProgress={dragProgress}
        month={month}
        disabled={editing}
        onChange={changeMonth}
        style={{ flex: 1 }}
        renderPage={(pageMonth, { isCurrent }) => (
          <OverviewMonthPage
            month={pageMonth}
            isCurrent={isCurrent}
            editing={editing}
            layoutStatus={status}
            cards={cards}
            configOpenId={configOpenId}
            onToggleConfig={toggleConfig}
            onEnterEdit={enterEditMode}
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
  );
}
