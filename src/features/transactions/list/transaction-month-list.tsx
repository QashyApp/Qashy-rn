import { router } from "expo-router";
import { memo, useCallback, useMemo, type ComponentProps } from "react";
import { SectionList, StyleSheet, View, type ViewStyle } from "react-native";

import { TransactionRow } from "@/components/finance/transaction-row";
import type { TransactionRecord } from "@/domain/models";
import { ActionButton } from "@/components/ui/action-button";
import { AppText } from "@/components/ui/app-text";
import { EmptyState } from "@/components/ui/empty-state";
import type { MonthDirection } from "@/components/ui/month-switcher";
import { PAGER_SCROLLER_STYLE } from "@/components/ui/month-pager";
import { MotionView } from "@/components/ui/motion";
import { TextButton } from "@/components/ui/text-button";
import { dayNetMinor } from "@/features/transactions/list/summary";
import { groupTransactionsByDay } from "@/features/transactions/list/sections";
import { useLocalization } from "@/localization/localization";
import {
  useFinanceRepository,
  useFinanceState,
} from "@/providers/finance-provider";
import { useQashyTheme } from "@/theme/theme";
import {
  endOfMonth,
  monthLabel,
  parseLocalDate,
  startOfMonth,
} from "@/utils/date";
import { hapticImpactLight } from "@/utils/haptics";
import { formatMoney } from "@/utils/money";

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
  onToggleSelectionMode: () => void;
  onToggleItem: (id: string) => void;
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
  onToggleSelectionMode,
  onToggleItem,
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
  const currency = state.settings.baseCurrency;

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
    () => groupTransactionsByDay(transactions),
    [transactions],
  );

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

  return (
    <SectionList
      contentInsetAdjustmentBehavior="automatic"
      onScroll={isCurrent ? onScroll : undefined}
      scrollEventThrottle={16}
      scrollEnabled={isCurrent}
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
            (Number(content.paddingBottom) || 0) + (selectionMode ? 140 : 0),
        },
      ]}
      sections={sections}
      extraData={`${selectedIds.join(",")}|${selectionMode}|${resolvingId}`}
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
        const net = dayNetMinor(section.data);
        const netText = formatMoney(net, currency, locale, { sign: true });
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
            <AppText literal figure variant="caption" muted numeric>
              {netText}
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
          onToggleItem={onToggleItem}
          onLongPressItem={onLongPressItem}
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
  );
});

interface DayRowProps {
  item: TransactionRecord;
  first: boolean;
  last: boolean;
  selected: boolean;
  selectionMode: boolean;
  resolving: boolean;
  onToggleItem: (id: string) => void;
  onLongPressItem: (id: string) => void;
  onResolveUpcoming: (id: string, action: "skip" | "confirm") => void;
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
  onToggleItem,
  onLongPressItem,
  onResolveUpcoming,
}: DayRowProps) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const id = item.id;
  const handleLongPress = useCallback(() => {
    if (!selectionMode) hapticImpactLight();
    onLongPressItem(id);
  }, [selectionMode, onLongPressItem, id]);
  const handlePress = useMemo(
    () => (selectionMode ? () => onToggleItem(id) : undefined),
    [selectionMode, onToggleItem, id],
  );
  return (
    <MotionView entrance={false} animateLayout exit>
      <View
        style={{
          paddingHorizontal: space.md,
          backgroundColor: selected ? theme.accentContainer : theme.surface,
          boxShadow: theme.shadowCard,
          borderTopLeftRadius: first ? radius.card : 0,
          borderTopRightRadius: first ? radius.card : 0,
          borderBottomLeftRadius: last ? radius.card : 0,
          borderBottomRightRadius: last ? radius.card : 0,
          borderCurve: "continuous",
        }}
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
