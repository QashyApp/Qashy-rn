import { CountUpSubject } from "@/components/finance/animated-money";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  BackHandler,
  Platform,
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
import { AppText } from "@/components/ui/app-text";
import { PageHeading } from "@/components/ui/page-heading";
import {
  floatingActionMetrics,
  screenContentMetrics,
} from "@/components/ui/screen-container";
import { useScrollHide } from "@/components/ui/use-scroll-hide";
import { useSectionScrollToTop } from "@/components/ui/use-section-scroll-to-top";
import type { TransactionRecord } from "@/domain/models";
import {
  ROW_ACTION_UNDO_MS,
  rowActionsMessage,
  usePendingRowActions,
  type RowActionKind,
} from "@/features/transactions/row-actions";
import { useCategorySheetRequest } from "@/features/transactions/use-category-sheet-request";
import type { RowSwipeActionKind } from "@/features/transactions/list/row-swipe/row-swipe-actions";
import {
  RowSwipeContext,
  useCloseRowSwipeWhen,
  useReleaseReturnedRows,
  useRowSwipe,
} from "@/features/transactions/list/row-swipe/use-row-swipe";
import { totalsWithoutHidden } from "@/features/transactions/list/summary";
import {
  FILTER_TOGGLE_ABOVE_LINE,
  FILTER_TOGGLE_BELOW_LINE,
  FilterToggle,
  SearchPillRow,
  useFiltersOpen,
  useTimedProgress,
} from "@/features/transactions/phone-header";
import { SummaryTiles } from "@/features/transactions/summary-tiles";
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
// Keeps the caption line its height while it says nothing.
const NO_CAPTION = String.fromCharCode(0xa0);
const NO_TRANSACTIONS: readonly TransactionRecord[] = [];

/** How long the month has to hold still before the URL is updated to it. */
const PARAM_DELAY = 400;

/** How long the selection has to hold still before its count is read out (a drag-select changes it per row). */
const ANNOUNCE_DELAY = 600;

/** Keeps the identity of an already empty selection: a new array re-renders every mounted month page. */
const emptied = (current: string[]) => (current.length ? [] : current);

function announce(message: string) {
  // Web has no such API on some builds; native always does.
  if (
    Platform.OS === "web" &&
    typeof AccessibilityInfo?.announceForAccessibility !== "function"
  )
    return;
  AccessibilityInfo.announceForAccessibility(message);
}

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
  const {
    visibility: fabVisibility,
    onScroll,
    show: showFab,
  } = useScrollHide();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // The row whose "Change category" swipe action is open in the sheet.
  const [categoryRowId, setCategoryRowId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Whether a selection has ever started on this screen (see the add button's entrance).
  const [hasSelected, setHasSelected] = useState(false);
  if (selectionMode && !hasSelected) setHasSelected(true);
  const pagerRef = useRef<MonthPagerHandle>(null);
  const dragProgress = useSharedValue(restingPosition(month, isRtl));
  const listRef =
    useSectionScrollToTop<
      SectionList<TransactionRecord, LedgerSection<TransactionRecord>>
    >();
  const [upcomingCollapsed, setUpcomingCollapsed] = useState(false);
  // On a phone the top section is static: the month bar and a search pill, the month's totals on
  // one line, and a toggle that opens the filters. Wider layouts show everything at full size.
  const phoneWidth = metrics.contentWidth < 520;
  const { open: filtersOpen, toggle: toggleFilters } = useFiltersOpen();
  const filtersFold = useTimedProgress(!filtersOpen);
  // The floating button follows the current page's scrolling alone, and another month's page has
  // its own offset: after a change of month it starts shown, and the next scroll event of the new
  // page takes over from there. (An effect, so a month that arrives from the route param is
  // covered too.)
  useEffect(() => {
    showFab();
  }, [month, showFab]);

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
        setSelectedIds(emptied);
      }
    }
  }

  // Stable, like every handler handed to the month pages: a row crossed by a drag-select
  // re-renders this screen, and a new function would rebuild the props of every page.
  const changeMonth = useCallback((next: string) => {
    setMonth(next);
    // Kept as is when already empty: a new array re-rendered every mounted month page.
    setSelectedIds(emptied);
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
  // Upcoming is everything ahead, so like a search across all months it does not follow the month
  // bar: the bar is dimmed and out of reach while it is on.
  const upcomingOnly = kind === "upcoming";
  const spansMonths = allMonths || upcomingOnly;
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

  const clearSelection = useCallback(() => setSelectedIds(emptied), []);

  const exitSelection = () => {
    setSelectedIds(emptied);
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
    hapticSelection();
    setSelectionMode((current) => !current);
    setSelectedIds(emptied);
  }, []);

  // Entering and leaving selection mode, and the count, are otherwise silent to a screen reader (the
  // count only exists as text at the top of the list). The count waits for the selection to hold
  // still, so a drag across rows reads out where it ended instead of every row it crossed.
  const selectedCount = selectedIds.length;
  const wasSelecting = useRef(false);
  const announceRef = useRef(t);
  useEffect(() => {
    announceRef.current = t;
  });
  useEffect(() => {
    if (!selectionMode && !wasSelecting.current) return;
    const left = !selectionMode;
    wasSelecting.current = selectionMode;
    const timer = setTimeout(
      () =>
        announce(
          announceRef.current(
            left ? "Done selecting" : `${selectedCount} selected`,
          ),
        ),
      left ? 0 : ANNOUNCE_DELAY,
    );
    return () => clearTimeout(timer);
  }, [selectionMode, selectedCount]);

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
  // ends, so the tiles leave it out too, or they would count what the list no longer shows. A row
  // being marked paid is drawn as posted at once, so the tiles count it too (when it is priced).
  const summary = useMemo(
    () =>
      totalsWithoutHidden(
        aggregate,
        state.transactions,
        hiddenIds,
        fromDate,
        toDate,
        paidIds,
      ),
    [aggregate, state.transactions, hiddenIds, paidIds, fromDate, toDate],
  );
  // Change category opens its sheet over the list, which stands the swipe down and closes the row.
  // A swipe's row first holds on its checkmark for `holdMs`, and so does a press of a revealed
  // button, so the sheet waits that long. There is no hold (and no wait) when motion is off, or for
  // an accessibility action, which does not go through the swipe.
  const { request: requestCategorySheet, cancel: cancelPendingCategory } =
    useCategorySheetRequest(setCategoryRowId);
  const handleRowAction = useCallback(
    (
      id: string,
      action: RowSwipeActionKind,
      hideDelayMs?: number,
      holdMs?: number,
    ) => {
      if (action === "changeCategory") {
        requestCategorySheet(id, holdMs);
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
    [scheduleRowAction, requestCategorySheet],
  );
  const rowSwipe = useRowSwipe({
    enabled: state.settings.swipeRowActions !== false,
    isRtl,
    onAction: handleRowAction,
  });
  // A row that slid away and is back in play (its action was undone, or failed and was unhidden)
  // must return to rest: the swipe holds it off to the side until told otherwise.
  useReleaseReturnedRows(rowSwipe, hiddenIds, pendingRowActions);
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
  // Leaving the screen also drops a Change category sheet that was still waiting on its hold: it
  // would otherwise open over whatever screen is there by then.
  useFocusEffect(
    useCallback(
      () => () => {
        rowSwipe.close();
        cancelPendingCategory();
      },
      [rowSwipe, cancelPendingCategory],
    ),
  );
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
    setSelectedIds(emptied);
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
    // On a phone the filter toggle straddles the bottom line: its circle reaches above it, and its
    // frame (the touch target) takes layout below it, which comes off the padding so the list
    // starts where it always did.
    paddingBottom: phoneWidth
      ? FILTER_TOGGLE_ABOVE_LINE +
        space.xs -
        (FILTER_TOGGLE_BELOW_LINE - FILTER_TOGGLE_ABOVE_LINE)
      : space.md,
    // Tighter on phones, where the pinned toolbar otherwise eats the list's room.
    gap: phoneWidth ? space.sm : space.md,
  } as const;
  const gutter = Number(content.paddingLeft ?? 0);
  const currency = state.settings.baseCurrency;
  const toolbarGap = toolbarStyle.gap;
  // A filter that is on but may be out of sight: a kind other than All, or a search across months.
  const filterActive = kind !== "all" || allMonths;
  // "Search all months" survives an emptied field (backspacing to retype keeps it, and its chip
  // comes back with the next character); only the clear button resets it, or leaving the screen.
  const resetSearch = () => {
    setSearch("");
    setSearchAllMonths(false);
    clearSelection();
  };
  const changeSearch = (value: string) => {
    setSearch(value);
    clearSelection();
  };

  const monthSwitcher = (
    <MonthSwitcher
      value={month}
      onChange={(next, direction) =>
        navigateMonth(pagerRef.current, month, next, direction, changeMonth)
      }
      disabled={spansMonths}
      label={upcomingOnly ? "All upcoming" : undefined}
      dragProgress={dragProgress}
      fill={phoneWidth}
    />
  );
  // The tiles are always the calendar month's totals and ignore the type and the search; they are
  // dimmed when the list spans months. Either way the list and the tiles differ, so say so.
  const totalsCaption = spansMonths
    ? t(`Totals are for ${monthLabel(month, locale)} only`)
    : kind !== "all" || search.trim().length > 0
      ? t(`Totals include all transactions in ${monthLabel(month, locale)}`)
      : "";
  const summaryTiles = (
    <View style={{ gap: space.xs }}>
      <View
        accessibilityLabel={
          spansMonths
            ? undefined
            : `${monthLabel(month, locale)} ${t("summary")}`
        }
        style={{ opacity: spansMonths ? 0.45 : 1 }}
      >
        <SummaryTiles
          currency={currency}
          locale={locale}
          compact={phoneWidth}
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
      {/* Said only when it adds something: the month bar already names the month, so a plain
          month needs no caption. The line keeps its height while empty, so typing a search or
          picking a type never moves the list. */}
      <AppText
        literal
        variant="caption"
        muted
        accessibilityElementsHidden={!totalsCaption}
        importantForAccessibility={
          totalsCaption ? "auto" : "no-hide-descendants"
        }
      >
        {totalsCaption || NO_CAPTION}
      </AppText>
    </View>
  );
  // Upcoming already lists every month, so there is nothing for the chip to widen.
  const searchAllMonthsChip =
    search && !upcomingOnly ? (
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
    ) : null;
  // Five options do not fit a segmented control on a phone without truncating, so they scroll
  // sideways as one row instead of wrapping.
  // `bleed` draws the row out to the screen edges with its own negative margin; a caller that
  // has already bled its block (the phone's folding one, which clips whatever leaves its edges)
  // leaves it off.
  const kindChips = (bleed: boolean) => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="radiogroup"
      accessibilityLabel={t("Transaction type filter")}
      // Bleeds to the screen edge so chips scroll out from under the gutter.
      style={bleed ? { marginHorizontal: -gutter } : undefined}
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
  );
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
            <View style={{ zIndex: 2 }}>
              <View
                style={{
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: theme.border,
                  backgroundColor: theme.background,
                }}
              >
                <View style={toolbarStyle}>
                  <PageHeading title="Transactions" />
                  {phoneWidth ? (
                    <>
                      <SearchPillRow
                        switcher={monthSwitcher}
                        value={search}
                        allMonths={spansMonths}
                        onChangeText={changeSearch}
                        onClear={resetSearch}
                      />
                      {summaryTiles}
                      {/* The block reaches the screen edges and puts the gutter back inside, so
                          the fold's clip is at the edges and no chip is cut off at the gutter. */}
                      <View style={{ marginHorizontal: -gutter }}>
                        <Collapsible
                          collapse={filtersFold}
                          folded={!filtersOpen}
                          gapBefore={toolbarGap}
                          style={{ gap: toolbarGap }}
                        >
                          {searchAllMonthsChip ? (
                            <View
                              style={{
                                flexDirection: "row",
                                paddingHorizontal: gutter,
                              }}
                            >
                              {searchAllMonthsChip}
                            </View>
                          ) : null}
                          {kindChips(false)}
                        </Collapsible>
                      </View>
                    </>
                  ) : (
                    <>
                      <View style={{ gap: space.md }}>
                        <View style={{ alignSelf: "flex-start" }}>
                          {monthSwitcher}
                        </View>
                        {summaryTiles}
                      </View>
                      <View style={{ gap: toolbarGap }}>
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
                              spansMonths
                                ? "Search all months"
                                : "Search this month",
                            )}
                            placeholderTextColor={theme.textMuted}
                            value={search}
                            onFocus={() => setSearchFocused(true)}
                            onBlur={() => setSearchFocused(false)}
                            onChangeText={changeSearch}
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
                              onPress={resetSearch}
                              style={{ marginEnd: -space.sm }}
                            />
                          ) : null}
                        </View>
                        {searchAllMonthsChip}
                        {kindChips(true)}
                      </View>
                    </>
                  )}
                </View>
              </View>
              {phoneWidth ? (
                <FilterToggle
                  open={filtersOpen}
                  filterActive={filterActive}
                  onToggle={toggleFilters}
                />
              ) : null}
            </View>
            <MonthPager
              ref={pagerRef}
              dragProgress={dragProgress}
              month={month}
              disabled={spansMonths || selectionMode}
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
            // Fades out as the batch bar arrives in its place. It fades back in only after a
            // selection: on first mount it stays put, since it sits outside the screen transition.
            <MotionView
              variant="fade"
              exit
              entrance={hasSelected}
              style={floatingActionMetrics(metrics, insets, space)}
            >
              <FloatingActionButton
                label="Add transaction"
                visibility={fabVisibility}
                onPress={() =>
                  router.push({
                    pathname: "/transaction",
                    params: { returnTo: "/transactions" },
                  })
                }
              />
            </MotionView>
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
