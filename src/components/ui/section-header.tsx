import { View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { TextButton } from "@/components/ui/text-button";
import { useQashyTheme } from "@/theme/theme";

export function SectionHeader({
  title,
  action,
  actionIcon,
  onAction,
  secondaryAction,
  onSecondaryAction,
}: {
  title: string;
  action?: string;
  actionIcon?: string;
  onAction?: () => void;
  secondaryAction?: string;
  onSecondaryAction?: () => void;
}) {
  const { space } = useQashyTheme();
  const headingLevelProps =
    process.env.EXPO_OS === "web" ? ({ "aria-level": 2 } as object) : {};

  return (
    // The action's 44pt tap target is taller than the heading it sits beside, so
    // it is pulled back vertically. Without that the header owns more vertical
    // space than the rows it introduces and the rhythm of a stacked page breaks.
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space.lg,
        minHeight: 28,
      }}
    >
      <AppText
        {...headingLevelProps}
        accessibilityRole="header"
        variant="headline"
      >
        {title}
      </AppText>
      {action || secondaryAction ? (
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
        >
          {secondaryAction ? (
            <TextButton
              title={secondaryAction}
              onPress={onSecondaryAction}
              style={{ marginVertical: -space.sm }}
            />
          ) : null}
          {action ? (
            <TextButton
              title={action}
              icon={actionIcon}
              onPress={onAction}
              style={{ marginVertical: -space.sm, marginEnd: -space.xs }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
