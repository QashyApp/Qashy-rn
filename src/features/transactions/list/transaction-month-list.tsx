import { router } from "expo-router";
import { GestureDetector } from "react-native-gesture-handler";
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
  type ViewStyle,
} from "react-native";

import { TransactionRow } from "@/components/finance/transaction-row";
import type { TransactionRecord } from "@/domain/models";
import { ActionButton } from "@/components/ui/action-button";
import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { EmptyState } from "@/components/ui/empty-state";
import type { MonthDirection } from "@/components/ui/month-switcher";
import { PAGER_SCROLLER_STYLE } from "@/components/ui/month-pager";
import { MotionView } from "@/components/ui/motion";
import { TextButton } from "@/components/ui/text-button";
import { useDragSelect } from "@/features/transactions/list/use-drag-select";
import { RowFlash } from "@/features/transactions/list/row-flash";
import {
  consumeSavedTransactionSignal,
  getSavedTransactionSignal,
  subscribeSavedTransactionSignal,
} from "@/features/transactions/list/saved-transaction-signal";
import {
  groupLedgerSections,
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
import { hapticImpactLight, hapticSelection } from "@/utils/haptics";

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
  selectedIds: readonly string[];
  resolvingId: string | null;
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
  onResolveUpcoming: (id: string, action: "skip" | "confirm") => void;
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
  resolvingId,
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
  onResolveUpcoming,
  onClearFilters,
  onGoToMonth,
}: TransactionMonthListProps) {
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const theme = useQashyTheme();
  const { space } = theme;
  const { locale, t } = useLocalization();

  const fromDate = startOfMonth(month);
  const toDate = endOfMonth(month);

  // `state.categories` is listed because the repository reads it internally for
  // hierarchy-aware search; the snapshot argument alone would not re-run this
  // when a category is renamed.
  const categoriesVersion = state.categories;
  const transactions = useMemo(() => {
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

  const sections = useMemo(
    () =>
      groupLedgerSections(transactions, {
        groupUpcoming: kind === "all",
        upcomingCollapsed,
      }),
    [transactions, kind, upcomingCollapsed],
  );

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
          animated: true,
        });
      } catch {
        // Not measurable yet; the row is flashed in place and the list stays where it is.
      }
    },
    [listRef],
  );
  const savedMonthMatches =
    savedSignal !== null &&
    (allMonths || savedSignal.month === monthKey(month));
  const savedId = savedSignal?.id ?? null;
  const savedToken = savedSignal?.token ?? null;
  const savedFlashes = savedSignal?.flashes ?? 0;
  useEffect(() => {
    if (!isCurrent || !savedMonthMatches || savedId === null) return;
    const target = transactions.find((item) => item.id === savedId);
    if (!target) return;
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
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Press, hold and drag across rows to select them all (see `useDragSelect`).
  const containerRef = useRef<View>(null);
  const scrollOffset = useRef(0);
  const orderedIds = useMemo(
    () => sections.flatMap((section) => section.data.map((item) => item.id)),
    [sections],
  );
  const scrollBy = useCallback(
    (delta: number) => {
      const next = Math.max(0, scrollOffset.current + delta);
      listRef?.current?.getScrollResponder()?.scrollTo?.({
        y: next,
        animated: false,
      });
    },
    [listRef],
  );
  const { gesture, registerRow, arm, dragging } = useDragSelect({
    enabled: isCurrent,
    orderedIds,
    selectedIds,
    onSelect: onSetSelection,
    containerRef,
    scrollBy,
  });

  return (
    <GestureDetector gesture={gesture}>
      <View ref={containerRef} collapsable={false} style={{ flex: 1 }}>
        <SectionList
          ref={isCurrent ? listRef : undefined}
          contentInsetAdjustmentBehavior="automatic"
          onScroll={
            isCurrent
              ? (event) => {
                  scrollOffset.current = event.nativeEvent.contentOffset.y;
                  onScroll?.(event);
                }
              : undefined
          }
          scrollEventThrottle={16}
          // A drag-select owns the finger until it lifts. The web cancels its touch scrolling
          // instead (see `useDragSelect`), and changing overflow there mid-touch would jump.
          scrollEnabled={
            isCurrent && !(dragging && process.env.EXPO_OS !== "web")
          }
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
          extraData={`${selectedIds.join(",")}|${selectionMode}|${resolvingId}|${flash?.token}:${flash?.id}`}
          onScrollToIndexFailed={(info) => {
            // A row far off-screen has no measured height yet: jump near it, then try once more.
            listRef?.current?.getScrollResponder()?.scrollTo?.({
              y: info.averageItemLength * info.index,
              animated: false,
            });
            const target = flash?.id;
            if (target) setTimeout(() => scrollToSaved(target), 120);
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
                  `${transactions.length} ${transactions.length === 1 ? "transaction" : "transactions"}`,
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
          renderSectionHeader={({ section }) => {
            if (section.kind === "upcoming") {
              return (
                <UpcomingHeader
                  count={section.count ?? section.data.length}
                  collapsed={upcomingCollapsed}
                  onToggle={onToggleUpcoming}
                />
              );
            }
            return (
              // Opaque, because a sticky header scrolls over live content. The
              // negative margins let the fill reach the column's gutters so rows do
              // not slide past it in the margin.
              <View
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
              </View>
            );
          }}
          // Each day is one grouped surface with hairlines between its rows,
          // rather than a separate card per transaction. A true nested `Card`
          // can't wrap a section's rows here — `SectionList` virtualises each
          // row independently, so there is no single element spanning a whole
          // day to attach one shadow to. Every row instead carries the same
          // flat `card` background and shadow (no gradient, which would band
          // visibly repeating down a multi-row day); stacked with no gap and
          // rounded only at the day's first/last row, they read as one raised
          // slab per day rather than as N separate rows happening to touch.
          renderItem={({ item, index, section }) => (
            <DayRow
              item={item}
              first={index === 0}
              last={index === section.data.length - 1}
              selected={selectedSet.has(item.id)}
              selectionMode={selectionMode}
              resolving={resolvingId !== null}
              flashes={flash?.id === item.id ? flash.flashes : 0}
              flashToken={flash?.token ?? 0}
              onFlashDone={clearFlash}
              onToggleItem={onToggleItem}
              onLongPressItem={onLongPressItem}
              registerRow={registerRow}
              onArmDrag={arm}
              onResolveUpcoming={onResolveUpcoming}
            />
          )}
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

interface DayRowProps {
  item: TransactionRecord;
  first: boolean;
  last: boolean;
  selected: boolean;
  selectionMode: boolean;
  resolving: boolean;
  /** Non-zero while this row is the one just saved. */
  flashes: number;
  flashToken: number;
  onFlashDone: () => void;
  onToggleItem: (id: string) => void;
  onLongPressItem: (id: string) => void;
  /** Lets the screen find this row's view while a drag-select passes over it. */
  registerRow: (id: string, node: View | null) => void;
  /** A long-press just selected this row: a drag from here extends the selection. */
  onArmDrag: (id: string) => void;
  onResolveUpcoming: (id: string, action: "skip" | "confirm") => void;
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
        backgroundColor: theme.background,
        paddingTop: space.md,
        marginHorizontal: -space.xs,
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
        />
        <AppText variant="overline" muted>
          Upcoming
        </AppText>
      </View>
      <AppText literal figure variant="caption" muted numeric>
        {String(count)}
      </AppText>
    </Pressable>
  );
}

/**
 * One row of a day's grouped surface. Memoized so a selection change or a refreshed snapshot
 * re-renders only the rows whose own inputs changed, not every row the list has mounted.
 */
const DayRow = memo(function DayRow({
  item,
  first,
  last,
  selected,
  selectionMode,
  resolving,
  flashes,
  flashToken,
  onFlashDone,
  onToggleItem,
  onLongPressItem,
  registerRow,
  onArmDrag,
  onResolveUpcoming,
}: DayRowProps) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const id = item.id;
  const handleLongPress = useCallback(() => {
    if (!selectionMode) hapticImpactLight();
    onLongPressItem(id);
    // A row that was already selected is deselected by the press, so there is nothing to drag from.
    if (!selected) onArmDrag(id);
  }, [selectionMode, selected, onLongPressItem, onArmDrag, id]);
  const rowRef = useCallback(
    (node: View | null) => {
      registerRow(id, node);
    },
    [registerRow, id],
  );
  const handlePress = useMemo(
    () => (selectionMode ? () => onToggleItem(id) : undefined),
    [selectionMode, onToggleItem, id],
  );
  return (
    <MotionView entrance={false} animateLayout exit>
      <View
        ref={rowRef}
        collapsable={false}
        style={{
          // A selected row can be dragged from to extend the selection, so a browser must not scroll it.
          ...(selected && process.env.EXPO_OS === "web"
            ? ({ touchAction: "none" } as object)
            : null),
          paddingHorizontal: space.md,
          backgroundColor: selected ? theme.accentContainer : theme.surface,
          boxShadow: theme.shadowCard,
          borderTopLeftRadius: first ? radius.card : 0,
          borderTopRightRadius: first ? radius.card : 0,
          borderBottomLeftRadius: last ? radius.card : 0,
          borderBottomRightRadius: last ? radius.card : 0,
          borderCurve: "continuous",
          // Only while flashing, so the highlight keeps the day slab's rounded corners.
          overflow: flashes > 0 ? "hidden" : undefined,
        }}
      >
        {flashes > 0 ? (
          <RowFlash key={flashToken} flashes={flashes} onDone={onFlashDone} />
        ) : null}
        {first ? null : (
          <View
            style={{
              height: StyleSheet.hairlineWidth,
              backgroundColor: theme.border,
              marginStart: 52,
            }}
          />
        )}
        <TransactionRow
          transaction={item}
          showDate={false}
          selectionMode={selectionMode}
          selected={selected}
          onLongPress={handleLongPress}
          onPress={handlePress}
        />
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
              disabled={resolving}
              onPress={() => onResolveUpcoming(id, "skip")}
            />
            <TextButton
              title="Mark paid"
              disabled={resolving}
              onPress={() => onResolveUpcoming(id, "confirm")}
            />
          </View>
        ) : null}
      </View>
    </MotionView>
  );
});
