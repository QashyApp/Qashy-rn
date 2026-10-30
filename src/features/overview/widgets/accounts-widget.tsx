import { router } from "expo-router";
import { View } from "react-native";

import { AnimatedMoney } from "@/components/finance/animated-money";
import { IconBadge } from "@/components/ui/icon-badge";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { MotionView } from "@/components/ui/motion";
import { SectionHeader } from "@/components/ui/section-header";
import { useLocalization } from "@/localization/localization";
import { useQashyTheme } from "@/theme/theme";
import { startOfMonth, toLocalDate } from "@/utils/date";
import { useNow } from "@/hooks/use-now";
import { accountTypeIcon, accountTypeLabel } from "@/utils/labels";
import type { WidgetProps } from "@/features/overview/widgets/types";

export function AccountsWidget({ month, summary }: WidgetProps) {
  const theme = useQashyTheme();
  const { space } = theme;
  const { locale, t } = useLocalization();
  // Balances are what the accounts hold today whichever month is browsed (like net worth), so on
  // any other month the card says so rather than letting them read as that month's closing balances.
  const isCurrentMonth =
    startOfMonth(month) === startOfMonth(toLocalDate(new Date(useNow())));

  return (
    <View style={{ gap: space.sm }}>
      <SectionHeader
        title="Accounts"
        action="Manage"
        onAction={() => router.push("/more")}
      />
      {summary.accountBalances.length && !isCurrentMonth ? (
        <AppText variant="caption" muted>
          As of today
        </AppText>
      ) : null}
      {summary.accountBalances.length ? (
        <Card variant="list" dividerInset={theme.tile.size + space.md}>
          {summary.accountBalances.map(({ account, balanceMinor }) => {
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
                  <IconBadge
                    icon={accountTypeIcon(account.type)}
                    color={account.color}
                    fallback={{
                      container: theme.accentContainer,
                      onContainer: theme.onAccentContainer,
                    }}
                  />
                  <View style={{ flex: 1, gap: space.xxs }}>
                    <AppText literal variant="label">
                      {account.name}
                    </AppText>
                    <AppText
                      literal
                      variant="caption"
                      muted
                    >{`${account.currency} · ${t(accountTypeLabel(account.type))}`}</AppText>
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
