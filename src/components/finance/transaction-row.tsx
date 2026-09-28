import { router } from 'expo-router';
import { View, type ColorValue } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { MotionPressable, MotionView } from '@/components/ui/motion';
import type { TransactionRecord } from '@/domain/models';
import { useLocalization } from '@/localization/localization';
import { useFinanceState } from '@/providers/finance-provider';
import { materialStyle } from '@/theme/materials';
import { useQashyTheme } from '@/theme/theme';
import { radius, space, toneColors, tile as tileMetrics } from '@/theme/tokens';
import { formatMoney } from '@/utils/money';

// The category tile's own inset highlight, on top of the tinted container
// `toneColors` already computes. Not `theme.shadowControl` (that ladder is for
// full-size raised controls); a 32-40px tile only needs the top-edge catch,
// not an outer drop shadow that would compete with the row around it.
const TILE_INSET_HIGHLIGHT_LIGHT = 'inset 0 1px 0 rgba(255,255,255,0.4)';
const TILE_INSET_HIGHLIGHT_DARK = 'inset 0 1px 0 rgba(255,255,255,0.08)';

export function TransactionRow({
  transaction,
  compact = false,
  returnTo = '/transactions',
  selectionMode = false,
  selected = false,
  showDate = true,
  onPress,
  onLongPress,
}: {
  transaction: TransactionRecord;
  compact?: boolean;
  returnTo?: '/overview' | '/transactions';
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
}) {
  const { settings, accounts, categories } = useFinanceState();
  const theme = useQashyTheme();
  const { t } = useLocalization();
  const account = accounts.find((item) => item.id === transaction.accountId);
  const category = categories.find((item) => item.id === transaction.categoryId);
  const destination = accounts.find((item) => item.id === transaction.destinationAccountId);
  const isIncome = transaction.kind === 'income';
  const isTransfer = transaction.kind === 'transfer';
  const color = selected
    ? theme.onAccentContainer
    : isTransfer
      ? theme.transfer
      : isIncome
        ? theme.positive
        : theme.text;
  const direction = t(isTransfer ? 'Transfer, money moved' : isIncome ? 'Income, money in' : 'Expense, money out');
  const signedAmount = `${isIncome ? `${t('plus')} ` : isTransfer ? '' : `${t('minus')} `}${formatMoney(transaction.amountMinor, transaction.currency, settings.locale)}`;
  const accountContext = isTransfer
    ? `${account?.name ?? t('Unknown account')} ${t('into')} ${destination?.name ?? t('Unknown account')}`
    : account?.name ?? t('Unknown account');
  // The original foreign amount and any fee are context, not the headline number —
  // the row's own amount stays the account-currency total. Both fold into the
  // accessible label too, so a screen reader hears exactly what the caption shows.
  const foreignText = transaction.foreign
    ? formatMoney(transaction.foreign.amountMinor, transaction.foreign.currency, settings.locale)
    : null;
  const feeText = transaction.fee && transaction.fee.amountMinor > 0
    ? `${t('incl.')} ${formatMoney(transaction.fee.amountMinor, transaction.currency, settings.locale)} ${t('fee')}`
    : null;
  const foreignFeeCaption = [foreignText, feeText].filter((part): part is string => Boolean(part)).join(' · ');
  const rowLabel = [
    direction,
    transaction.title,
    signedAmount,
    category?.name ?? t(isTransfer ? 'Transfer' : 'Uncategorized'),
    accountContext,
    transaction.localDate,
    foreignFeeCaption || undefined,
  ].filter((part): part is string => Boolean(part)).join(', ');
  // The fallbacks are the only translatable parts of the caption, so they are
  // resolved here and the whole line renders verbatim. Otherwise a category or
  // account the user named "Savings" would be rewritten by the dictionary.
  const categoryLabel = category?.name ?? t(isTransfer ? 'Transfer' : 'Uncategorized');
  const accountLabel = isTransfer
    ? `${account?.name ?? t('Unknown account')} → ${destination?.name ?? t('Unknown account')}`
    : account?.name ?? t('Unknown account');
  const amountText = `${isIncome ? '+' : isTransfer ? '' : '-'}${formatMoney(transaction.amountMinor, transaction.currency, settings.locale)}`;
  // Category colors are identity, not emphasis. Painted at full saturation
  // across a 44pt tile they turned a mixed list into a row of signal lights all
  // shouting at once, and the amount — the reason a ledger exists — came third
  // after them. Tinted toward the surface they still identify at a glance while
  // leaving the strongest contrast in the row to the number.
  const tile: { container: ColorValue; onContainer: ColorValue } = category
    ? toneColors(category.color, theme.staticSurface, theme.staticText, theme.mode === 'dark')
    : { container: theme.accentContainer, onContainer: theme.onAccentContainer };

  return (
    <MotionPressable
      accessibilityActions={!selectionMode && onLongPress ? [{ name: 'longpress', label: t('Select transaction') }] : undefined}
      accessibilityHint={!selectionMode && onLongPress ? t('Long press to select this transaction for batch actions.') : undefined}
      accessibilityRole={selectionMode ? 'checkbox' : 'button'}
      accessibilityLabel={selectionMode ? `${rowLabel}, ${t(selected ? 'selected' : 'not selected')}` : rowLabel}
      accessibilityState={selectionMode ? { checked: selected } : undefined}
      aria-checked={selectionMode ? selected : undefined}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'longpress') onLongPress?.();
      }}
      onPress={onPress ?? (() => router.push({ pathname: '/transaction', params: { id: transaction.id, returnTo } }))}
      onLongPress={onLongPress}
      active={selected}
      pressedScale={0.985}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: compact ? 54 : 64, opacity: pressed ? 0.65 : 1 })}>
      {selectionMode ? (
        <MotionView variant="zoom" animateLayout style={{ width: 24, height: 24 }}>
          <View
            style={{
              flex: 1,
              borderRadius: radius.sm,
              alignItems: 'center',
              justifyContent: 'center',
              ...(selected ? materialStyle(theme, 'accent') : materialStyle(theme, 'sunken')),
            }}>
            {selected ? (
              <MotionView variant="zoom" exit>
                <AppIcon name="checkmark" color={theme.onAccent} size={16} />
              </MotionView>
            ) : null}
          </View>
        </MotionView>
      ) : null}
      <View
        style={{
          width: compact ? tileMetrics.compactSize : tileMetrics.size,
          height: compact ? tileMetrics.compactSize : tileMetrics.size,
          borderRadius: radius.tile,
          borderCurve: 'continuous',
          backgroundColor: tile.container,
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: theme.mode === 'dark' ? TILE_INSET_HIGHLIGHT_DARK : TILE_INSET_HIGHLIGHT_LIGHT,
        }}>
        <AppIcon name={isTransfer ? 'arrow.left.arrow.right' : category?.icon ?? (isIncome ? 'arrow.down' : 'arrow.up')} color={tile.onContainer} size={compact ? tileMetrics.compactIcon : tileMetrics.icon} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: space.xxs }}>
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
          <AppText literal variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>{transaction.title}</AppText>
          {transaction.status === 'upcoming' ? (
            <View style={{ borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: space.xxs, backgroundColor: theme.accentContainer, boxShadow: theme.shadowSunken }}>
              <AppText selectable={false} variant="eyebrow" style={{ color: theme.onAccentContainer }}>UPCOMING</AppText>
            </View>
          ) : null}
        </View>
        <AppText literal variant="caption" muted numberOfLines={1}>{`${categoryLabel} · ${accountLabel}`}</AppText>
        {foreignFeeCaption ? (
          <AppText literal variant="caption" muted numberOfLines={1}>{foreignFeeCaption}</AppText>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: space.xxs }}>
        <AppText literal figure variant="label" style={{ color }}>
          {amountText}
        </AppText>
        {showDate && !compact ? <AppText literal variant="caption" muted>{transaction.localDate}</AppText> : null}
      </View>
    </MotionPressable>
  );
}
