import { useRouter } from "expo-router";
import { View } from "react-native";

import { ActionButton } from "@/components/ui/action-button";
import { AppText } from "@/components/ui/app-text";
import { ScreenContainer } from "@/components/ui/screen-container";
import { useQashyTheme } from "@/theme/theme";

export default function NotFoundRoute() {
  const theme = useQashyTheme();
  const router = useRouter();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <ScreenContainer style={{ alignItems: "center", gap: theme.space.md }}>
        <AppText variant="title" style={{ textAlign: "center" }}>
          Page not found
        </AppText>
        <AppText variant="body" muted style={{ textAlign: "center" }}>
          That address doesn’t match anything in Qashy. Your data is untouched.
        </AppText>
        <ActionButton
          title="Go to Overview"
          onPress={() => router.replace("/overview")}
          style={{ marginTop: theme.space.sm }}
        />
      </ScreenContainer>
    </View>
  );
}
