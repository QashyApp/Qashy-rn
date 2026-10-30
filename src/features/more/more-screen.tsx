import { router } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { ScrollView, View, type ScrollViewInstance } from "react-native";

import { StatTile } from "@/components/finance/stat-tile";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { PageHeading } from "@/components/ui/page-heading";
import { ScreenContainer } from "@/components/ui/screen-container";
import { SectionHeader } from "@/components/ui/section-header";
import { useSectionScrollToTop } from "@/components/ui/use-section-scroll-to-top";
import { SettingsRow } from "@/components/ui/settings-row";
import { StatusPill } from "@/components/ui/status-pill";
import {
  BatchDeleteBar,
  useBatchDelete,
} from "@/features/more/use-batch-delete";
import { useLocalization } from "@/localization/localization";
import { isAndroid, languageLabel } from "@/localization/language-preference";
import { summarizeSync } from "@/features/sync/sync-summary";
import { useExchangeRateStatus } from "@/providers/exchange-rate-provider";
import {
  useFinanceRepository,
  useFinanceState,
} from "@/providers/finance-provider";
import { useSyncState } from "@/providers/sync-provider";
import { useScreenMetrics } from "@/theme/layout";
import { useQashyTheme } from "@/theme/theme";
import { accountDeletionMessage } from "@/utils/account-impact";
import { categoryDeletionMessage } from "@/utils/category-impact";
import { confirmDestructive, errorMessage, showError } from "@/utils/confirm";
import { orderCategoriesByParent } from "@/utils/category-order";
import { endOfMonth, mediumDate, startOfMonth, todayLocal } from "@/utils/date";
import { recurrenceLabel } from "@/features/more/recurring/recurring-model";
import { recurringDisplayAmount } from "@/utils/recurring-amount";
import { useDashboardRange } from "@/features/overview/widgets/use-dashboard";
import {
  accountTypeIcon,
  accountTypeLabel,
  categoryKindLabel,
} from "@/utils/labels";
import { formatMoney } from "@/utils/money";
import { useNow } from "@/hooks/use-now";

// A settings row is a 38pt icon tile plus a 12pt gap, so hairlines start where
// the text does. Running them edge to edge cut the icons off from their labels
// and made one list look like several stacked ones.

export function MoreScreen() {
  const scrollRef = useSectionScrollToTop<ScrollViewInstance>();
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const theme = useQashyTheme();
  const { space } = theme;
  const rowDividerInset = 38 + space.md;
  const { t, locale, preference, systemLocale } = useLocalization();
  const languageSubtitle =
    preference === "system"
      ? `${t("System default")} · ${languageLabel(systemLocale, isAndroid())}`
      : languageLabel(preference, isAndroid());
  const { contentWidth } = useScreenMetrics();
  const wide = contentWidth >= 860;
  const summary = useDashboardRange(startOfMonth(), endOfMonth());
  const activeAccounts = state.accounts.filter((item) => !item.archived);
  const recurring = state.recurringRules;
  const [resetting, setResetting] = useState(false);
  const resettingRef = useRef(false);
  const activeCategories = useMemo(
    () =>
      orderCategoriesByParent(
        state.categories.filter((item) => !item.archived),
      ),
    [state.categories],
  );
  // Overdue pending occurrences per schedule, counted in one pass over the ledger.
  const toReviewByRule = useMemo(() => {
    const today = todayLocal();
    const counts = new Map<string, number>();
    for (const transaction of state.transactions) {
      if (
        transaction.recurringRuleId &&
        transaction.status === "upcoming" &&
        !transaction.deletedAt &&
        transaction.localDate <= today
      )
        counts.set(
          transaction.recurringRuleId,
          (counts.get(transaction.recurringRuleId) ?? 0) + 1,
        );
    }
    return counts;
  }, [state.transactions]);
  const accountSelection = useBatchDelete({
    type: "accounts",
    liveIds: activeAccounts.map((item) => item.id),
    confirmTitle: (count) =>
      count === 1 ? "Delete 1 account?" : `Delete ${count} accounts?`,
    confirmMessage: (ids) => accountDeletionMessage(state, ids),
    errorTitle: "Couldn’t delete accounts",
  });
  const categorySelection = useBatchDelete({
    type: "categories",
    liveIds: activeCategories.map((item) => item.id),
    confirmTitle: (count) =>
      count === 1 ? "Delete 1 category?" : `Delete ${count} categories?`,
    confirmMessage: (ids) => categoryDeletionMessage(state.budgets, ids),
    errorTitle: "Couldn’t delete categories",
  });
  const ruleSelection = useBatchDelete({
    type: "recurringRules",
    liveIds: recurring.map((item) => item.id),
    confirmTitle: (count) =>
      count === 1
        ? "Delete 1 recurring transaction?"
        : `Delete ${count} recurring transactions?`,
    confirmMessage:
      "They will stop generating transactions, and upcoming unconfirmed ones are removed. Transactions already posted are kept.",
    errorTitle: "Couldn’t delete recurring transactions",
  });

  // Deliberately not memoized: the whole point of this row is that "Relay unreachable" and
  // "Last synced 2 hours ago" are current when the screen is looked at, and a clock value in a
  // dependency array would either freeze the text or never hit. `useNow` is what makes that
  // safe to do during render — it re-reads outside render and quantizes to the minute, so this
  // recomputation is cheap and the whole app's relative times agree.
  // `useSyncState` returns null outside the provider by design, so this stays safe in any test
  // or story that renders MoreScreen on its own.
  const sync = useSyncState();
  const now = useNow();
  const syncSummary = sync?.status ? summarizeSync(sync.status, { now }) : null;
  const rateStatus = useExchangeRateStatus();

  const resetAllData = async () => {
    // Held for the whole flow, including the confirm dialog: a second tap while the dialog is
    // open must not open another one. Checked against a ref because state is stale in that tap.
    if (resettingRef.current) return;
    resettingRef.current = true;
    try {
      const confirmed = await confirmDestructive({
        title: "Reset Qashy?",
        message:
          "This permanently deletes every account, transaction, budget, goal, recurring transaction, exchange rate, category, and setting stored by Qashy on this device. This cannot be undone.",
        confirmLabel: "Reset everything",
      });
      if (!confirmed) return;
      setResetting(true);
      try {
        await repository.resetAllData();
        router.replace("/");
      } catch (reason) {
        showError(
          "Couldn’t finish resetting Qashy",
          errorMessage(reason, "Restart the app and try again."),
        );
        setResetting(false);
      }
    } finally {
      resettingRef.current = false;
    }
  };

  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      <ScreenContainer>
        <PageHeading
          title="More"
          subtitle="Accounts, categories, recurring, portability, and appearance."
        />
        <Card variant="emphasized" style={{ gap: space.lg }}>
          <AppText
            variant="overline"
            style={{ color: theme.onAccentContainer }}
          >
            Qashy
          </AppText>
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: space.lg }}
          >
            <View style={{ minWidth: 96, flex: 1 }}>
              <StatTile
                onTint
                icon="wallet"
                label="Accounts"
                value={String(activeAccounts.length)}
              />
            </View>
            <View style={{ minWidth: 96, flex: 1 }}>
              <StatTile
                onTint
                icon="chart.pie"
                label="Categories"
                value={String(
                  state.categories.filter((item) => !item.archived).length,
                )}
              />
            </View>
          </View>
          {syncSummary ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
              }}
            >
              <AppText
                literal
                variant="caption"
                style={{ color: theme.onAccentContainer }}
              >
                {t("Sync")}
              </AppText>
              <StatusPill
                literal
                label={syncSummary.subtitle}
                icon={syncSummary.icon}
                tone={syncSummary.tone}
              />
            </View>
          ) : null}
        </Card>
        <View
          style={{
            flexDirection: wide ? "row" : "column",
            gap: space.xl,
            alignItems: "flex-start",
          }}
        >
          <View
            style={{ flex: wide ? 1 : undefined, width: "100%", gap: space.md }}
          >
            <SectionHeader
              title="Accounts"
              action={accountSelection.selecting ? undefined : "Add"}
              onAction={() => router.push("/account")}
              secondaryAction={
                activeAccounts.length
                  ? accountSelection.selecting
                    ? "Done selecting"
                    : "Select"
                  : undefined
              }
              onSecondaryAction={accountSelection.toggleMode}
            />
            <Card variant="list" dividerInset={rowDividerInset}>
              {activeAccounts.map((account) => {
                const balance =
                  summary.accountBalances.find(
                    (item) => item.account.id === account.id,
                  )?.balanceMinor ?? account.openingBalanceMinor;
                return (
                  <SettingsRow
                    key={account.id}
                    literal
                    title={account.name}
                    subtitle={`${t(accountTypeLabel(account.type))} · ${account.currency}`}
                    value={formatMoney(balance, account.currency, locale)}
                    icon={accountTypeIcon(account.type)}
                    color={account.color}
                    selected={
                      accountSelection.selecting
                        ? accountSelection.selectedIds.includes(account.id)
                        : undefined
                    }
                    disabled={accountSelection.deleting}
                    onPress={() =>
                      accountSelection.selecting
                        ? accountSelection.toggle(account.id)
                        : router.push({
                            pathname: "/account",
                            params: { id: account.id },
                          })
                    }
                  />
                );
              })}
            </Card>
            {accountSelection.selecting ? (
              <BatchDeleteBar
                count={accountSelection.liveSelectedCount}
                busy={
                  accountSelection.deleting ||
                  accountSelection.liveSelectedCount >= activeAccounts.length
                }
                onDelete={accountSelection.deleteSelected}
              />
            ) : null}
            {accountSelection.selecting &&
            activeAccounts.length > 0 &&
            accountSelection.liveSelectedCount >= activeAccounts.length ? (
              <AppText variant="caption" muted>
                Keep at least one account. Deselect one to continue.
              </AppText>
            ) : null}

            <SectionHeader
              title="Categories"
              action={categorySelection.selecting ? undefined : "Add"}
              onAction={() => router.push("/category")}
              secondaryAction={
                activeCategories.length
                  ? categorySelection.selecting
                    ? "Done selecting"
                    : "Select"
                  : undefined
              }
              onSecondaryAction={categorySelection.toggleMode}
            />
            <Card variant="list" dividerInset={rowDividerInset}>
              {activeCategories.map((category) => {
                const parent = category.parentId
                  ? activeCategories.find(
                      (item) => item.id === category.parentId,
                    )
                  : undefined;
                return (
                  <SettingsRow
                    key={category.id}
                    literal
                    title={category.name}
                    subtitle={
                      parent
                        ? `${t(categoryKindLabel(category.kind))} · ${t("Under")} ${parent.name}`
                        : t(categoryKindLabel(category.kind))
                    }
                    icon={category.icon}
                    color={category.color}
                    selected={
                      categorySelection.selecting
                        ? categorySelection.selectedIds.includes(category.id)
                        : undefined
                    }
                    disabled={categorySelection.deleting}
                    onPress={() =>
                      categorySelection.selecting
                        ? categorySelection.toggle(category.id)
                        : router.push({
                            pathname: "/category",
                            params: { id: category.id },
                          })
                    }
                  />
                );
              })}
            </Card>
            {categorySelection.selecting ? (
              <BatchDeleteBar
                count={categorySelection.liveSelectedCount}
                busy={categorySelection.deleting}
                onDelete={categorySelection.deleteSelected}
              />
            ) : null}
          </View>

          <View
            style={{ flex: wide ? 1 : undefined, width: "100%", gap: space.md }}
          >
            <SectionHeader
              title="Recurring"
              action={ruleSelection.selecting ? undefined : "New recurring"}
              onAction={() => router.push("/recurring")}
              secondaryAction={
                recurring.length
                  ? ruleSelection.selecting
                    ? "Done selecting"
                    : "Select"
                  : undefined
              }
              onSecondaryAction={ruleSelection.toggleMode}
            />
            <Card variant="list" dividerInset={rowDividerInset}>
              {recurring.length ? (
                recurring.map((rule) => {
                  const ended = Boolean(
                    rule.endDate && rule.nextDueDate > rule.endDate,
                  );
                  const status = ended
                    ? "Ended"
                    : rule.active
                      ? `Next ${mediumDate(rule.nextDueDate, locale)}`
                      : "Paused";
                  // The same wording as the schedule form's hint, without its closing period.
                  const frequency = t(
                    recurrenceLabel(rule.interval, rule.unit),
                  ).replace(/\.$/, "");
                  const amount = recurringDisplayAmount(rule, state, locale);
                  // An unpriced foreign schedule already shows its foreign amount as the value.
                  const foreignSuffix =
                    rule.template.foreign && !amount.unpriced
                      ? ` · ${formatMoney(rule.template.foreign.amountMinor, rule.template.foreign.currency, locale)}`
                      : "";
                  const toReview = toReviewByRule.get(rule.id) ?? 0;
                  const reviewSuffix = toReview
                    ? ` · ${t(`${toReview} to review`)}`
                    : "";
                  return (
                    <SettingsRow
                      key={rule.id}
                      literal
                      title={rule.template.title}
                      subtitle={`${t(categoryKindLabel(rule.template.kind))} · ${frequency} · ${t(status)}${reviewSuffix}${foreignSuffix}`}
                      value={formatMoney(
                        amount.amountMinor,
                        amount.currency,
                        locale,
                      )}
                      icon="repeat"
                      selected={
                        ruleSelection.selecting
                          ? ruleSelection.selectedIds.includes(rule.id)
                          : undefined
                      }
                      disabled={ruleSelection.deleting}
                      onPress={() =>
                        ruleSelection.selecting
                          ? ruleSelection.toggle(rule.id)
                          : router.push({
                              pathname: "/recurring",
                              params: { id: rule.id },
                            })
                      }
                    />
                  );
                })
              ) : (
                <View style={{ paddingVertical: space.md }}>
                  <AppText variant="caption" muted>
                    Subscriptions and scheduled income will appear here.
                  </AppText>
                </View>
              )}
            </Card>
            {ruleSelection.selecting ? (
              <BatchDeleteBar
                count={ruleSelection.liveSelectedCount}
                busy={ruleSelection.deleting}
                onDelete={ruleSelection.deleteSelected}
              />
            ) : null}

            <SectionHeader title="Data" />
            <Card variant="list" dividerInset={rowDividerInset}>
              {/* The subtitle is the at-a-glance answer to "is the relay down?" — it reads
                  `Relay unreachable` rather than a stale last-synced time whenever the drop-box
                  is the thing that broke. The row is not `literal`, so it translates itself. */}
              <SettingsRow
                title="Sync"
                subtitle={syncSummary?.subtitle ?? "Checking…"}
                icon={syncSummary?.icon ?? "arrow.triangle.2.circlepath"}
                onPress={() => router.push("/sync")}
              />
              <SettingsRow
                title="Exchange rates"
                subtitle={
                  rateStatus.enabled
                    ? rateStatus.fetching
                      ? "Fetching…"
                      : "Automatic"
                    : "Off · Manual rates only"
                }
                icon="arrow.left.arrow.right"
                onPress={() => router.push("/exchange-rates")}
              />
              <SettingsRow
                title="Import & export"
                subtitle="CSV portability"
                icon="tray"
                onPress={() => router.push("/csv")}
              />
            </Card>

            <SectionHeader title="App" />
            <Card variant="list" dividerInset={rowDividerInset}>
              <SettingsRow
                title="Appearance"
                subtitle="Theme, Material You, and accent"
                icon="paintbrush"
                onPress={() => router.push("/appearance")}
              />
              <SettingsRow
                literal
                title={t("Language")}
                subtitle={languageSubtitle}
                icon="globe"
                onPress={() => router.push("/language")}
              />
              <SettingsRow
                title="Gestures and Animations"
                subtitle={
                  process.env.EXPO_OS === "android"
                    ? "Swipe, haptics and animations"
                    : "Swipe and animations"
                }
                icon="arrow.left.arrow.right"
                onPress={() => router.push("/gestures")}
              />
              {process.env.EXPO_OS === "android" ? (
                <SettingsRow
                  title="Widgets"
                  subtitle="Home screen widgets"
                  icon="ion:apps-outline"
                  onPress={() => router.push("/widgets")}
                />
              ) : null}
              {/* Dev-only component gallery; the route itself redirects away in production
                  builds (see src/app/kitchen-sink.tsx), but the row is also hidden there so
                  it never shows up as a dead end for a real user. */}
              {__DEV__ ? (
                <SettingsRow
                  title="Kitchen sink"
                  literal
                  subtitle="Dev-only component gallery"
                  icon="paintbrush"
                  onPress={() => router.push("/kitchen-sink")}
                />
              ) : null}
            </Card>

            <SectionHeader title="Danger zone" />
            <Card variant="list" dividerInset={rowDividerInset}>
              <SettingsRow
                title="Reset all data"
                subtitle="Delete everything and return to first-time setup"
                icon="trash"
                tone="danger"
                value={resetting ? "Resetting…" : undefined}
                disabled={resetting}
                onPress={resetAllData}
              />
            </Card>
          </View>
        </View>
      </ScreenContainer>
    </ScrollView>
  );
}
