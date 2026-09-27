import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, SectionList, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnimatedMoney } from '@/components/finance/animated-money';
import { StatTile } from '@/components/finance/stat-tile';
import { TransactionRow } from '@/components/finance/transaction-row';
import { ActionButton } from '@/components/ui/action-button';
import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { EmptyState } from '@/components/ui/empty-state';
import { FloatingActionButton } from '@/components/ui/floating-action-button';
import { IconButton } from '@/components/ui/icon-button';
import { MonthSwitcher, type MonthDirection } from '@/components/ui/month-switcher';
import { MotionView, ScreenTransition } from '@/components/ui/motion';
import { PageHeading } from '@/components/ui/page-heading';
import { floatingActionMetrics, screenContentMetrics } from '@/components/ui/screen-container';
import { TextButton } from '@/components/ui/text-button';
import { useScrollHide } from '@/components/ui/use-scroll-hide';
import { dayNetMinor } from '@/features/transactions/list/summary';
import { useLocalization } from '@/localization/localization';
import { useFinanceRepository, useFinanceState } from '@/providers/finance-provider';
import { useScreenMetrics } from '@/theme/layout';
import { materialStyle } from '@/theme/materials';
import { useQashyTheme } from '@/theme/theme';
import { radius, space } from '@/theme/tokens';
import { fontStyle } from '@/theme/typography';
import { confirmDestructive, errorMessage, showError } from '@/utils/confirm';
import { endOfMonth, monthKey, monthLabel, parseLocalDate, parseMonthKey, startOfMonth } from '@/utils/date';
import { formatMoney } from '@/utils/money';
import { hapticImpactLight, hapticSelection, hapticSuccess } from '@/utils/haptics';

type KindFilter = 'all' | 'expense' | 'income' | 'transfer' | 'upcoming';

const KIND_OPTIONS = [
  { value: 'all', label: 'All', icon: 'list.bullet.rectangle' },
  { value: 'expense', label: 'Expense', icon: 'arrow.up' },
  { value: 'income', label: 'Income', icon: 'arrow.down' },
  { value: 'transfer', label: 'Transfer', icon: 'arrow.left.arrow.right' },
  { value: 'upcoming', label: 'Upcoming', icon: 'clock' },
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
  const { isRtl, locale, t } = useLocalization();
  const metrics = useScreenMetrics();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ month?: string }>();
  const [month, setMonth] = useState(() => parseMonthKey(params.month) ?? startOfMonth());
  const [monthDirection, setMonthDirection] = useState<MonthDirection>('right');
  const [search, setSearch] = useState('');
  const [searchAllMonths, setSearchAllMonths] = useState(false);
  const [kind, setKind] = useState<KindFilter>('all');
  const { visibility: fabVisibility, onScroll } = useScrollHide();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [busy, setBusy] = useState(false);

  // Follow the param when something else navigates here with one (Overview's
  // "See all", the transaction sheet returning to the month it saved into).
  // Adjusted during render rather than in an effect, so the list never paints
  // one frame of the previous month first.
  const paramMonth = parseMonthKey(params.month);
  const [followedParam, setFollowedParam] = useState(paramMonth);
  if (paramMonth !== followedParam) {
    setFollowedParam(paramMonth);
    if (paramMonth && paramMonth !== month) {
      setMonthDirection(paramMonth > month ? 'right' : 'left');
      setMonth(paramMonth);
      setSelectedIds([]);
    }
  }

  const changeMonth = (next: string, direction: MonthDirection) => {
    setMonthDirection(direction);
    setMonth(next);
    setSelectedIds([]);
    router.setParams({ month: monthKey(next) });
  };

  const allMonths = searchAllMonths && search.trim().length > 0;
  const fromDate = startOfMonth(month);
  const toDate = endOfMonth(month);

  const selectedTransactions = state.transactions.filter((item) => selectedIds.includes(item.id));
  const hasSelectedTransfers = selectedTransactions.some((item) => item.kind === 'transfer');
  const selectedKinds = [...new Set(selectedTransactions
    .filter((item) => item.kind !== 'transfer')
    .map((item) => item.kind))];
  const compatibleCategoryKind = selectedKinds.length === 1 ? selectedKinds[0] : null;

  // `state.categories` is listed because the repository reads it internally for
  // hierarchy-aware search; the snapshot argument alone would not re-run this
  // when a category is renamed.
  const categoriesVersion = state.categories;
  const transactions = useMemo(() => {
    void categoriesVersion;
    return repository.queryTransactions({
      search,
      kinds: kind !== 'all' && kind !== 'upcoming' ? [kind] : undefined,
      statuses: kind === 'upcoming' ? ['upcoming'] : kind === 'all' ? ['posted', 'upcoming'] : ['posted'],
      fromDate: allMonths ? undefined : fromDate,
      toDate: allMonths ? undefined : toDate,
    }, state.transactions);
  }, [repository, search, kind, allMonths, fromDate, toDate, state.transactions, categoriesVersion]);

  // Totals come from the dashboard aggregate rather than from summing the rows
  // here: it already excludes transfers, uses each transaction's snapshotted
  // base-currency amount, and matches what Overview shows for the same month.
  const summary = useMemo(() => {
    void state.accounts;
    void state.exchangeRates;
    void state.settings;
    void state.transactions;
    void state.budgets;
    void state.budgetPeriods;
    return repository.getDashboard(fromDate, toDate);
  }, [repository, fromDate, toDate, state.accounts, state.exchangeRates, state.settings, state.transactions, state.budgets, state.budgetPeriods]);

  // Where "Go to latest" leads when this month is empty.
  const latestMonth = useMemo(() => {
    const [latest] = repository.queryTransactions({ statuses: ['posted'], limit: 1 }, state.transactions);
    return latest ? startOfMonth(latest.localDate) : null;
  }, [repository, state.transactions]);

  const sections = useMemo(() => {
    const groups = new Map<string, typeof transactions>();
    transactions.forEach((transaction) => {
      const list = groups.get(transaction.localDate) ?? [];
      list.push(transaction);
      groups.set(transaction.localDate, list);
    });
    return Array.from(groups, ([title, data]) => ({ title, data }));
  }, [transactions]);

  const dayFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, allMonths
      ? { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
      : { weekday: 'long', month: 'short', day: 'numeric' }),
    [allMonths, locale],
  );

  const clearSelection = () => setSelectedIds([]);

  const toggleSelected = (id: string, options?: { silent?: boolean }) => {
    if (!options?.silent) hapticSelection();
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
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
      setSelectedIds([]);
      setSelectionMode(false);
    } catch (reason) {
      showError('Couldn’t change category', errorMessage(reason, 'Try a compatible category.'));
    } finally {
      setBusy(false);
    }
  };

  const deleteSelected = async () => {
    if (busy) return;
    const ids = [...selectedIds];
    if (!(await confirmDestructive({ title: ids.length === 1 ? 'Delete 1 transaction?' : `Delete ${ids.length} transactions?`, message: 'They will be removed from your ledger.' }))) return;
    setBusy(true);
    try {
      await repository.deleteEntities('transactions', ids);
      hapticSuccess();
      setSelectedIds([]);
      setSelectionMode(false);
    } catch (reason) {
      showError('Couldn’t delete transactions', errorMessage(reason, 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setSearchAllMonths(false);
    setKind('all');
    clearSelection();
  };

  // The list content and the pinned toolbar have to occupy the same column, so
  // both derive their width and gutters from one call.
  const content = screenContentMetrics(metrics, insets);
  const toolbarStyle = {
    width: content.width,
    maxWidth: content.maxWidth,
    alignSelf: content.alignSelf,
    paddingLeft: content.paddingLeft,
    paddingRight: content.paddingRight,
    paddingTop: content.paddingTop,
    paddingBottom: space.md,
    gap: space.md,
  } as const;
  const gutter = Number(content.paddingLeft ?? 0);
  const currency = state.settings.baseCurrency;
  const compactFigures = metrics.contentWidth < 520;
  const filtered = search.trim().length > 0 || kind !== 'all';
  // The floating batch bar takes the FAB's usual spot while it is open, so the
  // two never compete for the same corner of the screen — adding a transaction
  // mid-selection is also just confusing.
  const batchBarBottom = metrics.hasBottomNavigation ? 92 + insets.bottom : space.xxl + insets.bottom;

  return (
    <View collapsable={false} style={{ flex: 1, backgroundColor: theme.background }}>
      <ScreenTransition style={{ flex: 1 }}>
      {/* Month, search and filters sit outside the list, not inside its header.
          Scrolled away, they made the ledger's most-used controls unreachable
          exactly when a long list made them necessary. Pinned, the list becomes
          a result set that responds under a control surface that stays put. */}
      <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border, backgroundColor: theme.background, zIndex: 2 }}>
        <View style={toolbarStyle}>
          <PageHeading title="Transactions" />
          <View style={{ gap: space.md }}>
            <MonthSwitcher value={month} direction={monthDirection} onChange={changeMonth} disabled={allMonths} />
            <MotionView
              key={`${month}-${allMonths}`}
              variant={monthDirection}
              accessibilityLabel={allMonths ? undefined : `${monthLabel(month, locale)} ${t('summary')}`}
              style={{ flexDirection: 'row', gap: space.sm, opacity: allMonths ? 0.45 : 1 }}>
              {([
                ['Income', summary.incomeMinor, theme.positive],
                ['Spent', summary.expenseMinor, theme.text],
                ['Net', summary.netFlowMinor, summary.netFlowMinor >= 0 ? theme.positive : theme.negative],
              ] as const).map(([label, amount, color]) => (
                <View key={label} style={{ flex: 1, minWidth: 0 }}>
                  <StatTile
                    label={label}
                    value={(
                      <AnimatedMoney minor={amount} currency={currency} locale={locale} compact={compactFigures} variant="label" numeric style={{ color }} />
                    )}
                  />
                </View>
              ))}
            </MotionView>
          </View>
          <View style={{ minHeight: 44, borderRadius: radius.pill, borderCurve: 'continuous', flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, gap: space.sm, ...materialStyle(theme, 'sunken') }}>
            <AppIcon name="magnifyingglass" color={theme.textMuted} size={18} />
            <TextInput
              accessibilityLabel={t('Search transactions')}
              placeholder={t(searchAllMonths ? 'Search all months' : 'Search this month')}
              placeholderTextColor={theme.textMuted}
              value={search}
              onChangeText={(value) => {
                setSearch(value);
                clearSelection();
              }}
              style={{ flex: 1, minHeight: 44, color: theme.text, fontSize: 16, ...fontStyle('regular'), writingDirection: isRtl ? 'rtl' : 'ltr', textAlign: isRtl ? 'right' : 'left' }}
            />
            {search ? <IconButton label="Clear search" icon="xmark" iconSize={17} enteringVariant="zoom" onPress={() => {
              setSearch('');
              clearSelection();
            }} style={{ marginEnd: -space.sm }} /> : null}
          </View>
          {search ? (
            <MotionView variant="down" exit animateLayout style={{ flexDirection: 'row' }}>
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
            accessibilityLabel={t('Transaction type filter')}
            // Bleeds to the screen edge so chips scroll out from under the gutter.
            style={{ marginHorizontal: -gutter }}
            contentContainerStyle={{ gap: space.sm, paddingHorizontal: gutter }}>
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
        </View>
      </View>
      <SectionList
        contentInsetAdjustmentBehavior="automatic"
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={{ flex: 1, backgroundColor: theme.background }}
        contentContainerStyle={[content, { paddingTop: 0, paddingBottom: (Number(content.paddingBottom) || 0) + (selectionMode ? 140 : 0) }]}
        sections={sections}
        extraData={`${selectedIds.join(',')}|${selectionMode}|${state.transactions.map((item) => `${item.id}:${item.revision}`).join(',')}`}
        keyExtractor={(item) => `${item.id}:${item.revision}`}
        // The day a row belongs to stays on screen for as long as that day's
        // rows do, so a fast scroll through a busy month never loses its place.
        stickySectionHeadersEnabled
        ListHeaderComponent={
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md, alignItems: 'center', paddingTop: space.md }}>
            {/* One string so the dictionary's count patterns can match; split
                children would leave "transactions" on its own with no key. */}
            <AppText literal variant="caption" muted>{t(`${transactions.length} ${transactions.length === 1 ? 'transaction' : 'transactions'}`)}</AppText>
            <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {transactions.length ? (
                <TextButton
                  title={selectionMode ? 'Done selecting' : 'Select'}
                  tone={selectionMode ? 'muted' : 'accent'}
                  onPress={() => {
                    setSelectionMode((current) => !current);
                    setSelectedIds([]);
                  }}
                />
              ) : null}
              <TextButton title="Import or export" onPress={() => router.push('/csv')} />
            </View>
          </View>
        }
        renderSectionHeader={({ section }) => {
          const net = dayNetMinor(section.data);
          const netLabel = formatMoney(Math.abs(net), currency, locale);
          const netText = net === 0 ? netLabel : `${net > 0 ? '+' : '-'}${netLabel}`;
          return (
            // Opaque, because a sticky header scrolls over live content. The
            // negative margins let the fill reach the column's gutters so rows do
            // not slide past it in the margin.
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: space.sm,
                backgroundColor: theme.background,
                paddingTop: space.lg,
                paddingBottom: space.sm,
                marginHorizontal: -space.xs,
                paddingHorizontal: space.xs,
              }}>
              <AppText literal variant="overline" muted>{dayFormat.format(parseLocalDate(section.title))}</AppText>
              <AppText literal figure variant="caption" muted numeric>{netText}</AppText>
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
        renderItem={({ item, index, section }) => {
          const selected = selectedIds.includes(item.id);
          const first = index === 0;
          const last = index === section.data.length - 1;
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
                  borderCurve: 'continuous',
                }}>
                {first ? null : <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginStart: 52 }} />}
                <TransactionRow
                  transaction={item}
                  showDate={false}
                  selectionMode={selectionMode}
                  selected={selected}
                  onLongPress={() => {
                    if (!selectionMode) hapticImpactLight();
                    setSelectionMode(true);
                    toggleSelected(item.id, { silent: !selectionMode });
                  }}
                  onPress={selectionMode ? () => toggleSelected(item.id) : undefined}
                />
              </View>
            </MotionView>
          );
        }}
        ListEmptyComponent={
          <MotionView key={`${month}-${filtered}`} variant={monthDirection}>
            {filtered ? (
              <EmptyState
                icon="magnifyingglass"
                title="Nothing matches"
                body={allMonths ? 'Try another search or filter.' : `Nothing in ${monthLabel(month, locale)} matches. Try another filter, or search all months.`}>
                <ActionButton title="Clear filters" variant="secondary" onPress={clearFilters} />
              </EmptyState>
            ) : state.transactions.length ? (
              <EmptyState
                icon="calendar"
                title={`No transactions in ${monthLabel(month, locale)}`}
                body="Add one for this month, or jump to your latest activity.">
                <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {latestMonth && latestMonth !== month ? (
                    <ActionButton
                      title="Go to latest"
                      variant="secondary"
                      onPress={() => changeMonth(latestMonth, latestMonth > month ? 'right' : 'left')}
                    />
                  ) : null}
                </View>
              </EmptyState>
            ) : (
              <EmptyState icon="arrow.left.arrow.right" title="No transactions yet" body="Add your first income, expense, or transfer." />
            )}
          </MotionView>
        }
        ListFooterComponent={<View style={{ height: 88 }} />}
      />
      </ScreenTransition>
      {selectionMode ? (
        <MotionView
          variant="up"
          exit
          animateLayout
          style={{
            position: 'absolute',
            left: gutter,
            right: gutter,
            bottom: batchBarBottom,
            maxWidth: content.maxWidth,
            alignSelf: 'center',
            width: '100%',
          }}>
          <View
            style={{
              gap: space.md,
              padding: space.lg,
              borderRadius: radius.sheet,
              borderCurve: 'continuous',
              ...materialStyle(theme, 'raised'),
              boxShadow: theme.shadowOverlay,
            }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
              <MotionView key={selectedIds.length} variant="fade" animateLayout>
                <AppText literal variant="headline">{t(`${selectedIds.length} selected`)}</AppText>
              </MotionView>
              <TextButton title="Cancel" tone="muted" onPress={() => {
                setSelectedIds([]);
                setSelectionMode(false);
              }} />
            </View>
            {selectedIds.length ? (
              <>
                {hasSelectedTransfers ? (
                  <AppText variant="caption" muted>Transfers do not have categories. Select only income or expense transactions to change categories.</AppText>
                ) : (
                  <>
                    <AppText variant="caption" muted>Change category</AppText>
                    {selectedKinds.length > 1 ? <AppText variant="caption" muted>Select only income or only expense transactions to assign a category.</AppText> : null}
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: space.sm }}>
                      <ChoiceChip mode="button" icon="questionmark.circle" label="Uncategorized" selected={false} disabled={busy} onPress={() => changeCategory(null)} />
                      {state.categories.filter((item) => item.kind === compatibleCategoryKind && !item.archived).map((category) => (
                        <ChoiceChip mode="button" key={category.id} literal icon={category.icon} label={category.name} selected={false} disabled={busy} onPress={() => changeCategory(category.id)} />
                      ))}
                    </ScrollView>
                  </>
                )}
                <ActionButton title="Delete selected" variant="danger" disabled={busy} onPress={deleteSelected} />
              </>
            ) : <AppText variant="caption" muted>Choose one or more transactions below.</AppText>}
          </View>
        </MotionView>
      ) : (
        <FloatingActionButton
          label="Add transaction"
          visibility={fabVisibility}
          onPress={() => router.push({ pathname: '/transaction', params: { returnTo: '/transactions' } })}
          style={floatingActionMetrics(metrics, insets)}
        />
      )}
    </View>
  );
}
