import { ScrollView, View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { OptionRow } from "@/components/ui/option-row";
import {
  BUNDLED_LANGUAGES,
  isAndroid,
  languageLabel,
  PLAY_TRANSLATED_LANGUAGES,
  SYSTEM_PREFERENCE,
  type LanguageOption,
} from "@/localization/language-preference";
import { useLocalization } from "@/localization/localization";
import { useQashyTheme } from "@/theme/theme";
import { errorMessage, showError } from "@/utils/confirm";

/**
 * The per-device app language. It applies the moment a row is chosen — the same live switch,
 * RTL included, as the onboarding welcome step — and is never stored in `AppSettings` or synced.
 * On Android the choice is the system per-app language, so system Settings shows the same one.
 */
export function LanguageScreen() {
  const theme = useQashyTheme();
  const { space } = theme;
  const { t, preference, systemLocale, setPreference } = useLocalization();
  const android = isAndroid();
  const options: LanguageOption[] = [
    ...BUNDLED_LANGUAGES,
    ...(android ? PLAY_TRANSLATED_LANGUAGES : []),
  ];

  const choose = (next: string) => {
    setPreference(next).catch((reason) => {
      showError(
        "Couldn’t apply this setting",
        errorMessage(reason, "Try again."),
      );
    });
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{
        padding: space.xl,
        paddingBottom: space.xxxl + space.sm,
        gap: space.lg,
        width: "100%",
        maxWidth: 720,
        alignSelf: "center",
      }}
    >
      <Card style={{ gap: space.lg }}>
        <AppText variant="headline">Language</AppText>
        <AppText muted>
          Qashy follows your device’s language by default. Choose another one
          for this device only.
        </AppText>
        <View
          accessibilityLabel={t("Language")}
          accessibilityRole="radiogroup"
          style={{ gap: space.sm }}
        >
          <OptionRow
            literal
            title={t("System default")}
            description={languageLabel(systemLocale, android)}
            selected={preference === SYSTEM_PREFERENCE}
            onPress={() => choose(SYSTEM_PREFERENCE)}
          />
          {options.map((option) => (
            <OptionRow
              key={option.tag}
              literal
              title={option.label}
              selected={preference === option.tag}
              onPress={() => choose(option.tag)}
            />
          ))}
        </View>
      </Card>
    </ScrollView>
  );
}
