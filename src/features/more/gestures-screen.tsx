import { ScrollView, View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { QashySwitch } from "@/components/ui/qashy-switch";
import {
  SegmentedControl,
  type SegmentOption,
} from "@/components/ui/segmented-control";
import type { AnimationLevel } from "@/domain/models";
import { useLocalization } from "@/localization/localization";
import {
  useFinanceRepository,
  useFinanceSettings,
} from "@/providers/finance-provider";
import { useQashyTheme } from "@/theme/theme";
import { errorMessage, showError } from "@/utils/confirm";
import { hapticSelection, setHapticsEnabled } from "@/services/haptics";

const ANIMATION_LEVEL_OPTIONS: SegmentOption<AnimationLevel>[] = [
  { value: "all", label: "All" },
  { value: "minimal", label: "Minimal" },
  { value: "off", label: "Off" },
];

export function GesturesScreen() {
  const repository = useFinanceRepository();
  const settings = useFinanceSettings();
  const theme = useQashyTheme();
  const { space } = theme;
  const { t } = useLocalization();

  // Every setting here applies immediately, like language and theme.
  const apply = async (
    patch: Parameters<typeof repository.updateSettings>[0],
  ) => {
    try {
      await repository.updateSettings(patch);
      return true;
    } catch (reason) {
      showError(
        "Couldn’t apply this setting",
        errorMessage(reason, "Try again."),
      );
      return false;
    }
  };

  const changeSwipe = async (enabled: boolean) => {
    await apply({ swipeBetweenMonths: enabled });
  };

  const changeSwipeRows = async (enabled: boolean) => {
    await apply({ swipeRowActions: enabled });
  };

  const changeHaptics = async (enabled: boolean) => {
    if (!(await apply({ hapticsEnabled: enabled }))) return;
    // The switch's own tick fires before the preference lands, so turning haptics on would be
    // silent; this one lets the user feel what they just enabled.
    if (enabled) {
      setHapticsEnabled(true);
      hapticSelection();
    }
  };

  const changeAnimationLevel = async (animationLevel: AnimationLevel) => {
    if (animationLevel === (settings.animationLevel ?? "all")) return;
    await apply({ animationLevel });
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{
        padding: 18,
        paddingBottom: 40,
        gap: space.lg,
        width: "100%",
        maxWidth: 720,
        alignSelf: "center",
      }}
    >
      <Card style={{ gap: space.lg }}>
        <View
          style={{
            minHeight: 48,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <View style={{ flex: 1, gap: space.xxs }}>
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
      <Card style={{ gap: space.lg }}>
        <View
          style={{
            minHeight: 48,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <View style={{ flex: 1, gap: space.xxs }}>
            <AppText variant="label">Swipe rows for actions</AppText>
            <AppText variant="caption" muted>
              Swipe a transaction to delete it or change its category. Upcoming
              payments swipe to mark paid or skip.
            </AppText>
          </View>
          <QashySwitch
            accessibilityLabel={t("Swipe rows for actions")}
            value={settings.swipeRowActions ?? true}
            onValueChange={changeSwipeRows}
          />
        </View>
      </Card>
      {process.env.EXPO_OS === "android" ? (
        <Card style={{ gap: space.lg }}>
          <View
            style={{
              minHeight: 48,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 14,
            }}
          >
            <View style={{ flex: 1, gap: space.xxs }}>
              <AppText variant="label">Haptic feedback</AppText>
              <AppText variant="caption" muted>
                Short vibrations when you tap, switch options, save or hit an
                error.
              </AppText>
            </View>
            <QashySwitch
              accessibilityLabel={t("Haptic feedback")}
              value={settings.hapticsEnabled ?? true}
              onValueChange={changeHaptics}
            />
          </View>
        </Card>
      ) : null}
      <Card style={{ gap: space.md }}>
        <AppText variant="headline">Animations</AppText>
        <SegmentedControl
          label="Animations"
          options={ANIMATION_LEVEL_OPTIONS}
          value={settings.animationLevel ?? "all"}
          onChange={changeAnimationLevel}
        />
        <AppText variant="caption" muted>
          Minimal keeps quick fades only; Off changes things instantly. Your
          device’s reduce-motion setting always applies on top.
        </AppText>
      </Card>
    </ScrollView>
  );
}
