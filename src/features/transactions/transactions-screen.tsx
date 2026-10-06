import { router, useLocalSearchParams } from "expo-router";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import {
  BackHandler,
  ScrollView,
  SectionList,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionButton } from "@/components/ui/action-button";
import { AppIcon } from "@/components/ui/app-icon";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { Collapsible } from "@/components/ui/collapsible";
import { FloatingActionButton } from "@/components/ui/floating-action-button";
import { IconButton } from "@/components/ui/icon-button";
import { useSharedValue } from "react-native-reanimated";

import { MonthSwitcher } from "@/components/ui/month-switcher";
import {
  MonthPager,
  monthIndex,
  navigateMonth,
  type MonthPagerHandle,
} from "@/components/ui/month-pager";
import { MotionView, ScreenTransition } from "@/components/ui/motion";
import { PageHeading } from "@/components/ui/page-heading";
import {
  floatingActionMetrics,
  screenContentMetrics,
} from "@/components/ui/screen-container";
import { useScrollCollapse } from "@/components/ui/use-scroll-collapse";
import { useScrollHide } from "@/components/ui/use-scroll-hide";
import { useSectionScrollToTop } from "@/components/ui/use-section-scroll-to-top";
import type { TransactionRecord } from "@/domain/models";
import { CollapsingSummaryTiles } from "@/features/transactions/summary-tiles";
import { BatchEditSheet } from "@/features/transactions/list/batch-edit-sheet";
import type { LedgerSection } from "@/features/transactions/list/sections";
import {
  TransactionMonthList,
  type KindFilter,
} from "@/features/transactions/list/transaction-month-list";
import { useLocalization } from "@/localization/localization";
import {
  useFinanceRepository,
  useFinanceState,
} from "@/providers/finance-provider";
import { resolveBottomChromeInset, useScreenMetrics } from "@/theme/layout";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import { fontStyle } from "@/theme/typography";
import { confirmDestructive, errorMessage, showError } from "@/utils/confirm";
import {
  endOfMonth,
  monthKey,
  monthLabel,
  parseMonthKey,
  startOfMonth,
  todayLocal,
} from "@/utils/date";
import { useDashboardRange } from "@/features/overview/widgets/use-dashboard";
import { hapticSelection, hapticSuccess } from "@/utils/haptics";

const KIND_OPTIONS = [
  { value: "all", label: "All", icon: "list.bullet.rectangle" },
  { value: "expense", label: "Expense", icon: "arrow.up" },
  { value: "income", label: "Income", icon: "arrow.down" },
  { value: "transfer", label: "Transfer", icon: "arrow.left.arrow.right" },
  { value: "upcoming", label: "Upcoming", icon: "clock" },
] as const;

/**
 * The ledger, one calendar month at a time.
 *
 * A single endless list made "what did I spend in March?" a scrolling task and
 * gave every number on the screen an unbounded scope. The month is now the
 * unit: the header says which one you are looking at and what it added up to,
 * and the list below is only that month. Search is the one deliberate escape
 * hatch — looking for "that dentist bill" should not require knowing when it
 * was — so it can be widened to every month explicitly.
 *
 * The month lives in the `month` route param (`YYYY-MM`) so web deep links and
 * Overview's "See all" land on the right page. A month is view state, not a
 * finance record, so it is the one thing this screen puts in the URL.
 */
export function TransactionsScreen() {
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const { isRtl, locale, t } = useLocalization();
  const metrics = useScreenMetrics();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ month?: string }>();
  const [month, setMonth] = useState(
    () => parseMonthKey(params.month) ?? startOfMonth(),
  );
  const [search, setSearch] = useState("");
  // The input stays on the live value; the list re-queries at low priority so typing never
  // waits on filtering every transaction.
  const deferredSearch = useDeferredValue(search);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchAllMonths, setSearchAllMonths] = useState(false);
  const [kind, setKind] = useState<KindFilter>("all");
  const { visibility: fabVisibility, onScroll: onScrollHide } = useScrollHide();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  // A drag-select in progress: the top section folds only once the finger lifts, so the rows
  // do not slide out from under it mid-drag.
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const pagerRef = useRef<MonthPagerHandle>(null);
  // The pager's place on the month axis, shared with the month title so it slides with the swipe.
  const monthPosition = useSharedValue(monthIndex(month));
  const listRef =
    useSectionScrollToTop<
      SectionList<TransactionRecord, LedgerSection<TransactionRecord>>
    >();
  const [upcomingCollapsed, setUpcomingCollapsed] = useState(false);
  // On a phone the search and filters fold away while reading down the list and the month's
  // totals shrink to one line; both return on the way back up. They stay open while searching.
  const phoneWidth = metrics.contentWidth < 520;
  // Selecting folds them too, the same way scrolling does: the batch bar takes room at the
  // bottom, so the list needs all it can get at the top. Typing in search keeps them open.
  const { collapse, onScroll: onScrollCollapse } = useScrollCollapse({
    enabled: phoneWidth,
    locked: searchFocused || search.length > 0,
    forceCollapsed: selectionMode && !dragActive && !searchFocused,
  });
  const onScroll: NonNullable<
    ComponentProps<typeof SectionList>["onScroll"]
  > = (event) => {
    onScrollHide(event);
    onScrollCollapse(event);
  };

  // Follow the param when something else navigates here with one (Overview's
  // "See all", the transaction sheet returning to the month it saved into).
  // Adjusted during render rather than in an effect, so the list never paints
  // one frame of the previous month first.
  const paramMonth = parseMonthKey(params.month);
  const [followedParam, setFollowedParam] = useState(paramMonth);
  // Params this screen wrote itself and has not seen come back yet. The router echoes them late, so
  // a quick second swipe would otherwise be yanked back to the first one's month when it lands.
  const [ownParams, setOwnParams] = useState<string[]>([]);
  if (paramMonth !== followedParam) {
    setFollowedParam(paramMonth);
    const echo = paramMonth ? ownParams.indexOf(monthKey(paramMonth)) : -1;
    if (echo >= 0) {
      setOwnParams(ownParams.slice(echo + 1));
    } else if (paramMonth && paramMonth !== month) {
      setMonth(paramMonth);
      setSelectedIds([]);
    }
  }

  const changeMonth = (next: string) => {
    setMonth(next);
    setSelectedIds([]);
    setOwnParams((own) => [...own, monthKey(next)]);
    router.setParams({ month: monthKey(next) });
  };

  const allMonths = searchAllMonths && search.trim().length > 0;
  const fromDate = startOfMonth(month);
  const toDate = endOfMonth(month);

  const selectedIdSet = new Set(selectedIds);
  const selectedTransactions = state.transactions.filter((item) =>
    selectedIdSet.has(item.id),
  );
  const hasSelectedTransfers = selectedTransactions.some(
    (item) => item.kind === "transfer",
  );
  const selectedKinds = [
    ...new Set(
      selectedTransactions
        .filter((item) => item.kind !== "transfer")
        .map((item) => item.kind),
    ),
  ];
  const compatibleCategoryKind =
    selectedKinds.length === 1 ? selectedKinds[0] : null;

  // Totals come from the dashboard aggregate rather than from summing the rows
  // here: it already excludes transfers, uses each transaction's snapshotted
  // base-currency amount, and matches what Overview shows for the same month.
  const summary = useDashboardRange(fromDate, toDate);

  // Where "Go to latest" leads when this month is empty.
  const latestMonth = useMemo(() => {
    const [latest] = repository.queryTransactions(
      { statuses: ["posted"], limit: 1 },
      state.transactions,
    );
    return latest ? startOfMonth(latest.localDate) : null;
  }, [repository, state.transactions]);

  const clearSelection = () => setSelectedIds([]);

  const exitSelection = () => {
    setSelectedIds([]);
    setSelectionMode(false);
    setEditOpen(false);
  };

  // The hardware back button leaves selection mode before it leaves the screen.
  useEffect(() => {
    if (!selectionMode || process.env.EXPO_OS !== "android") return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        exitSelection();
        return true;
      },
    );
    return () => subscription.remove();
  }, [selectionMode]);

  // Where the batch date picker starts: the selection's own day when every row shares one.
  const selectedDates = new Set(
    selectedTransactions.map((item) => item.localDate),
  );
  const batchInitialDate =
    selectedDates.size === 1 ? [...selectedDates][0] : todayLocal();

  const toggleSelectionMode = () => {
    setSelectionMode((current) => !current);
    setSelectedIds([]);
  };

  const enterSelection = (id: string) => {
    setSelectionMode(true);
    toggleSelected(id, { silent: !selectionMode });
  };

  const toggleSelected = (id: string, options?: { silent?: boolean }) => {
    if (!options?.silent) hapticSelection();
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  // Guards a double-tap on a category chip or "Delete selected" from firing two
  // concurrent batch mutations, matching how every other mutating handler in the
  // app is gated.
  const changeCategory = async (categoryId: string | null) => {
    if (busy) return;
    const ids = [...selectedIds];
    setBusy(true);
    try {
      await repository.updateTransactionsCategory(ids, categoryId);
      hapticSuccess();
      exitSelection();
    } catch (reason) {
      showError(
        "Couldn’t change category",
        errorMessage(reason, "Try a compatible category."),
      );
    } finally {
      setBusy(false);
    }
  };

  const changeDate = async (localDate: string) => {
    if (busy) return;
    const ids = [...selectedIds];
    setBusy(true);
    try {
      await repository.updateTransactionsDate(ids, localDate);
      hapticSuccess();
      exitSelection();
      // Follow the transactions to their new month, so the move is visible.
      if (monthKey(localDate) !== monthKey(month))
        changeMonth(startOfMonth(localDate));
    } catch (reason) {
      showError("Couldn’t change the date", errorMessage(reason, "Try again."));
    } finally {
      setBusy(false);
    }
  };

  const deleteSelected = async () => {
    if (busy) return;
    const ids = [...selectedIds];
    if (
      !(await confirmDestructive({
        title:
          ids.length === 1
            ? "Delete 1 transaction?"
            : `Delete ${ids.length} transactions?`,
        message: "They will be removed from your ledger.",
      }))
    )
      return;
    setBusy(true);
    try {
      await repository.deleteEntities("transactions", ids);
      hapticSuccess();
      exitSelection();
    } catch (reason) {
      showError(
        "Couldn’t delete transactions",
        errorMessage(reason, "Try again."),
      );
    } finally {
      setBusy(false);
    }
  };

  const resolveUpcoming = async (id: string, action: "skip" | "confirm") => {
    if (resolvingId) return;
    setResolvingId(id);
    try {
      await (action === "skip"
        ? repository.skipUpcoming(id)
        : repository.confirmUpcoming(id));
      if (action === "confirm") hapticSuccess();
      else hapticSelection();
    } catch (reason) {
      showError(
        action === "skip"
          ? "Couldn’t skip this item"
          : "Couldn’t mark this item paid",
        errorMessage(reason, "Try again."),
      );
    } finally {
      setResolvingId(null);
    }
  };

  const clearFilters = () => {
    setSearch("");
    setSearchAllMonths(false);
    setKind("all");
    clearSelection();
  };

  // The list content and the pinned toolbar have to occupy the same column, so
  // both derive their width and gutters from one call.
  // A ledger is a reading column: past this width amounts drift far from their titles.
  const content = {
    ...screenContentMetrics(metrics, insets, space),
    maxWidth: 860,
  };
  const toolbarStyle = {
    width: content.width,
    maxWidth: content.maxWidth,
    alignSelf: content.alignSelf,
    paddingLeft: content.paddingLeft,
    paddingRight: content.paddingRight,
    paddingTop: content.paddingTop,
    paddingBottom: metrics.contentWidth < 520 ? space.sm : space.md,
    // Tighter on phones, where the pinned toolbar otherwise eats the list's room.
    gap: metrics.contentWidth < 520 ? space.sm : space.md,
  } as const;
  const gutter = Number(content.paddingLeft ?? 0);
  const currency = state.settings.baseCurrency;
  const compactFigures = metrics.contentWidth < 520;
  const toolbarGap = toolbarStyle.gap;
  // The floating batch bar takes the FAB's usual spot while it is open, so the
  // two never compete for the same corner of the screen — adding a transaction
  // mid-selection is also just confusing.
  const { batchBarBottom } = resolveBottomChromeInset(
    metrics,
    insets.bottom,
    space,
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScreenTransition style={{ flex: 1 }}>
        {/* Month, search and filters sit outside the list, not inside its header.
          Scrolled away, they made the ledger's most-used controls unreachable
          exactly when a long list made them necessary. Pinned, the list becomes
          a result set that responds under a control surface that stays put. */}
        <View
          style={{
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.border,
            backgroundColor: theme.background,
            zIndex: 2,
          }}
        >
          <View style={toolbarStyle}>
            <PageHeading title="Transactions" />
            <View style={{ gap: space.md }}>
              <View style={{ alignSelf: "flex-start" }}>
                <MonthSwitcher
                  value={month}
                  onChange={(next, direction) =>
                    navigateMonth(
                      pagerRef.current,
                      month,
                      next,
                      direction,
                      changeMonth,
                    )
                  }
                  disabled={allMonths}
                  position={monthPosition}
                />
              </View>
              <View
                accessibilityLabel={
                  allMonths
                    ? undefined
                    : `${monthLabel(month, locale)} ${t("summary")}`
                }
                style={{ opacity: allMonths ? 0.45 : 1 }}
              >
                <CollapsingSummaryTiles
                  currency={currency}
                  locale={locale}
                  compactFigures={compactFigures}
                  collapse={collapse}
                  tiles={[
                    {
                      label: "Income",
                      amountMinor: summary.incomeMinor,
                      color: theme.positive,
                    },
                    {
                      label: "Spent",
                      amountMinor: summary.expenseMinor,
                      color: theme.text,
                    },
                    {
                      label: "Net",
                      amountMinor: summary.netFlowMinor,
                      color:
                        summary.netFlowMinor > 0
                          ? theme.positive
                          : summary.netFlowMinor < 0
                            ? theme.negative
                            : theme.text,
                    },
                  ]}
                />
              </View>
            </View>
            <Collapsible
              collapse={collapse}
              gapBefore={toolbarGap}
              style={{ gap: toolbarGap }}
            >
              <View
                style={{
                  minHeight: 44,
                  borderRadius: radius.pill,
                  borderCurve: "continuous",
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: space.lg,
                  gap: space.sm,
                  ...materialStyle(theme, "sunken"),
                  ...(searchFocused
                    ? { boxShadow: `inset 0 0 0 2px ${String(theme.accent)}` }
                    : null),
                }}
              >
                <AppIcon
                  name="magnifyingglass"
                  color={theme.textMuted}
                  size={18}
                />
                <TextInput
                  accessibilityLabel={t("Search transactions")}
                  placeholder={t(
                    searchAllMonths ? "Search all months" : "Search this month",
                  )}
                  placeholderTextColor={theme.textMuted}
                  value={search}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  onChangeText={(value) => {
                    setSearch(value);
                    clearSelection();
                  }}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    color: theme.text,
                    fontSize: 16,
                    ...fontStyle("regular", theme.type),
                    writingDirection: isRtl ? "rtl" : "ltr",
                    textAlign: isRtl ? "right" : "left",
                  }}
                />
                {search ? (
                  <IconButton
                    label="Clear search"
                    icon="xmark"
                    iconSize={17}
                    enteringVariant="zoom"
                    onPress={() => {
                      setSearch("");
                      clearSelection();
                    }}
                    style={{ marginEnd: -space.sm }}
                  />
                ) : null}
              </View>
              {search ? (
                <MotionView
                  variant="down"
                  exit
                  animateLayout
                  style={{ flexDirection: "row" }}
                >
                  <ChoiceChip
                    mode="checkbox"
                    icon="calendar"
                    label="Search all months"
                    selected={searchAllMonths}
                    onPress={() => {
                      setSearchAllMonths((current) => !current);
                      clearSelection();
                    }}
                  />
                </MotionView>
              ) : null}
              {/* Five options do not fit a segmented control on a phone without
              truncating, so they scroll sideways as one row instead of wrapping. */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                accessibilityRole="radiogroup"
                accessibilityLabel={t("Transaction type filter")}
                // Bleeds to the screen edge so chips scroll out from under the gutter.
                style={{ marginHorizontal: -gutter }}
                contentContainerStyle={{
                  gap: space.sm,
                  paddingHorizontal: gutter,
                }}
              >
                {KIND_OPTIONS.map((option) => (
                  <ChoiceChip
                    key={option.value}
                    label={option.label}
                    icon={option.icon}
                    selected={kind === option.value}
                    onPress={() => {
                      setKind(option.value);
                      clearSelection();
                    }}
                  />
                ))}
              </ScrollView>
            </Collapsible>
          </View>
        </View>
        <MonthPager
          ref={pagerRef}
          position={monthPosition}
          month={month}
          disabled={allMonths || selectionMode}
          onChange={changeMonth}
          style={{ flex: 1 }}
          renderPage={(pageMonth, { isCurrent }) => (
            <TransactionMonthList
              month={pageMonth}
              isCurrent={isCurrent}
              search={deferredSearch}
              kind={kind}
              allMonths={searchAllMonths && deferredSearch.trim().length > 0}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              resolvingId={resolvingId}
              latestMonth={latestMonth}
              content={content}
              onScroll={onScroll}
              listRef={listRef}
              upcomingCollapsed={upcomingCollapsed}
              onToggleUpcoming={() => setUpcomingCollapsed((value) => !value)}
              onToggleSelectionMode={toggleSelectionMode}
              onToggleItem={toggleSelected}
              onSetSelection={setSelectedIds}
              onLongPressItem={enterSelection}
              onDragActiveChange={setDragActive}
              onResolveUpcoming={resolveUpcoming}
              onClearFilters={clearFilters}
              onGoToMonth={changeMonth}
            />
          )}
        />
      </ScreenTransition>
      {selectionMode ? (
        <MotionView
          variant="up"
          exit
          animateLayout
          style={{
            position: "absolute",
            left: gutter,
            right: gutter,
            bottom: batchBarBottom,
            maxWidth: content.maxWidth,
            alignSelf: "center",
          }}
        >
          {/* One compact row: what to do with the selection on one side, deleting it on the
            other. The choices behind "Edit" live in a sheet, so the bar never grows into the
            list it is acting on. The count and "Done selecting" sit at the top of the list. */}
          <View
            style={{
              flexDirection: "row",
              gap: space.sm,
              padding: space.sm,
              borderRadius: radius.sheet,
              borderCurve: "continuous",
              ...materialStyle(theme, "overlay"),
            }}
          >
            <ActionButton
              title={`Edit (${selectedIds.length})`}
              icon="ion:create-outline"
              variant="secondary"
              disabled={busy || !selectedIds.length}
              onPress={() => setEditOpen(true)}
              style={{ flex: 1 }}
            />
            <ActionButton
              title="Delete"
              icon="trash"
              variant="danger"
              disabled={busy || !selectedIds.length}
              onPress={deleteSelected}
              style={{ flex: 1 }}
            />
          </View>
        </MotionView>
      ) : (
        <FloatingActionButton
          label="Add transaction"
          visibility={fabVisibility}
          onPress={() =>
            router.push({
              pathname: "/transaction",
              params: { returnTo: "/transactions" },
            })
          }
          style={floatingActionMetrics(metrics, insets, space)}
        />
      )}
      <BatchEditSheet
        visible={selectionMode && editOpen}
        count={selectedIds.length}
        categories={
          compatibleCategoryKind && !hasSelectedTransfers
            ? state.categories.filter(
                (item) =>
                  item.kind === compatibleCategoryKind && !item.archived,
              )
            : []
        }
        categoryBlockedReason={
          hasSelectedTransfers
            ? "Transfers do not have categories."
            : selectedKinds.length > 1
              ? "Select only income or only expense transactions to assign a category."
              : null
        }
        initialDate={batchInitialDate}
        busy={busy}
        onChangeCategory={changeCategory}
        onChangeDate={changeDate}
        onClose={() => setEditOpen(false)}
      />
    </View>
  );
}
