import { router } from "expo-router";
import { View } from "react-native";

import { ActionButton } from "@/components/ui/action-button";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { TextButton } from "@/components/ui/text-button";
import { useQashyTheme } from "@/theme/theme";
import { IconBadge } from "@/features/sync/pair/pair-primitives";

export function DoneStep({
  outcome,
  firstRun = false,
}: {
  readonly outcome: { headline: string; body: string } | null;
  readonly firstRun?: boolean;
}) {
  const theme = useQashyTheme();
  const { space } = theme;
  if (firstRun) {
    return (
      <View
        accessibilityLiveRegion="polite"
        style={{
          alignItems: "center",
          gap: space.md,
          paddingVertical: space.xxl,
        }}
      >
        <IconBadge icon="arrow.triangle.2.circlepath" />
        <AppText variant="title" style={{ textAlign: "center" }}>
          Receiving your data…
        </AppText>
        <AppText muted style={{ textAlign: "center", maxWidth: 420 }}>
          This device joined your vault. Keep the other device open nearby —
          Qashy opens as soon as your accounts arrive.
        </AppText>
      </View>
    );
  }
  return (
    <>
      <View
        style={{
          alignItems: "center",
          gap: space.md,
          paddingVertical: space.lg,
        }}
      >
        <IconBadge icon="checkmark" />
        <AppText variant="title" style={{ textAlign: "center" }}>
          {outcome?.headline ?? "Paired"}
        </AppText>
        <AppText muted style={{ textAlign: "center", maxWidth: 420 }}>
          {outcome?.body ?? "Both devices now hold the same vault key."}
        </AppText>
      </View>

      <Card style={{ gap: space.sm }}>
        <AppText variant="label">If both devices already had data</AppText>
        <AppText variant="caption" muted>
          Anything you created on both is now in the vault twice. Qashy renamed
          the collisions rather than guessing which are the same — the review
          screen is where you decide.
        </AppText>
      </Card>

      <ActionButton
        title="Review duplicates"
        icon="arrow.triangle.2.circlepath"
        size="large"
        onPress={() => router.replace("/sync-merge")}
      />
      <TextButton
        title="Done"
        tone="muted"
        onPress={() => router.replace("/sync")}
      />
    </>
  );
}
