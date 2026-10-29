import { View } from "react-native";

import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { useLocalization } from "@/localization/localization";
import { useQashyTheme } from "@/theme/theme";
import { insetHighlight } from "@/theme/highlight";

const CSV_STEPS = ["Choose file", "Map columns", "Preview", "Import"] as const;

/**
 * A numbered horizontal step indicator for the import flow: completed steps read as filled
 * accent material, the current step is raised with an accent ring, and upcoming steps sit in a
 * sunken well — the same "material says the state" language as the rest of the redesign,
 * purely decorative (the real progress is driven by `sourceRows`/`preview`/committed state).
 */
export function CsvStepper({ current }: { current: number }) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const { t } = useLocalization();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: "row", alignItems: "flex-start" }}
    >
      {CSV_STEPS.map((label, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <View key={label} style={{ flex: 1, alignItems: "center" }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                width: "100%",
              }}
            >
              <View
                style={{
                  flex: 1,
                  height: 2,
                  backgroundColor:
                    index === 0
                      ? "transparent"
                      : index <= current
                        ? theme.accent
                        : theme.border,
                }}
              />
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: radius.pill,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: done
                    ? theme.accent
                    : active
                      ? theme.surfaceElevated
                      : theme.surfaceSunken,
                  boxShadow: done
                    ? theme.materialControls
                      ? undefined
                      : insetHighlight(theme.mode, 0.3)
                    : active
                      ? `inset 0 0 0 2px ${String(theme.accent)}, ${theme.shadowControl}`
                      : theme.shadowSunken,
                }}
              >
                {done ? (
                  <AppIcon name="checkmark" color={theme.onAccent} size={14} />
                ) : (
                  <AppText
                    selectable={false}
                    literal
                    figure
                    variant="caption"
                    style={{
                      color: active ? theme.accentText : theme.textMuted,
                    }}
                  >
                    {String(index + 1)}
                  </AppText>
                )}
              </View>
              <View
                style={{
                  flex: 1,
                  height: 2,
                  backgroundColor:
                    index === CSV_STEPS.length - 1
                      ? "transparent"
                      : done
                        ? theme.accent
                        : theme.border,
                }}
              />
            </View>
            <AppText
              variant="caption"
              muted={!active}
              numberOfLines={1}
              style={{
                marginTop: space.xxs,
                textAlign: "center",
                fontWeight: active ? "600" : "400",
              }}
            >
              {t(label)}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

/** One count in the preview summary: ready rows read as accent, rejected ones as negative when any. */
export function PreviewTile({
  value,
  label,
  tone = "plain",
}: {
  value: number;
  label: string;
  tone?: "accent" | "negative" | "plain";
}) {
  const theme = useQashyTheme();
  return (
    <View
      style={{
        flex: 1,
        minWidth: 120,
        padding: 14,
        borderRadius: theme.radius.card,
        backgroundColor:
          tone === "accent" ? theme.accentContainer : theme.surfaceMuted,
      }}
    >
      <AppText
        literal
        figure
        variant="headline"
        style={{
          color:
            tone === "accent"
              ? theme.accentText
              : tone === "negative"
                ? theme.negativeText
                : theme.text,
        }}
      >
        {String(value)}
      </AppText>
      <AppText variant="caption" muted>
        {label}
      </AppText>
    </View>
  );
}
