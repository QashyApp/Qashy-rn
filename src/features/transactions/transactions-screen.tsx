import { CountUpSubject } from "@/components/finance/animated-money";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  useCallback,
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
  navigateMonth,
  restingPosition,
  type MonthPagerHandle,
} from "@/components/ui/month-pager";
import { MotionView, ScreenTransition } from "@/components/ui/motion";
import { UndoBar } from "@/components/ui/undo-bar";
import { PageHeading } from "@/components/ui/page-heading";
import {
  floatingActionMetrics,
  screenContentMetrics,
} from "@/components/ui/screen-container";
import { useScrollCollapse } from "@/components/ui/use-scroll-collapse";
import { useScrollHide } from "@/components/ui/use-scroll-hide";
import { useSectionScrollToTop } from "@/components/ui/use-section-scroll-to-top";
import type { TransactionRecord } from "@/domain/models";
import {
  ROW_ACTION_UNDO_MS,
  rowActionsMessage,
  usePendingRowActions,
  type RowActionKind,
} from "@/features/transactions/row-actions";
import type { RowSwipeActionKind } from "@/features/transactions/list/row-swipe/row-swipe-actions";
import {
  RowSwipeContext,
  useCloseRowSwipeWhen,
  useRowSwipe,
} from "@/features/transactions/list/row-swipe/use-row-swipe";
import { totalsWithoutHidden } from "@/features/transactions/list/summary";
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
import {
  hapticSelection,
  hapticSuccess,
  hapticWarning,
} from "@/services/haptics";

/** The Undo bar's timeout: each pending action commits on its own timer, not on the bar's. */
function ignoreDismiss() {}

/** The selection a page that is not the current one gets: neighbours never hold a selection. */
const NO_SELECTION: ReadonlySet<string> = new Set();
const NO_TRANSACTIONS: readonly TransactionRecord[] = [];

/** How long the month has to hold still before the URL is updated to it. */
const PARAM_DELAY = 400;

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
  // The row whose "Change category" swipe action is open in the sheet.
  const [categoryRowId, setCategoryRowId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  // A drag-select in progress: the top section folds only once the finger lifts, so the rows
  // do not slide out from under it mid-drag.
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const pagerRef = useRef<MonthPagerHandle>(null);
  const dragProgress = useSharedValue(restingPosition(month, isRtl));
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
  const onScroll = useCallback<
    NonNullable<ComponentProps<typeof SectionList>["onScroll"]>
  >(
    (event) => {
      onScrollHide(event);
      onScrollCollapse(event);
    },
    [onScrollHide, onScrollCollapse],
  );

  // Follow the param when something else navigates here with one (Overview's
  // "See all", the transaction sheet returning to the month it saved into).
  // Adjusted during render rather than in an effect, so the list never paints
  // one frame of the previous month first.
  const paramMonth = parseMonthKey(params.month);
  const [followedParam, setFollowedParam] = useState(paramMonth);
  // Params this screen wrote itself and has not seen come back yet. The router echoes them late, so
  // a quick second swipe would otherwise be yanked back to the first one's month when it lands.
  const [ownParams, setOwnParams] = useState<string[]>([]);
  // This screen's own month change, not yet written to the URL.
  const [paramDue, setParamDue] = useState(false);
  if (paramMonth !== followedParam) {
    setFollowedParam(paramMonth);
    const echo = paramMonth ? ownParams.indexOf(monthKey(paramMonth)) : -1;
    if (echo >= 0) {
      setOwnParams(ownParams.slice(echo + 1));
    } else {
      // Something else navigated here: its month wins over one this screen had yet to write.
      setParamDue(false);
      if (paramMonth && paramMonth !== month) {
        setMonth(paramMonth);
        setSelectedIds([]);
      }
    }
  }

  // Stable, like every handler handed to the month pages: a row crossed by a drag-select
  // re-renders this screen, and a new function would rebuild the props of every page.
  const changeMonth = useCallback((next: string) => {
    setMonth(next);
    // Kept as is when already empty: a new array re-rendered every mounted month page.
    setSelectedIds((current) => (current.length ? [] : current));
    setParamDue(true);
  }, []);
  // The URL follows once the month stops changing. Writing it on every swipe re-rendered the
  // screen twice more per month (the write, then the router's echo), right as the next swipe began.
  useEffect(() => {
    if (!paramDue) return;
    const timer = setTimeout(() => {
      setParamDue(false);
      setOwnParams((own) => [...own, monthKey(month)]);
      router.setParams({ month: monthKey(month) });
    }, PARAM_DELAY);
    return () => clearTimeout(timer);
  }, [paramDue, month]);

  const allMonths = searchAllMonths && search.trim().length > 0;
  const fromDate = startOfMonth(month);
  const toDate = endOfMonth(month);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  // Only the batch edit sheet reads what the selection holds, so a drag across rows (a new
  // selection per row crossed) does not scan every transaction until that sheet is open.
  const selectedTransactions = useMemo(
    () =>
      editOpen
        ? state.transactions.filter((item) => selectedIdSet.has(item.id))
        : NO_TRANSACTIONS,
    [editOpen, state.transactions, selectedIdSet],
  );
  const { hasSelectedTransfers, selectedKinds, batchInitialDate } =
    useMemo(() => {
      const kinds = [
        ...new Set(
          selectedTransactions
            .filter((item) => item.kind !== "transfer")
            .map((item) => item.kind),
        ),
      ];
      // Where the batch date picker starts: the selection's own day when every row shares one.
      const dates = new Set(selectedTransactions.map((item) => item.localDate));
      return {
        hasSelectedTransfers: selectedTransactions.some(
          (item) => item.kind === "transfer",
        ),
        selectedKinds: kinds,
        batchInitialDate: dates.size === 1 ? [...dates][0] : todayLocal(),
      };
    }, [selectedTransactions]);
  const compatibleCategoryKind =
    selectedKinds.length === 1 ? selectedKinds[0] : null;

  // Totals come from the dashboard aggregate rather than from summing the rows
  // here: it already excludes transfers, uses each transaction's snapshotted
  // base-currency amount, and matches what Overview shows for the same month.
  const aggregate = useDashboardRange(fromDate, toDate);

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

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((current) => !current);
    setSelectedIds([]);
  }, []);

  const toggleSelected = useCallback(
    (id: string, options?: { silent?: boolean }) => {
      if (!options?.silent) hapticSelection();
      setSelectedIds((current) =>
        current.includes(id)
          ? current.filter((item) => item !== id)
          : [...current, id],
      );
    },
    [],
  );

  const enterSelection = useCallback(
    (id: string) => {
      setSelectionMode(true);
      toggleSelected(id, { silent: !selectionMode });
    },
    [selectionMode, toggleSelected],
  );
  const toggleUpcomingCollapsed = useCallback(
    () => setUpcomingCollapsed((value) => !value),
    [],
  );

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

  // Delete, Skip and Mark paid cannot be taken back once the repository has them, so the row
  // leaves the list at once and the real change waits for the Undo bar to run out.
  const reportRowActionError = useCallback(
    (action: RowActionKind, reason: unknown) => {
      showError(
        action === "delete"
          ? "Couldn’t delete transactions"
          : action === "skip"
            ? "Couldn’t skip this item"
            : "Couldn’t mark this item paid",
        errorMessage(reason, "Try again."),
      );
    },
    [],
  );
  const {
    hiddenIds,
    paidIds,
    pending: pendingRowActions,
    schedule: scheduleRowAction,
    undo: undoRowAction,
  } = usePendingRowActions({ onError: reportRowActionError });
  // A swiped-away row is out of the list at once but the repository keeps it until its Undo window
  // ends, so the tiles leave it out too, or they would count what the list no longer shows.
  const summary = useMemo(
    () =>
      totalsWithoutHidden(
        aggregate,
        state.transactions,
        hiddenIds,
        fromDate,
        toDate,
      ),
    [aggregate, state.transactions, hiddenIds, fromDate, toDate],
  );
  const handleRowAction = useCallback(
    (id: string, action: RowSwipeActionKind, hideDelayMs?: number) => {
      if (action === "changeCategory") {
        setCategoryRowId(id);
        return true;
      }
      // A repeat of an action already taken on this row schedules nothing, so it buzzes nothing.
      if (!scheduleRowAction(id, action, hideDelayMs)) return false;
      // Every route to an action comes through here: a committed swipe, a pressed button, an
      // accessibility action. Delete gets the heavier cautionary buzz; the threshold tick is the
      // swipe's own.
      if (action === "markPaid") hapticSuccess();
      else if (action === "delete") hapticWarning();
      else if (action === "skip") hapticSelection();
      return true;
    },
    [scheduleRowAction],
  );
  const rowSwipe = useRowSwipe({
    enabled: state.settings.swipeRowActions !== false,
    isRtl,
    onAction: handleRowAction,
  });
  // A row that slid away and is back in play (its action was undone, or failed and was unhidden)
  // must return to rest: the swipe holds it off to the side until told otherwise.
  const engagedRows = useRef(new Set<string>());
  useEffect(() => {
    const now = new Set(hiddenIds);
    for (const action of pendingRowActions) now.add(action.id);
    for (const id of engagedRows.current)
      if (!now.has(id)) rowSwipe.release(id);
    engagedRows.current = now;
  }, [hiddenIds, pendingRowActions, rowSwipe]);
  // Selecting, or choosing a category for a row, stands the swipe down and closes an open row.
  const swipeSuspended = selectionMode || categoryRowId !== null;
  useEffect(() => {
    rowSwipe.suspend("screen", swipeSuspended);
    return () => rowSwipe.suspend("screen", false);
  }, [rowSwipe, swipeSuspended]);
  useCloseRowSwipeWhen(rowSwipe, swipeSuspended);
  // A row left open must not outlive what shows it: a filter or search that hides it, or leaving
  // the screen. (The list also closes a row that drops out of its measured rows.)
  useEffect(() => {
    rowSwipe.close();
  }, [rowSwipe, kind, deferredSearch, searchAllMonths]);
  useFocusEffect(useCallback(() => () => rowSwipe.close(), [rowSwipe]));
  // The month pager waits for the row swipe to fail: it fails at touch-down anywhere but on a row.
  const pagerBlockedBy = useMemo(() => [rowSwipe.gesture], [rowSwipe.gesture]);

  const categoryRow = categoryRowId
    ? state.transactions.find((item) => item.id === categoryRowId)
    : undefined;
  // The row can vanish while its sheet is open (a sync deleted it): the sheet hides itself with it,
  // so `onClose` never runs and the swipe would stay suspended for good.
  if (categoryRowId !== null && categoryRow === undefined)
    setCategoryRowId(null);
  const changeRowCategory = async (categoryId: string | null) => {
    if (busy || !categoryRow) return;
    setBusy(true);
    try {
      await repository.updateTransactionsCategory([categoryRow.id], categoryId);
      hapticSuccess();
      setCategoryRowId(null);
    } catch (reason) {
      showError(
        "Couldn’t change category",
        errorMessage(reason, "Try a compatible category."),
      );
    } finally {
      setBusy(false);
    }
  };

  const clearFilters = useCallback(() => {
    setSearch("");
    setSearchAllMonths(false);
    setKind("all");
    setSelectedIds([]);
  }, []);

  // The list content and the pinned toolbar have to occupy the same column, so
  // both derive their width and gutters from one call.
  // A ledger is a reading column: past this width amounts drift far from their titles.
  const content = useMemo(
    () => ({
      ...screenContentMetrics(metrics, insets, space),
      maxWidth: 860,
    }),
    [metrics, insets, space],
  );
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
  const { batchBarBottom, stackedOverlayBottom } = resolveBottomChromeInset(
    metrics,
    insets.bottom,
    space,
  );

  return (
    // Amounts hold their values through a swipe, then count to the new month once it settles.
    <CountUpSubject subject={month}>
      <RowSwipeContext.Provider value={rowSwipe}>
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
                      dragProgress={dragProgress}
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
                          color: theme.positiveText,
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
                              ? theme.positiveText
                              : summary.netFlowMinor < 0
                                ? theme.negativeText
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
                        ? {
                            boxShadow: `inset 0 0 0 2px ${String(theme.accent)}`,
                          }
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
                        searchAllMonths
                          ? "Search all months"
                          : "Search this month",
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
              dragProgress={dragProgress}
              month={month}
              disabled={allMonths || selectionMode}
              blockedBy={pagerBlockedBy}
              onChange={changeMonth}
              style={{ flex: 1 }}
              renderPage={(pageMonth, { isCurrent }) => (
                <TransactionMonthList
                  month={pageMonth}
                  isCurrent={isCurrent}
                  search={deferredSearch}
                  kind={kind}
                  allMonths={
                    searchAllMonths && deferredSearch.trim().length > 0
                  }
                  selectionMode={selectionMode}
                  selectedIds={isCurrent ? selectedIdSet : NO_SELECTION}
                  hiddenIds={hiddenIds}
                  paidIds={paidIds}
                  latestMonth={latestMonth}
                  content={content}
                  onScroll={onScroll}
                  listRef={listRef}
                  upcomingCollapsed={upcomingCollapsed}
                  onToggleUpcoming={toggleUpcomingCollapsed}
                  onToggleSelectionMode={toggleSelectionMode}
                  onToggleItem={toggleSelected}
                  onSetSelection={setSelectedIds}
                  onLongPressItem={enterSelection}
                  onDragActiveChange={setDragActive}
                  onRowAction={handleRowAction}
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
          {pendingRowActions.length ? (
            <UndoBar
              literal
              message={t(rowActionsMessage(pendingRowActions))}
              actionLabel={t("Undo")}
              // Undo restores every action still waiting. Each one commits on its own timer (see
              // `createRowActionQueue`), and the bar goes when the last has, so its own timeout
              // has nothing left to do.
              onAction={undoRowAction}
              onDismiss={ignoreDismiss}
              duration={ROW_ACTION_UNDO_MS}
              style={{
                position: "absolute",
                left: space.lg,
                right: space.lg,
                bottom: stackedOverlayBottom,
              }}
            />
          ) : null}
          <BatchEditSheet
            visible={categoryRow !== undefined}
            count={1}
            categories={
              categoryRow && categoryRow.kind !== "transfer"
                ? state.categories.filter(
                    (item) => item.kind === categoryRow.kind && !item.archived,
                  )
                : []
            }
            categoryBlockedReason={null}
            initialDate={categoryRow?.localDate ?? todayLocal()}
            initialStep="category"
            busy={busy}
            onChangeCategory={changeRowCategory}
            onChangeDate={() => undefined}
            onClose={() => setCategoryRowId(null)}
          />
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
      </RowSwipeContext.Provider>
    </CountUpSubject>
  );
}
