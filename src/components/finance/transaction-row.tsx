import { router } from "expo-router";
import { memo } from "react";
import { View } from "react-native";

import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { IconBadge } from "@/components/ui/icon-badge";
import { MotionPressable, MotionView } from "@/components/ui/motion";
import type { Account, Category, TransactionRecord } from "@/domain/models";
import {
  rowSwipeActionLabel,
  type RowSwipeActionKind,
  type RowSwipeActions,
} from "@/features/transactions/list/row-swipe/row-swipe-actions";
import { useLocalization } from "@/localization/localization";
import { useFinanceState } from "@/providers/finance-provider";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import {
  dateFormat,
  mediumDate,
  parseLocalDate,
  todayLocal,
} from "@/utils/date";
import { formatMoney } from "@/utils/money";

interface TransactionRowProps {
  transaction: TransactionRecord;
  compact?: boolean;
  returnTo?: "/overview" | "/transactions";
  selectionMode?: boolean;
  selected?: boolean;
  /**
   * Off where a date-grouped list already states the day in its section header.
   * Repeating it under every amount put the same eight characters down the right
   * edge of the ledger and made the column of numbers harder to scan, which is
   * the one thing that column exists for.
   */
  showDate?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  /**
   * What the row's swipe does on each side. Offered to assistive technology as custom actions,
   * outside selection mode, so the swipe is never the only way to reach them.
   */
  rowActions?: RowSwipeActions;
  onRowAction?: (id: string, kind: RowSwipeActionKind) => void;
}

/** How long a row is held before it enters selection mode. */
const LONG_PRESS_DELAY_MS = 400;

// One id index per snapshot array, built lazily and dropped with the array, so a row's
// account/category lookup is O(1) instead of a scan per row per render.
const INDEXES = new WeakMap<object, Map<string, unknown>>();
function lookup<T extends { id: string }>(
  list: readonly T[],
  id: string | null | undefined,
): T | undefined {
  if (!id) return undefined;
  let index = INDEXES.get(list);
  if (!index) {
    index = new Map(list.map((item) => [item.id, item]));
    INDEXES.set(list, index);
  }
  return index.get(id) as T | undefined;
}

/**
 * Resolves the row's account, category and locale from the snapshot, then hands them to a
 * memoized view. Any finance mutation re-renders this thin wrapper, but a row whose own
 * inputs are unchanged skips the (much heavier) view entirely.
 */
export function TransactionRow(props: TransactionRowProps) {
  const { accounts, categories } = useFinanceState();
  const { locale } = useLocalization();
  const { transaction } = props;
  return (
    <TransactionRowView
      {...props}
      locale={locale}
      account={lookup(accounts, transaction.accountId)}
      category={lookup(categories, transaction.categoryId)}
      destination={lookup(accounts, transaction.destinationAccountId)}
    />
  );
}

const TransactionRowView = memo(function TransactionRowView({
  transaction,
  compact = false,
  returnTo = "/transactions",
  selectionMode = false,
  selected = false,
  showDate = true,
  onPress,
  onLongPress,
  rowActions,
  onRowAction,
  locale,
  account,
  category,
  destination,
}: TransactionRowProps & {
  locale: string;
  account: Account | undefined;
  category: Category | undefined;
  destination: Account | undefined;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const { t } = useLocalization();
  const isIncome = transaction.kind === "income";
  const isTransfer = transaction.kind === "transfer";
  const color = selected
    ? theme.onAccentContainer
    : isTransfer
      ? theme.transferText
      : isIncome
        ? theme.positiveText
        : theme.text;
  const direction = t(
    isTransfer
      ? "Transfer, money moved"
      : isIncome
        ? "Income, money in"
        : "Expense, money out",
  );
  const signedAmount = `${isIncome ? `${t("plus")} ` : isTransfer ? "" : `${t("minus")} `}${formatMoney(transaction.amountMinor, transaction.currency, locale)}`;
  const accountContext = isTransfer
    ? `${account?.name ?? t("Unknown account")} ${t("into")} ${destination?.name ?? t("Unknown account")}`
    : (account?.name ?? t("Unknown account"));
  // The original foreign amount and any fee are context, not the headline number —
  // the row's own amount stays the account-currency total. Both fold into the
  // accessible label too, so a screen reader hears exactly what the caption shows.
  const foreignText = transaction.foreign
    ? formatMoney(
        transaction.foreign.amountMinor,
        transaction.foreign.currency,
        locale,
      )
    : null;
  const feeText =
    transaction.fee && transaction.fee.amountMinor > 0
      ? t(
          `incl. ${formatMoney(transaction.fee.amountMinor, transaction.currency, locale)} fee`,
        )
      : null;
  const foreignFeeCaption = [foreignText, feeText]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  // Read the date the way the app displays it, not as the raw ISO string.
  const spokenDate = dateFormat(locale, {
    dateStyle: "full",
  }).format(parseLocalDate(transaction.localDate));
  const rowLabel = [
    direction,
    transaction.title,
    signedAmount,
    category?.name ?? t(isTransfer ? "Transfer" : "Uncategorized"),
    accountContext,
    spokenDate,
    foreignFeeCaption || undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join(", ");
  // The fallbacks are the only translatable parts of the caption, so they are
  // resolved here and the whole line renders verbatim. Otherwise a category or
  // account the user named "Savings" would be rewritten by the dictionary.
  const categoryLabel =
    category?.name ?? t(isTransfer ? "Transfer" : "Uncategorized");
  const accountLabel = isTransfer
    ? `${account?.name ?? t("Unknown account")} → ${destination?.name ?? t("Unknown account")}`
    : (account?.name ?? t("Unknown account"));
  // The formatter places the sign so right-to-left locales render it on the correct side.
  const amountText = formatMoney(
    isIncome || isTransfer ? transaction.amountMinor : -transaction.amountMinor,
    transaction.currency,
    locale,
    { sign: !isTransfer },
  );
  // Category colors are identity, not emphasis. Painted at full saturation
  // across a 44pt tile they turned a mixed list into a row of signal lights all
  // shouting at once, and the amount — the reason a ledger exists — came third
  // after them. Tinted toward the surface they still identify at a glance while
  // leaving the strongest contrast in the row to the number.
  // The tile itself (tinted, filled or bare; round or squircle) is the theme's: see IconBadge.

  const customActions: { name: string; label: string }[] = [];
  if (!selectionMode && onLongPress)
    customActions.push({ name: "longpress", label: t("Select transaction") });
  if (!selectionMode && onRowAction && rowActions) {
    for (const kind of [rowActions.end, rowActions.start])
      if (kind)
        customActions.push({ name: kind, label: t(rowSwipeActionLabel(kind)) });
  }

  return (
    <MotionPressable
      accessibilityActions={customActions.length ? customActions : undefined}
      accessibilityHint={
        !selectionMode && onLongPress
          ? t("Long press to select this transaction for batch actions.")
          : undefined
      }
      accessibilityRole={selectionMode ? "checkbox" : "button"}
      accessibilityLabel={
        selectionMode
          ? `${rowLabel}, ${t(selected ? "selected" : "not selected")}`
          : rowLabel
      }
      accessibilityState={selectionMode ? { checked: selected } : undefined}
      aria-checked={selectionMode ? selected : undefined}
      onAccessibilityAction={(event) => {
        const name = event.nativeEvent.actionName;
        if (name === "longpress") onLongPress?.();
        else if (
          rowActions &&
          (name === rowActions.start || name === rowActions.end)
        )
          onRowAction?.(transaction.id, name as RowSwipeActionKind);
      }}
      onPress={
        onPress ??
        (() =>
          router.push({
            pathname: "/transaction",
            params: { id: transaction.id, returnTo },
          }))
      }
      onLongPress={onLongPress}
      // A little longer than the platform default, so a scroll or a swipe that starts slowly is
      // not taken for a hold.
      delayLongPress={LONG_PRESS_DELAY_MS}
      active={selected}
      pressedScale={0.985}
      stateLayerShape="container"
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        minHeight: compact ? 54 : 64,
        // Stated for the focus ring and for containers that don't publish bounds; the ledger's
        // day slabs and widget cards square the wash off and clip it themselves.
        borderRadius: radius.control,
        borderCurve: "continuous",
        // As on SettingsRow: the state layer is the press feedback where a theme draws one.
        opacity: pressed && !theme.stateLayers ? 0.65 : 1,
      })}
    >
      {selectionMode ? (
        <MotionView
          variant="zoom"
          animateLayout
          style={{ width: 24, height: 24 }}
        >
          <View
            style={{
              flex: 1,
              borderRadius: radius.sm,
              alignItems: "center",
              justifyContent: "center",
              ...(selected
                ? materialStyle(theme, "accent")
                : materialStyle(theme, "sunken")),
            }}
          >
            {selected ? (
              <MotionView variant="zoom" exit>
                <AppIcon name="checkmark" color={theme.onAccent} size={16} />
              </MotionView>
            ) : null}
          </View>
        </MotionView>
      ) : null}
      <IconBadge
        icon={
          isTransfer
            ? "arrow.left.arrow.right"
            : (category?.icon ?? (isIncome ? "arrow.down" : "arrow.up"))
        }
        color={category?.color}
        role={category && !isTransfer ? "category" : "ui"}
        fallback={{
          container: theme.accentContainer,
          onContainer: theme.onAccentContainer,
        }}
        size={compact ? theme.tile.compactSize : theme.tile.size}
        iconSize={compact ? theme.tile.compactIcon : theme.tile.icon}
        raised
      />
      <View style={{ flex: 1, minWidth: 0, gap: space.xxs }}>
        <View
          style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}
        >
          <AppText
            literal
            variant="label"
            numberOfLines={1}
            style={{ flexShrink: 1 }}
          >
            {transaction.title}
          </AppText>
          {transaction.status === "upcoming" ? (
            <View
              style={{
                borderRadius: radius.pill,
                paddingHorizontal: space.sm,
                paddingVertical: space.xxs,
                ...materialStyle(theme, "well"),
              }}
            >
              <AppText
                selectable={false}
                variant="eyebrow"
                style={{ color: theme.onAccentContainer }}
              >
                {transaction.localDate < todayLocal() ? "OVERDUE" : "UPCOMING"}
              </AppText>
            </View>
          ) : null}
        </View>
        <AppText
          literal
          variant="caption"
          muted
          numberOfLines={1}
        >{`${categoryLabel} · ${accountLabel}${compact && transaction.status === "upcoming" ? ` · ${t("Due")} ${mediumDate(transaction.localDate, locale)}` : ""}`}</AppText>
        {foreignFeeCaption ? (
          <AppText literal variant="caption" muted numberOfLines={1}>
            {foreignFeeCaption}
          </AppText>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: space.xxs }}>
        <AppText literal figure variant="label" style={{ color }}>
          {amountText}
        </AppText>
        {showDate && !compact ? (
          <AppText literal variant="caption" muted>
            {mediumDate(transaction.localDate, locale)}
          </AppText>
        ) : null}
      </View>
    </MotionPressable>
  );
});
