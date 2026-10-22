import { type ReactNode } from "react";
import { View } from "react-native";

import { AppIcon } from "@/components/ui/app-icon";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";

/** A recessed panel for text that is compared or copied by eye rather than tapped. */
export function SunkenWell({ children }: { readonly children: ReactNode }) {
  const theme = useQashyTheme();
  return (
    <View
      style={[
        {
          padding: theme.space.lg,
          borderRadius: theme.radius.card,
          borderCurve: "continuous",
        },
        materialStyle(theme, "sunken"),
      ]}
    >
      {children}
    </View>
  );
}

export function IconBadge({ icon }: { readonly icon: string }) {
  const theme = useQashyTheme();
  return (
    <View
      style={{
        width: 56,
        height: 56,
        borderRadius: theme.radius.card,
        borderCurve: "continuous",
        backgroundColor: theme.accentContainer,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <AppIcon name={icon} color={theme.onAccentContainer} size={24} />
    </View>
  );
}
