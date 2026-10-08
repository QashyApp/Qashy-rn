import { Pressable, View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import type { NavBarStyle } from "@/domain/models";
import { useLocalization } from "@/localization/localization";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";

const MOCK_ITEMS = [0, 1, 2, 3];

/** A miniature of the bar: a docked strip for native, an inset pill for floating. */
function MockBar({ style }: { style: NavBarStyle }) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const floating = style === "floating";
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        height: 104,
        borderRadius: radius.control,
        borderCurve: "continuous",
        backgroundColor: theme.background,
        borderWidth: 1,
        borderColor: theme.border,
        overflow: "hidden",
        justifyContent: "flex-end",
        padding: floating ? space.sm : 0,
      }}
    >
      <View
        style={[
          {
            height: 28,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-around",
            paddingHorizontal: space.xs,
          },
          floating
            ? {
                borderRadius: radius.pill,
                borderCurve: "continuous",
                ...materialStyle(theme, "raised"),
              }
            : { backgroundColor: theme.surfaceElevated },
        ]}
      >
        {MOCK_ITEMS.map((item) => (
          <View
            key={item}
            style={{
              width: item === 0 ? 22 : 10,
              height: 10,
              borderRadius: radius.pill,
              backgroundColor:
                item === 0 ? theme.accentContainer : theme.textMuted,
              opacity: item === 0 ? 1 : 0.5,
            }}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * One option in the navigation bar style sheet: a mock bar, a name and a caption, with a radio-style
 * selected state. It is a single `radio` for assistive tech.
 */
export function NavBarStyleCard({
  style,
  label,
  caption,
  selected,
  onPress,
}: {
  style: NavBarStyle;
  label: string;
  caption: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const { t } = useLocalization();
  return (
    <Pressable
      accessibilityLabel={`${t(label)}. ${t(caption)}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 48,
        gap: space.sm,
        padding: space.sm,
        borderRadius: radius.card,
        borderCurve: "continuous",
        borderWidth: 2,
        borderColor: selected ? theme.accent : theme.border,
        backgroundColor: selected ? theme.accentContainer : theme.surface,
      }}
    >
      <MockBar style={style} />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: space.xs,
        }}
      >
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: radius.pill,
            borderWidth: 2,
            borderColor: selected ? theme.accent : theme.textMuted,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {selected ? (
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: radius.pill,
                backgroundColor: theme.accent,
              }}
            />
          ) : null}
        </View>
        <AppText variant="label" style={{ flex: 1 }}>
          {t(label)}
        </AppText>
      </View>
      <AppText variant="caption" muted style={{ paddingHorizontal: space.xs }}>
        {t(caption)}
      </AppText>
    </Pressable>
  );
}
