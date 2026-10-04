import { ScrollView, View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { QashySwitch } from "@/components/ui/qashy-switch";
import { useLocalization } from "@/localization/localization";
import {
  useFinanceRepository,
  useFinanceSettings,
} from "@/providers/finance-provider";
import { useQashyTheme } from "@/theme/theme";
import { errorMessage, showError } from "@/utils/confirm";

export function GesturesScreen() {
  const repository = useFinanceRepository();
  const settings = useFinanceSettings();
  const theme = useQashyTheme();
  const { t } = useLocalization();

  // Applies immediately, like language and theme.
  const changeSwipe = async (enabled: boolean) => {
    try {
      await repository.updateSettings({ swipeBetweenMonths: enabled });
    } catch (reason) {
      showError(
        "Couldn’t apply this setting",
        errorMessage(reason, "Try again."),
      );
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
            <AppText variant="label">Swipe to change month</AppText>
            <AppText variant="caption" muted>
              Swipe left or right on Overview and Transactions to move between
              months.
            </AppText>
          </View>
          <QashySwitch
            accessibilityLabel={t("Swipe to change month")}
            value={settings.swipeBetweenMonths ?? false}
            onValueChange={changeSwipe}
          />
        </View>
      </Card>
    </ScrollView>
  );
}
