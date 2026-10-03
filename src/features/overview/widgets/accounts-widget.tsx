import { router } from "expo-router";
import { View } from "react-native";

import { AnimatedMoney } from "@/components/finance/animated-money";
import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { MotionView } from "@/components/ui/motion";
import { SectionHeader } from "@/components/ui/section-header";
import { useLocalization } from "@/localization/localization";
import { useFinanceState } from "@/providers/finance-provider";
import { toneColors } from "@/theme/tokens";
import { useQashyTheme } from "@/theme/theme";
import { accountTypeIcon, accountTypeLabel } from "@/utils/labels";
import type { WidgetProps } from "@/features/overview/widgets/types";
import { useDashboard } from "@/features/overview/widgets/use-dashboard";

export function AccountsWidget({ month }: WidgetProps) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const { t } = useLocalization();
  const state = useFinanceState();
  const summary = useDashboard(month);
  const locale = state.settings.locale;

  return (
    <View style={{ gap: space.sm }}>
      <SectionHeader
        title="Accounts"
        action="Manage"
        onAction={() => router.push("/more")}
      />
      {summary.accountBalances.length ? (
        <Card variant="list" dividerInset={theme.tile.size + space.md}>
          {summary.accountBalances.map(({ account, balanceMinor }) => {
            const tile = toneColors(
              account.color,
              theme.staticSurface,
              theme.staticText,
              theme.mode === "dark",
              theme.charts.tone,
            );
            return (
              <MotionView key={account.id} variant="fade" animateLayout exit>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.md,
                    minHeight: 60,
                  }}
                >
                  <View
                    style={{
                      width: theme.tile.size,
                      height: theme.tile.size,
                      borderRadius: radius.tile,
                      borderCurve: "continuous",
                      backgroundColor: tile.container,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <AppIcon
                      name={accountTypeIcon(account.type)}
                      color={tile.onContainer}
                      size={theme.tile.icon}
                    />
                  </View>
                  <View style={{ flex: 1, gap: space.xxs }}>
                    <AppText literal variant="label">
                      {account.name}
                    </AppText>
                    <AppText
                      literal
                      variant="caption"
                      muted
                    >{`${account.currency} · ${t(accountTypeLabel(account.type))}${account.archived ? ` · ${t("Archived")}` : ""}`}</AppText>
                  </View>
                  <AnimatedMoney
                    minor={balanceMinor}
                    currency={account.currency}
                    locale={locale}
                    variant="label"
                    numeric
                  />
                </View>
              </MotionView>
            );
          })}
        </Card>
      ) : (
        <Card>
          <AppText muted>Add an account to see its balance here.</AppText>
        </Card>
      )}
    </View>
  );
}
