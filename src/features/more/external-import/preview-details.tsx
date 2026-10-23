import { View } from "react-native";

import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import {
  type ExternalImportOutcome,
  type ImportBundle,
} from "@/data/import/types";
import { useLocalization } from "@/localization/localization";
import { useQashyTheme } from "@/theme/theme";
import { formatMoney } from "@/utils/money";

/** Balances, notes and renames: useful context, never the thing the step is asking for. */
export function PreviewDetails({
  bundle,
  outcome,
}: {
  bundle: ImportBundle;
  outcome: ExternalImportOutcome;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const { t, locale } = useLocalization();
  const { warnings, balanceChecks } = bundle.report;

  return (
    <View style={{ gap: space.md }}>
      {balanceChecks.length ? (
        <View
          accessibilityLabel={t("Balances checked")}
          role="group"
          style={{ gap: space.xs }}
        >
          <AppText variant="label">Balances checked</AppText>
          {balanceChecks.map((check) => {
            const matches =
              check.sourceBalanceMinor === check.importedBalanceMinor;
            return (
              <View
                key={check.accountExternalId}
                style={{
                  minHeight: 32,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.sm,
                }}
              >
                <AppText literal variant="caption" style={{ flex: 1 }}>
                  {check.name}
                </AppText>
                <AppText literal figure variant="label">
                  {formatMoney(
                    check.importedBalanceMinor,
                    check.currency,
                    locale,
                  )}
                </AppText>
                <AppIcon
                  name={
                    matches ? "checkmark.circle" : "exclamationmark.triangle"
                  }
                  color={matches ? theme.positive : theme.negative}
                  size={18}
                />
              </View>
            );
          })}
        </View>
      ) : null}

      {warnings.length ? (
        <View
          accessibilityLabel={t("Notes about this backup")}
          role="group"
          style={{ gap: space.sm }}
        >
          <AppText variant="label">Notes about this backup</AppText>
          {warnings.map((warning) => (
            <View
              key={`${warning.code}:${warning.message}`}
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: space.sm,
              }}
            >
              <View style={{ paddingTop: space.xxs }}>
                <AppIcon name="info.circle" color={theme.textMuted} size={16} />
              </View>
              <AppText variant="caption" style={{ flex: 1 }}>
                {warning.message}
              </AppText>
              {warning.count > 0 ? (
                <View
                  style={{
                    minWidth: 24,
                    paddingHorizontal: space.sm,
                    borderRadius: radius.pill,
                    backgroundColor: theme.surfaceMuted,
                    alignItems: "center",
                  }}
                >
                  <AppText literal figure variant="caption" muted>
                    {String(warning.count)}
                  </AppText>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {outcome.renamed.length ? (
        <View style={{ gap: space.xs }}>
          {/* Built as one string so the pieces are announced together and the names
              (user data) are never run through the dictionary on their own. */}
          {outcome.renamed.slice(0, 5).map((item) => (
            <AppText
              key={`${item.kind}:${item.from}:${item.to}`}
              literal
              variant="caption"
              muted
            >
              {`${t("Renamed to avoid duplicates:")} ${item.from} → ${item.to}`}
            </AppText>
          ))}
          {outcome.renamed.length > 5 ? (
            <AppText literal variant="caption" muted>
              {t(`+${outcome.renamed.length - 5} more`)}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
