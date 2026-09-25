import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { SettingsRow } from '@/components/ui/settings-row';
import type { RateFetchErrorCode } from '@/data/exchange-rates/rate-client';
import { useLocalization } from '@/localization/localization';
import { useFinanceRepository, useFinanceState } from '@/providers/finance-provider';
import { useExchangeRateService, useExchangeRateStatus } from '@/providers/exchange-rate-provider';
import { useQashyTheme } from '@/theme/theme';
import { space } from '@/theme/tokens';
import { errorMessage, showError } from '@/utils/confirm';
import { endOfMonth, startOfMonth } from '@/utils/date';
import { isFetchedRate } from '@/utils/deterministic-id';
import { useNow } from '@/utils/use-now';
import { relativeTime } from '@/utils/relative-time';

// A settings row is a 38pt icon tile plus a 12pt gap; matches `more-screen.tsx`'s own rows so
// the divider lines up with the text rather than the icon.
const ROW_DIVIDER_INSET = 38 + space.md;

const ERROR_MESSAGES: Record<RateFetchErrorCode, string> = {
  offline: 'This device looks offline. Automatic rates will try again the next time it is online.',
  timeout: 'The request to frankfurter.dev timed out.',
  http: 'frankfurter.dev returned an error.',
  malformed: 'frankfurter.dev returned a response Qashy did not understand.',
};

interface NeedsManualRow {
  readonly key: string;
  readonly currency: string;
  readonly subtitle: string;
}

export function ExchangeRatesScreen() {
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const service = useExchangeRateService();
  const status = useExchangeRateStatus();
  const theme = useQashyTheme();
  const { t } = useLocalization();
  const now = useNow();
  const [toggling, setToggling] = useState(false);

  // Only consulted while auto-fetch is off — `summary.missingExchangeRates` already answers
  // "what does this vault currently lack a usable rate for", so this reuses it instead of
  // recomputing the same thing a second way.
  const summary = useMemo(() => {
    void state.accounts;
    void state.exchangeRates;
    void state.settings;
    void state.transactions;
    return repository.getDashboard(startOfMonth(), endOfMonth());
  }, [repository, state.accounts, state.exchangeRates, state.settings, state.transactions]);

  const needsManual = useMemo(() => {
    const rows: NeedsManualRow[] = [];
    const covered = new Set<string>();
    for (const code of status.unsupported) {
      rows.push({ key: `unsupported-${code}`, currency: code, subtitle: `Automatic rates aren’t available for ${code}; add rates manually.` });
      covered.add(code);
    }
    for (const conflict of status.conflicts) {
      rows.push({
        key: `conflict-${conflict.fromCurrency}-${conflict.toCurrency}-${conflict.effectiveDate}`,
        currency: conflict.fromCurrency,
        subtitle: `Your manual ${conflict.fromCurrency} → ${conflict.toCurrency} rate disagrees with the automatic rate; edit or remove it.`,
      });
      covered.add(conflict.fromCurrency);
    }
    if (!status.enabled) {
      for (const missing of summary.missingExchangeRates) {
        if (covered.has(missing.fromCurrency)) continue;
        rows.push({ key: `missing-${missing.fromCurrency}`, currency: missing.fromCurrency, subtitle: `No effective rate for ${missing.fromCurrency} yet.` });
        covered.add(missing.fromCurrency);
      }
    }
    return rows;
  }, [status.unsupported, status.conflicts, status.enabled, summary.missingExchangeRates]);

  const manualRates = useMemo(
    () => state.exchangeRates.filter((rate) => !rate.deletedAt && !isFetchedRate(rate)),
    [state.exchangeRates],
  );
  const automaticCount = useMemo(
    () => state.exchangeRates.filter((rate) => !rate.deletedAt && isFetchedRate(rate)).length,
    [state.exchangeRates],
  );

  const lastUpdated = status.lastRefreshAt ? relativeTime(status.lastRefreshAt, now) : '';

  const toggle = async (next: boolean) => {
    if (toggling) return;
    setToggling(true);
    try {
      await service.setEnabled(next);
      // Idempotent via occurrence keys: retries whatever rule generation skipped for lack of a
      // rate, now that turning this on may have just supplied one. Never blocks the toggle.
      if (next) await repository.generateRecurring();
    } catch (reason) {
      showError('Couldn’t update automatic rates', errorMessage(reason, 'Try again.'));
    } finally {
      setToggling(false);
    }
  };

  const refresh = () => {
    if (status.fetching) return;
    service.refreshLatest({ force: true }).catch(() => undefined);
  };

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: theme.background }} contentContainerStyle={{ padding: 18, paddingBottom: 40, gap: 16, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
      <Card style={{ gap: 16 }}>
        <AppText variant="headline">Exchange rates</AppText>
        <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="label">Fetch rates automatically</AppText>
            <AppText variant="caption" muted>Off by default. Sends only currency codes and dates to frankfurter.dev — never amounts or account details. Frankfurter can see your IP address.</AppText>
          </View>
          <Switch accessibilityLabel={t('Fetch rates automatically')} value={status.enabled} onValueChange={toggle} disabled={toggling} trackColor={{ true: theme.accent }} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
          <AppText literal variant="caption" muted>
            {lastUpdated ? `Last updated ${lastUpdated}` : 'Never updated'}
          </AppText>
          <ActionButton
            title={status.fetching ? 'Refreshing…' : 'Refresh now'}
            variant="secondary"
            onPress={refresh}
            disabled={status.fetching || !status.enabled}
          />
        </View>
        {status.lastError ? (
          <AppText accessibilityRole="alert" variant="caption" style={{ color: theme.negative }}>
            {ERROR_MESSAGES[status.lastError]}
          </AppText>
        ) : null}
      </Card>

      {needsManual.length ? (
        <>
          <SectionHeader title="Needs a manual rate" />
          <Card variant="list" dividerInset={ROW_DIVIDER_INSET}>
            {needsManual.map((row) => (
              <SettingsRow
                key={row.key}
                literal
                title={row.currency}
                subtitle={row.subtitle}
                icon="exclamationmark.triangle"
                onPress={() => router.push({ pathname: '/exchange-rate', params: { currency: row.currency, returnTo: '/exchange-rates' } })}
              />
            ))}
          </Card>
        </>
      ) : null}

      {manualRates.length ? (
        <>
          <SectionHeader title="Manual rates" />
          <Card variant="list" dividerInset={ROW_DIVIDER_INSET}>
            {manualRates.map((rate) => (
              <SettingsRow
                key={rate.id}
                literal
                title={`${rate.fromCurrency} → ${rate.toCurrency}`}
                subtitle={t(`Effective ${rate.effectiveDate}`)}
                value={rate.rate}
                icon="arrow.left.arrow.right"
                onPress={() => router.push({ pathname: '/exchange-rate', params: { id: rate.id, returnTo: '/exchange-rates' } })}
              />
            ))}
          </Card>
          {automaticCount ? (
            <AppText literal variant="caption" muted>{`${automaticCount} automatic rate${automaticCount === 1 ? '' : 's'} stored.`}</AppText>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
