import { router } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";

import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { QashySwitch } from "@/components/ui/qashy-switch";
import { Card } from "@/components/ui/card";
import { MotionPressable } from "@/components/ui/motion";
import { SectionHeader } from "@/components/ui/section-header";
import { SettingsRow } from "@/components/ui/settings-row";
import { StatusPill } from "@/components/ui/status-pill";
import type { RateFetchErrorCode } from "@/data/exchange-rates/rate-client";
import { useLocalization } from "@/localization/localization";
import {
  useFinanceRepository,
  useFinanceState,
} from "@/providers/finance-provider";
import {
  useExchangeRateService,
  useExchangeRateStatus,
} from "@/providers/exchange-rate-provider";
import { useQashyTheme } from "@/theme/theme";
import { errorMessage, showError } from "@/utils/confirm";
import { endOfMonth, mediumDate, startOfMonth } from "@/utils/date";
import { useDashboardRange } from "@/features/overview/widgets/use-dashboard";
import { isFetchedRate } from "@/utils/deterministic-id";

// A settings row is a 38pt icon tile plus a 12pt gap; matches `more-screen.tsx`'s own rows so
// the divider lines up with the text rather than the icon.

const ERROR_MESSAGES: Record<RateFetchErrorCode, string> = {
  offline:
    "This device looks offline. Automatic rates will try again the next time it is online.",
  timeout: "The request to frankfurter.dev timed out.",
  http: "frankfurter.dev returned an error.",
  malformed: "frankfurter.dev returned a response Qashy did not understand.",
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
  const { radius, space } = theme;
  const rowDividerInset = 38 + space.md;
  const { t } = useLocalization();
  const [toggling, setToggling] = useState(false);

  // Only consulted while auto-fetch is off or failing — `summary.missingExchangeRates` already answers
  // "what does this vault currently lack a usable rate for", so this reuses it instead of
  // recomputing the same thing a second way.
  const summary = useDashboardRange(startOfMonth(), endOfMonth());

  const needsManual = useMemo(() => {
    const rows: NeedsManualRow[] = [];
    const covered = new Set<string>();
    for (const code of status.unsupported) {
      rows.push({
        key: `unsupported-${code}`,
        currency: code,
        subtitle: `Automatic rates aren’t available for ${code}; add rates manually.`,
      });
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
    if (!status.enabled || status.lastError) {
      for (const missing of summary.missingExchangeRates) {
        if (covered.has(missing.fromCurrency)) continue;
        rows.push({
          key: `missing-${missing.fromCurrency}`,
          currency: missing.fromCurrency,
          subtitle: `No effective rate for ${missing.fromCurrency} yet.`,
        });
        covered.add(missing.fromCurrency);
      }
    }
    return rows;
  }, [
    status.unsupported,
    status.conflicts,
    status.enabled,
    status.lastError,
    summary.missingExchangeRates,
  ]);

  const manualRates = useMemo(
    () =>
      state.exchangeRates.filter(
        (rate) => !rate.deletedAt && !isFetchedRate(rate),
      ),
    [state.exchangeRates],
  );
  const automaticCount = useMemo(
    () =>
      state.exchangeRates.filter(
        (rate) => !rate.deletedAt && isFetchedRate(rate),
      ).length,
    [state.exchangeRates],
  );

  const toggle = async (next: boolean) => {
    if (toggling) return;
    setToggling(true);
    try {
      await service.setEnabled(next);
      // Idempotent via occurrence keys: retries whatever rule generation skipped for lack of a
      // rate, now that turning this on may have just supplied one. Never blocks the toggle.
      if (next) await repository.generateRecurring();
    } catch (reason) {
      showError(
        "Couldn’t update automatic rates",
        errorMessage(reason, "Try again."),
      );
    } finally {
      setToggling(false);
    }
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{
        padding: 18,
        paddingBottom: 40,
        gap: 16,
        width: "100%",
        maxWidth: 720,
        alignSelf: "center",
      }}
    >
      <Card style={{ gap: 16 }}>
        <AppText variant="headline">Exchange rates</AppText>
        <View
          style={{
            minHeight: 48,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="label">Fetch rates automatically</AppText>
            <AppText variant="caption" muted>
              On by default. Sends only currency codes and dates to
              frankfurter.dev — never amounts or account details. Frankfurter
              can see your IP address.
            </AppText>
          </View>
          {toggling ? (
            <ActivityIndicator color={theme.accent} />
          ) : (
            <QashySwitch
              accessibilityLabel={t("Fetch rates automatically")}
              value={status.enabled}
              onValueChange={toggle}
              disabled={toggling}
            />
          )}
        </View>
        {status.fetching ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs + 2,
            }}
          >
            <ActivityIndicator color={theme.accent} />
            <AppText variant="caption" muted>
              {t("Fetching latest rates…")}
            </AppText>
          </View>
        ) : null}
        {status.lastError ? (
          <AppText
            accessibilityRole="alert"
            variant="caption"
            style={{ color: theme.negative }}
          >
            {ERROR_MESSAGES[status.lastError]}
          </AppText>
        ) : null}
      </Card>

      {needsManual.length ? (
        <>
          <SectionHeader title="Needs a manual rate" />
          <Card variant="list" dividerInset={rowDividerInset}>
            {needsManual.map((row) => (
              <SettingsRow
                key={row.key}
                literal
                title={row.currency}
                subtitle={row.subtitle}
                icon="exclamationmark.triangle"
                onPress={() =>
                  router.push({
                    pathname: "/exchange-rate",
                    params: {
                      currency: row.currency,
                      returnTo: "/exchange-rates",
                    },
                  })
                }
              />
            ))}
          </Card>
        </>
      ) : null}

      {manualRates.length ? (
        <>
          <SectionHeader title="Manual rates" />
          <Card variant="list" dividerInset={rowDividerInset}>
            {manualRates.map((rate) => {
              const label = `${rate.fromCurrency} → ${rate.toCurrency}, ${rate.rate}, ${t("Manual")}, ${t(`Effective ${mediumDate(rate.effectiveDate, state.settings.locale)}`)}`;
              return (
                <MotionPressable
                  key={rate.id}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  onPress={() =>
                    router.push({
                      pathname: "/exchange-rate",
                      params: { id: rate.id, returnTo: "/exchange-rates" },
                    })
                  }
                  pressedScale={0.985}
                  style={({ pressed }) => ({
                    minHeight: 58,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.md,
                    opacity: pressed ? 0.62 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: radius.tile,
                      borderCurve: "continuous",
                      backgroundColor: theme.accentContainer,
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: `inset 0 1px 0 rgba(255,255,255,${theme.mode === "dark" ? 0.06 : 0.35})`,
                    }}
                  >
                    <AppIcon
                      name="arrow.left.arrow.right"
                      color={theme.accent}
                      size={20}
                    />
                  </View>
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={{ flex: 1, gap: space.xxs }}
                  >
                    <AppText
                      literal
                      variant="label"
                    >{`${rate.fromCurrency} → ${rate.toCurrency}`}</AppText>
                    <AppText literal variant="caption" muted>
                      {t(
                        `Effective ${mediumDate(rate.effectiveDate, state.settings.locale)}`,
                      )}
                    </AppText>
                  </View>
                  <StatusPill label="Manual" icon="pencil" tone="neutral" />
                  <AppText
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    literal
                    figure
                    variant="label"
                    numberOfLines={1}
                  >
                    {rate.rate}
                  </AppText>
                  <AppIcon
                    name="chevron.right"
                    color={theme.textMuted}
                    size={17}
                  />
                </MotionPressable>
              );
            })}
          </Card>
          {automaticCount ? (
            <AppText
              literal
              variant="caption"
              muted
            >{`${automaticCount} automatic rate${automaticCount === 1 ? "" : "s"} stored.`}</AppText>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
