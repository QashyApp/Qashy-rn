import { router, useFocusEffect } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type RefObject,
} from "react";
import {
  Pressable,
  SectionList,
  StyleSheet,
  View,
  type HostInstance,
  type ViewStyle,
} from "react-native";

import { TransactionRow } from "@/components/finance/transaction-row";
import type { TransactionRecord } from "@/domain/models";
import { ActionButton } from "@/components/ui/action-button";
import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { EmptyState } from "@/components/ui/empty-state";
import type { MonthDirection } from "@/components/ui/month-switcher";
import {
  MonthSlideItem,
  PAGER_SCROLLER_STYLE,
} from "@/components/ui/month-pager";
import { MotionView, useMotionPreference } from "@/components/ui/motion";
import { StateLayerBoundsContext } from "@/components/ui/state-layer-bounds";
import { TextButton } from "@/components/ui/text-button";
import {
  rowSwipeActions,
  type RowSwipeActionKind,
  type RowSwipeActions,
} from "@/features/transactions/list/row-swipe/row-swipe-actions";
import { SwipeableRow } from "@/features/transactions/list/row-swipe/swipeable-row";
import {
  useRowGeometry,
  type RowGeometry,
} from "@/features/transactions/list/row-swipe/use-row-geometry";
import { useRowSwipeController } from "@/features/transactions/list/row-swipe/use-row-swipe";
import { useCurrentPageSwipe } from "@/features/transactions/list/use-current-page-swipe";
import {
  longPressPlan,
  maxScrollOffset,
  useDragSelect,
} from "@/features/transactions/list/use-drag-select";
import { RowFlash } from "@/features/transactions/list/row-flash";
import {
  consumeSavedTransactionSignal,
  getSavedTransactionSignal,
  subscribeSavedTransactionSignal,
} from "@/features/transactions/list/saved-transaction-signal";
import {
  groupLedgerSections,
  UPCOMING_SECTION,
  type LedgerSection,
} from "@/features/transactions/list/sections";
import { useLocalization } from "@/localization/localization";
import {
  useFinanceRepository,
  useFinanceState,
} from "@/providers/finance-provider";
import { useQashyTheme } from "@/theme/theme";
import {
  endOfMonth,
  monthKey,
  monthLabel,
  parseLocalDate,
  startOfMonth,
} from "@/utils/date";
import { hapticImpactLight, hapticSelection } from "@/services/haptics";

export type KindFilter = "all" | "expense" | "income" | "transfer" | "upcoming";

export interface TransactionMonthListProps {
  month: string;
  /** Only the current page scrolls, reports scroll offsets and renders a full first screen. */
  isCurrent: boolean;
  search: string;
  kind: KindFilter;
  /** Searching every month: the list ignores `month`. */
  allMonths: boolean;
  selectionMode: boolean;
  /** The selected rows. A Set, so a drag across rows costs the lists a lookup, not a scan. */
  selectedIds: ReadonlySet<string>;
  /** Rows to leave out: a swiped-away row whose action is waiting on its Undo. */
  hiddenIds: ReadonlySet<string>;
  /** Rows being marked paid: drawn as paid at once, with no swipe or inline actions. */
  paidIds: ReadonlySet<string>;
  /** Where "Go to latest" leads when this month is empty. */
  latestMonth: string | null;
  /** The list column's width and gutters, shared with the pinned toolbar. */
  content: ViewStyle;
  onScroll?: ComponentProps<typeof SectionList>["onScroll"];
  /** The current page's list, so the screen can scroll it to the top. */
  listRef?: RefObject<SectionList<
    TransactionRecord,
    LedgerSection<TransactionRecord>
  > | null>;
  /** Whether the "Upcoming" group is folded away. Owned by the screen so it survives month swipes. */
  upcomingCollapsed: boolean;
  onToggleUpcoming: () => void;
  onToggleSelectionMode: () => void;
  onToggleItem: (id: string) => void;
  /** Replaces the selection, as a drag across rows does. */
  onSetSelection: (ids: string[]) => void;
  /** Long-press on a row: enters selection mode and selects it. */
  onLongPressItem: (id: string) => void;
  /** A held row is being dragged across others; true from the hold until the finger lifts. */
  onDragActiveChange?: (active: boolean) => void;
  /** A row action, from a swipe, a revealed button, an inline button or an accessibility action. */
  onRowAction: (id: string, kind: RowSwipeActionKind) => void;
  onClearFilters: () => void;
  onGoToMonth: (month: string, direction: MonthDirection) => void;
}

/**
 * One month's ledger: the query, the day-grouped `SectionList` and its empty states.
 * Everything here derives from `month`, so the pager can render a neighbouring month
 * beside the current one. Neighbours are inert (`scrollEnabled` off, a short first
 * screen) because they are only ever seen at their top while a swipe is in flight.
 */
export const TransactionMonthList = memo(function TransactionMonthList({
  month,
  isCurrent,
  search,
  kind,
  allMonths,
  selectionMode,
  selectedIds,
  hiddenIds,
  paidIds,
  latestMonth,
  content,
  onScroll,
  listRef,
  upcomingCollapsed,
  onToggleUpcoming,
  onToggleSelectionMode,
  onToggleItem,
  onSetSelection,
  onLongPressItem,
  onDragActiveChange,
  onRowAction,
  onClearFilters,
  onGoToMonth,
}: TransactionMonthListProps) {
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const theme = useQashyTheme();
  const { space } = theme;
  const { locale, t } = useLocalization();
  const { instant } = useMotionPreference();

  const fromDate = startOfMonth(month);
  const toDate = endOfMonth(month);

  // `state.categories` is listed because the repository reads it internally for
  // hierarchy-aware search; the snapshot argument alone would not re-run this
  // when a category is renamed.
  const categoriesVersion = state.categories;
  const queried = useMemo(() => {
    void categoriesVersion;
    return repository.queryTransactions(
      {
        search,
        kinds: kind !== "all" && kind !== "upcoming" ? [kind] : undefined,
        statuses:
          kind === "upcoming"
            ? ["upcoming"]
            : kind === "all"
              ? ["posted", "upcoming"]
              : ["posted"],
        fromDate: allMonths || kind === "upcoming" ? undefined : fromDate,
        toDate: allMonths || kind === "upcoming" ? undefined : toDate,
        // Soonest due first: the next thing to deal with belongs at the top of an Upcoming list.
        sort: kind === "upcoming" ? "oldest" : undefined,
      },
      state.transactions,
    );
  }, [
    repository,
    search,
    kind,
    allMonths,
    fromDate,
    toDate,
    state.transactions,
    categoriesVersion,
  ]);
  // A row waiting on its Undo is out of the list at once; its section goes with its last row.
  // A row being marked paid shows as paid while its Undo is up (the repository only changes at the
  // commit); the Undo restores it.
  const transactions = useMemo(() => {
    if (!hiddenIds.size && !paidIds.size) return queried;
    return queried.flatMap((item) =>
      hiddenIds.has(item.id)
        ? []
        : paidIds.has(item.id) && item.status === "upcoming"
          ? [{ ...item, status: "posted" as const }]
          : [item],
    );
  }, [queried, hiddenIds, paidIds]);

  const sections = useMemo(
    () =>
      groupLedgerSections(transactions, {
        groupUpcoming: kind === "all",
        upcomingCollapsed,
      }),
    [transactions, kind, upcomingCollapsed],
  );

  // Each section's place from the top of the month, for the month swipe's cascade: a day's header
  // and rows share it, so the day moves as one slab. Rebuilt with the sections, and the render
  // callbacks below depend on it, so a cell never reads an order from an older list.
  const orderByKey = useMemo(() => sectionOrders(sections), [sections]);

  // A save from the transaction sheet scrolls its row into view and flashes it. Only the current
  // page reacts, and only when the row is actually in this list (a filter may hide it).
  const savedSignal = useSyncExternalStore(
    subscribeSavedTransactionSignal,
    getSavedTransactionSignal,
    getSavedTransactionSignal,
  );
  const [flash, setFlash] = useState<{
    id: string;
    flashes: number;
    token: number;
  } | null>(null);
  // The latest sections, read when a timer fires: expanding a collapsed upcoming group re-renders them.
  const sectionsRef = useRef(sections);
  useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);
  const scrollToSaved = useCallback(
    (id: string) => {
      const current = sectionsRef.current;
      const sectionIndex = current.findIndex((section) =>
        section.data.some((item) => item.id === id),
      );
      if (sectionIndex < 0) return;
      const itemIndex = current[sectionIndex].data.findIndex(
        (item) => item.id === id,
      );
      try {
        listRef?.current?.scrollToLocation({
          sectionIndex,
          itemIndex,
          viewPosition: 0.4,
          animated: !instant,
        });
      } catch {
        // Not measurable yet; the row is flashed in place and the list stays where it is.
      }
    },
    [listRef, instant],
  );
  const savedMonthMatches =
    savedSignal !== null &&
    (allMonths || savedSignal.month === monthKey(month));
  const savedId = savedSignal?.id ?? null;
  const savedToken = savedSignal?.token ?? null;
  const savedFlashes = savedSignal?.flashes ?? 0;
  // The retry timer for a scroll that landed off-screen. Kept in a ref so unmounting cancels it.
  const scrollRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (scrollRetryTimer.current !== null)
        clearTimeout(scrollRetryTimer.current);
    },
    [],
  );
  // The pending signal's token, read when the screen loses focus.
  const savedTokenRef = useRef<number | null>(null);
  useEffect(() => {
    savedTokenRef.current = savedToken;
  }, [savedToken]);
  // A save's signal only means something on the screen it was announced to. When this screen
  // loses focus (a tab change, or a page left behind) any unspent signal is cleared, so it cannot
  // flash a row on a later visit within its lifetime.
  useFocusEffect(
    useCallback(
      () => () => {
        const token = savedTokenRef.current;
        if (token !== null) consumeSavedTransactionSignal(token);
      },
      [],
    ),
  );
  useEffect(() => {
    if (!isCurrent || !savedMonthMatches || savedId === null) return;
    const target = transactions.find((item) => item.id === savedId);
    if (!target) {
      // The row is not in this month's list (a filter hides it), so the signal is spent here.
      if (savedToken !== null) consumeSavedTransactionSignal(savedToken);
      return;
    }
    if (target.status === "upcoming" && upcomingCollapsed) onToggleUpcoming();
    // Wait a beat so the sheet has closed and the list has laid out the new row. The signal is
    // consumed only when the timer fires, because consuming it changes this effect's inputs.
    const timer = setTimeout(() => {
      if (savedToken !== null) consumeSavedTransactionSignal(savedToken);
      setFlash({ id: savedId, flashes: savedFlashes, token: savedToken ?? 0 });
      scrollToSaved(savedId);
    }, 280);
    return () => clearTimeout(timer);
    // The snapshot is read when the timer fires, not tracked, so a refreshed list cannot restart the scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCurrent, savedMonthMatches, savedId, savedToken]);
  const clearFlash = useCallback(() => setFlash(null), []);

  const dayFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(
        locale,
        allMonths
          ? {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            }
          : { weekday: "long", month: "short", day: "numeric" },
      ),
    [allMonths, locale],
  );

  const filtered = search.trim().length > 0 || kind !== "all";
  // What the list compares to know a selection changed (`extraData` is shallow-compared).
  const selectionKey = useMemo(() => [...selectedIds].join(","), [selectedIds]);
  // The same members are the same selection: a screen that hands over a fresh Set on every render
  // must not make every row render again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const selection = useMemo(() => selectedIds, [selectionKey]);
  // The screen's handlers may change identity on any render; the rows get ones that never do.
  const toggleItem = useStableCallback(onToggleItem);
  const longPressItem = useStableCallback(onLongPressItem);
  const rowAction = useStableCallback(onRowAction);
  const toggleUpcoming = useStableCallback(onToggleUpcoming);

  // Press, hold and drag across rows to select them all (see `useDragSelect`).
  const containerRef = useRef<HostInstance>(null);
  const scrollOffset = useRef(0);
  const orderedIds = useMemo(
    () => sections.flatMap((section) => section.data.map((item) => item.id)),
    [sections],
  );
  const scrollTo = useCallback(
    (offset: number) => {
      listRef?.current?.getScrollResponder()?.scrollTo?.({
        y: Math.max(0, offset),
        animated: false,
      });
    },
    [listRef],
  );
  const getScrollOffset = useCallback(() => scrollOffset.current, []);
  // How far the list can scroll, for a drag-select's edge scroll to stop at the end.
  const contentHeight = useRef(0);
  const viewportHeight = useRef(0);
  const getMaxScrollOffset = useCallback(
    () => maxScrollOffset(contentHeight.current, viewportHeight.current),
    [],
  );
  const rowSwipe = useRowSwipeController();

  // What each side of a row does, read when the geometry is published.
  const actionsById = useRef(new Map<string, RowSwipeActions>());
  useEffect(() => {
    actionsById.current = new Map(
      transactions.map((item) => [
        item.id,
        paidIds.has(item.id) ? NO_ROW_ACTIONS : rowSwipeActions(item),
      ]),
    );
  }, [transactions, paidIds]);
  // One cache of where the mounted rows are, for the row swipe and the drag-select. Only the
  // current page publishes it to the swipe: the others are inert.
  const geometry = useRowGeometry({
    getScrollOffset: () => scrollOffset.current,
    onMeasured: (rects) => {
      if (!isCurrent || !rowSwipe) return;
      rowSwipe.publish(
        rects.flatMap((rect) => {
          const actions = actionsById.current.get(rect.id);
          return actions ? [{ ...rect, actions }] : [];
        }),
      );
    },
  });
  // Rows moved (a row left, a group folded, selection changed their layout): measure them again,
  // and once more after the layout animation has settled.
  useEffect(() => {
    // Until they are measured again the published rows may not match the list, so a touch that
    // misses them is not final (see `RowSwipeController.markStale`).
    if (isCurrent) rowSwipe?.markStale();
    geometry.invalidate();
    const timer = setTimeout(geometry.invalidate, 400);
    return () => clearTimeout(timer);
  }, [geometry, isCurrent, rowSwipe, sections, selectionMode]);
  useCurrentPageSwipe({ isCurrent, rowSwipe, geometry, scrollOffset });

  const setDragArmed = useCallback(
    (armed: boolean) => rowSwipe?.suspend("drag", armed),
    [rowSwipe],
  );
  const { gesture, arm, dragging } = useDragSelect({
    enabled: isCurrent,
    orderedIds,
    selectedIds,
    onSelect: onSetSelection,
    containerRef,
    scrollTo,
    getScrollOffset,
    getMaxScrollOffset,
    geometry,
    onArmedChange: setDragArmed,
  });
  useEffect(() => {
    if (isCurrent) onDragActiveChange?.(dragging);
  }, [isCurrent, dragging, onDragActiveChange]);
  // The row swipe runs alongside the drag-select pan: they never claim the same touch, because a
  // drag stands the swipe down (`suspend`) and the swipe only starts on a sideways move.
  const listGesture = useMemo(
    () =>
      isCurrent && rowSwipe
        ? Gesture.Simultaneous(gesture, rowSwipe.gesture)
        : gesture,
    [isCurrent, rowSwipe, gesture],
  );

  // Stable between renders: SectionList re-renders every mounted cell when either changes, so each
  // lists exactly what it draws and nothing the screen passes down fresh on every render.
  const renderSectionHeader = useCallback(
    ({ section }: { section: LedgerSection<TransactionRecord> }) => {
      const order = orderByKey.get(sectionKey(section)) ?? 0;
      if (section.kind === "upcoming") {
        return (
          <MonthSlideItem order={order}>
            <UpcomingHeader
              count={section.count ?? section.data.length}
              collapsed={upcomingCollapsed}
              onToggle={toggleUpcoming}
            />
          </MonthSlideItem>
        );
      }
      // Opaque, because a sticky header scrolls over live content. The negative margins let the
      // fill reach the column's gutters so rows do not slide past it in the margin. It fades out
      // with the day's last row (sticky headers unmount the same way rows do).
      return (
        <MonthSlideItem order={order}>
          <MotionView
            entrance={false}
            exit
            style={{
              flexDirection: "row",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: space.sm,
              backgroundColor: theme.background,
              paddingTop: space.lg,
              paddingBottom: space.sm,
              marginHorizontal: -space.xs,
              paddingHorizontal: space.xs,
            }}
          >
            <AppText literal variant="overline" muted>
              {dayFormat.format(parseLocalDate(section.title))}
            </AppText>
          </MotionView>
        </MonthSlideItem>
      );
    },
    [
      orderByKey,
      upcomingCollapsed,
      toggleUpcoming,
      space,
      theme.background,
      dayFormat,
    ],
  );
  const renderItem = useCallback(
    ({
      item,
      index,
      section,
    }: {
      item: TransactionRecord;
      index: number;
      section: LedgerSection<TransactionRecord>;
    }) => (
      <DayRow
        item={item}
        order={orderByKey.get(sectionKey(section)) ?? 0}
        first={index === 0}
        last={index === section.data.length - 1}
        selected={selection.has(item.id)}
        paying={paidIds.has(item.id)}
        selectionMode={selectionMode}
        flashes={flash?.id === item.id ? flash.flashes : 0}
        flashToken={flash?.token ?? 0}
        onFlashDone={clearFlash}
        onToggleItem={toggleItem}
        onLongPressItem={longPressItem}
        registerRow={geometry.register}
        onArmDrag={arm}
        onRowAction={rowAction}
      />
    ),
    [
      orderByKey,
      selection,
      paidIds,
      selectionMode,
      flash,
      clearFlash,
      toggleItem,
      longPressItem,
      geometry.register,
      arm,
      rowAction,
    ],
  );

  return (
    <GestureDetector gesture={listGesture}>
      <View
        ref={containerRef}
        collapsable={false}
        style={{ flex: 1 }}
        onLayout={(event) => {
          viewportHeight.current = event.nativeEvent.layout.height;
          geometry.invalidate();
        }}
      >
        <SectionList
          ref={isCurrent ? listRef : undefined}
          onScroll={(event) => {
            // Every page keeps its own offset, even the inert ones (a list whose content shrank
            // moves itself): it is what the row swipe is given when the page becomes current.
            scrollOffset.current = event.nativeEvent.contentOffset.y;
            if (!isCurrent) return;
            rowSwipe?.setScrollOffset(scrollOffset.current);
            geometry.noteScroll();
            onScroll?.(event);
          }}
          onContentSizeChange={(_width, height) => {
            contentHeight.current = height;
          }}
          scrollEventThrottle={16}
          // A scroll closes an open row; the rows' positions are re-measured once it rests.
          onScrollBeginDrag={isCurrent ? () => rowSwipe?.close() : undefined}
          // At rest the rows are measured at once, so one that scrolled in can be swiped straight
          // away; only a screenful mounting together waits for the settle delay.
          onMomentumScrollEnd={
            isCurrent
              ? (event) => geometry.settle(event.nativeEvent.contentOffset.y)
              : undefined
          }
          onScrollEndDrag={
            isCurrent
              ? (event) => {
                  // A drag that ends with speed carries on as momentum, which ends with its own event.
                  const { contentOffset, velocity } = event.nativeEvent;
                  if (!velocity || Math.hypot(velocity.x, velocity.y) < 0.05)
                    geometry.settle(contentOffset.y);
                }
              : undefined
          }
          // A drag-select owns the finger until it lifts. The web cancels its touch scrolling
          // instead (see `useDragSelect`), and changing overflow there mid-touch would jump.
          scrollEnabled={
            isCurrent && !(dragging && process.env.EXPO_OS !== "web")
          }
          // A scroll drag dismisses the keyboard (the search field's), and a tap a row handles
          // reaches the row instead of only dismissing it. A drag-select disables scrolling and
          // the row swipe is a sideways pan, neither is a scroll drag, so they are unaffected.
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          initialNumToRender={isCurrent ? 10 : 6}
          style={[
            { flex: 1, backgroundColor: theme.background },
            PAGER_SCROLLER_STYLE,
          ]}
          contentContainerStyle={[
            content,
            {
              paddingTop: 0,
              paddingBottom:
                (Number(content.paddingBottom) || 0) +
                (selectionMode ? 140 : 0),
            },
          ]}
          sections={sections}
          extraData={`${selectionKey}|${selectionMode}|${flash?.token}:${flash?.id}`}
          onScrollToIndexFailed={(info) => {
            // A row far off-screen has no measured height yet: jump near it, then try once more.
            listRef?.current?.getScrollResponder()?.scrollTo?.({
              y: info.averageItemLength * info.index,
              animated: false,
            });
            const target = flash?.id;
            if (target) {
              if (scrollRetryTimer.current !== null)
                clearTimeout(scrollRetryTimer.current);
              scrollRetryTimer.current = setTimeout(() => {
                scrollRetryTimer.current = null;
                scrollToSaved(target);
              }, 120);
            }
          }}
          keyExtractor={(item) => item.id}
          // The day a row belongs to stays on screen for as long as that day's
          // rows do, so a fast scroll through a busy month never loses its place.
          stickySectionHeadersEnabled
          ListHeaderComponent={
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                gap: space.md,
                alignItems: "center",
                paddingTop: space.md,
              }}
            >
              {/* One string so the dictionary's count patterns can match; split
              children would leave "transactions" on its own with no key. */}
              <AppText literal variant="caption" muted>
                {t(
                  selectionMode
                    ? `${selectedIds.size} selected`
                    : `${transactions.length} ${transactions.length === 1 ? "transaction" : "transactions"}`,
                )}
              </AppText>
              <View
                style={{
                  flexDirection: "row",
                  gap: space.sm,
                  alignItems: "center",
                  flexWrap: "wrap",
                  justifyContent: "flex-end",
                }}
              >
                {transactions.length ? (
                  <TextButton
                    title={selectionMode ? "Done selecting" : "Select"}
                    tone={selectionMode ? "muted" : "accent"}
                    onPress={onToggleSelectionMode}
                  />
                ) : null}
                <TextButton
                  title="Import or export"
                  onPress={() => router.push("/csv")}
                />
              </View>
            </View>
          }
          renderSectionHeader={renderSectionHeader}
          // Each day is one grouped surface with hairlines between its rows,
          // rather than a separate card per transaction. A true nested `Card`
          // can't wrap a section's rows here — `SectionList` virtualises each
          // row independently, so there is no single element spanning a whole
          // day to attach one shadow to. Every row instead carries the same
          // flat `card` background and shadow (no gradient, which would band
          // visibly repeating down a multi-row day); stacked with no gap and
          // rounded only at the day's first/last row, they read as one raised
          // slab per day rather than as N separate rows happening to touch.
          renderItem={renderItem}
          ListEmptyComponent={
            <MotionView key={String(filtered)} variant="fade">
              {filtered ? (
                <EmptyState
                  icon="magnifyingglass"
                  title="Nothing matches"
                  body={
                    allMonths
                      ? "Try another search or filter."
                      : `Nothing in ${monthLabel(month, locale)} matches. Try another filter, or search all months.`
                  }
                >
                  <ActionButton
                    title="Clear filters"
                    variant="secondary"
                    onPress={onClearFilters}
                  />
                </EmptyState>
              ) : state.transactions.length ? (
                <EmptyState
                  icon="calendar"
                  title={`No transactions in ${monthLabel(month, locale)}`}
                  body="Add one for this month, or jump to your latest activity."
                >
                  <View
                    style={{
                      flexDirection: "row",
                      gap: space.sm,
                      flexWrap: "wrap",
                      justifyContent: "center",
                    }}
                  >
                    {latestMonth && latestMonth !== month ? (
                      <ActionButton
                        title="Go to latest"
                        variant="secondary"
                        onPress={() =>
                          onGoToMonth(
                            latestMonth,
                            latestMonth > month ? "right" : "left",
                          )
                        }
                      />
                    ) : null}
                  </View>
                </EmptyState>
              ) : (
                <EmptyState
                  icon="arrow.left.arrow.right"
                  title="No transactions yet"
                  body="Add your first income, expense, or transfer."
                />
              )}
            </MotionView>
          }
          ListFooterComponent={<View style={{ height: 88 }} />}
        />
      </View>
    </GestureDetector>
  );
});

/**
 * A function that keeps its identity and calls whatever `callback` is now. For handlers a screen
 * recreates on every render: they are only called from events, after the render has committed.
 */
function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}

const NO_ROW_ACTIONS: RowSwipeActions = { start: null, end: null };

/** A section's identity: a day's date, or the upcoming group (whose title is not a date). */
function sectionKey(section: LedgerSection<TransactionRecord>): string {
  return section.kind === "upcoming" ? UPCOMING_SECTION : section.title;
}

/** Each section's position from the top of the month, the upcoming group included. */
function sectionOrders(
  sections: readonly LedgerSection<TransactionRecord>[],
): ReadonlyMap<string, number> {
  return new Map(
    sections.map((section, index) => [sectionKey(section), index]),
  );
}

interface DayRowProps {
  item: TransactionRecord;
  /** The day's place from the top of the month: its header and rows move together in a month swipe. */
  order: number;
  first: boolean;
  last: boolean;
  selected: boolean;
  /** Being marked paid: no swipe, no row actions. */
  paying: boolean;
  selectionMode: boolean;
  /** Non-zero while this row is the one just saved. */
  flashes: number;
  flashToken: number;
  onFlashDone: () => void;
  onToggleItem: (id: string) => void;
  onLongPressItem: (id: string) => void;
  /** Lets the screen find this row's view while a drag-select passes over it. */
  registerRow: RowGeometry["register"];
  /** A long-press just selected this row: a drag from here extends the selection. */
  onArmDrag: (id: string) => void;
  onRowAction: (id: string, kind: RowSwipeActionKind) => void;
}

/** The collapsible heading of the upcoming group; the day headers above and below it stay as they are. */
function UpcomingHeader({
  count,
  collapsed,
  onToggle,
}: {
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const theme = useQashyTheme();
  const { space } = theme;
  const { t } = useLocalization();
  return (
    // Fades out with the group's last row; the margins and fill sit on the fading wrapper.
    <MotionView
      entrance={false}
      exit
      style={{ marginHorizontal: -space.xs, backgroundColor: theme.background }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t("Upcoming")}, ${count}`}
        accessibilityState={{ expanded: !collapsed }}
        onPress={() => {
          hapticSelection();
          onToggle();
        }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: 44,
          gap: space.sm,
          paddingTop: space.md,
          paddingHorizontal: space.xs,
        }}
      >
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
        >
          <AppIcon
            name={collapsed ? "ion:chevron-forward" : "ion:chevron-down"}
            color={theme.textMuted}
            size={16}
            mirrorInRtl
          />
          <AppText variant="overline" muted>
            Upcoming
          </AppText>
        </View>
        <AppText literal figure variant="caption" muted numeric>
          {String(count)}
        </AppText>
      </Pressable>
    </MotionView>
  );
}

/**
 * One row of a day's grouped surface. Memoized so a selection change or a refreshed snapshot
 * re-renders only the rows whose own inputs changed, not every row the list has mounted.
 * Exported for its render-order test.
 */
export const DayRow = memo(function DayRow({
  item,
  order,
  first,
  last,
  selected,
  paying,
  selectionMode,
  flashes,
  flashToken,
  onFlashDone,
  onToggleItem,
  onLongPressItem,
  registerRow,
  onArmDrag,
  onRowAction,
}: DayRowProps) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const id = item.id;
  const handleLongPress = useCallback(() => {
    if (!selectionMode) hapticImpactLight();
    const plan = longPressPlan(selected, process.env.EXPO_OS === "web");
    if (plan.toggle) onLongPressItem(id);
    if (plan.arm) onArmDrag(id);
  }, [selectionMode, selected, onLongPressItem, onArmDrag, id]);
  const rowRef = useCallback(
    (node: HostInstance | null) => {
      registerRow(id, node);
    },
    [registerRow, id],
  );
  const swipe = useRowSwipeController();
  // Skip and Mark paid under an upcoming row: a tap that only closes an open row does nothing else.
  const handleInlineAction = useCallback(
    (action: RowSwipeActionKind) => {
      if (swipe?.shouldSwallowPress(id)) {
        swipe.close();
        return;
      }
      onRowAction(id, action);
    },
    [swipe, onRowAction, id],
  );
  const { kind: itemKind, status: itemStatus } = item;
  // What the row draws behind it. A row being marked paid is shown as posted but is still the
  // upcoming row that was swiped, so its layer stays until the card has sprung back over it.
  const actions = useMemo(
    () =>
      rowSwipeActions({
        kind: itemKind,
        status: paying ? "upcoming" : itemStatus,
      }),
    [paying, itemKind, itemStatus],
  );
  const handlePress = useCallback(() => {
    // A tap that only closes an open row, or ends a swipe, is not a press on the row.
    if (swipe?.shouldSwallowPress(id)) {
      swipe.close();
      return;
    }
    if (selectionMode) onToggleItem(id);
    else
      router.push({
        pathname: "/transaction",
        params: { id, returnTo: "/transactions" },
      });
  }, [swipe, selectionMode, onToggleItem, id]);
  return (
    <MonthSlideItem order={order}>
      <MotionView entrance={false} animateLayout exit>
        <View
          ref={rowRef}
          collapsable={false}
          style={{
            backgroundColor: selected ? theme.accentContainer : theme.surface,
            boxShadow: theme.shadowCard,
            borderTopLeftRadius: first ? radius.card : 0,
            borderTopRightRadius: first ? radius.card : 0,
            borderBottomLeftRadius: last ? radius.card : 0,
            borderBottomRightRadius: last ? radius.card : 0,
            borderCurve: "continuous",
            // Always clipped: a row's state layer bleeds into this padding and takes the slab's
            // corners from the clip, and the flash overlay needs the same shape.
            overflow: "hidden",
          }}
        >
          <SwipeableRow
            id={id}
            actions={actions}
            background={selected ? theme.accentContainer : theme.surface}
            paddingHorizontal={space.md}
          >
            {first ? null : (
              <View
                style={{
                  height: StyleSheet.hairlineWidth,
                  backgroundColor: theme.border,
                  marginStart: 52,
                }}
              />
            )}
            {/* The slab's own padding is what a row's wash bleeds into, so it is published around
              the row alone: the divider and the action row below are not rows. */}
            <StateLayerBoundsContext.Provider
              value={{ x: space.md, top: 0, bottom: 0 }}
            >
              <TransactionRow
                transaction={item}
                showDate={false}
                selectionMode={selectionMode}
                selected={selected}
                onLongPress={handleLongPress}
                onPress={handlePress}
                rowActions={paying ? NO_ROW_ACTIONS : actions}
                onRowAction={onRowAction}
              />
            </StateLayerBoundsContext.Provider>
            {item.status === "upcoming" && !selectionMode ? (
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "flex-end",
                  gap: space.sm,
                  paddingBottom: space.xs,
                }}
              >
                <TextButton
                  title="Skip"
                  tone="muted"
                  onPress={() => handleInlineAction("skip")}
                />
                <TextButton
                  title="Mark paid"
                  onPress={() => handleInlineAction("markPaid")}
                />
              </View>
            ) : null}
          </SwipeableRow>
          {/* Last, so it paints over the row's opaque sliding content; the slab clips it. */}
          {flashes > 0 ? (
            <RowFlash key={flashToken} flashes={flashes} onDone={onFlashDone} />
          ) : null}
        </View>
      </MotionView>
    </MonthSlideItem>
  );
});
