import { useState } from "react";
import { Platform, Text, View } from "react-native";

import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { MotionPressable } from "@/components/ui/motion";
import { StatusPill } from "@/components/ui/status-pill";
import { TextButton } from "@/components/ui/text-button";
import { useLocalization } from "@/localization/localization";
import { materialStyle } from "@/theme/materials";
import { accentTokens, useQashyTheme } from "@/theme/theme";
import { listAvailableThemes } from "@/theme/themes/registry";
import type { ThemeDefinition } from "@/theme/themes/types";
import { fontStyle } from "@/theme/typography";
import { hapticSelection } from "@/services/haptics";

/**
 * One-line descriptions of the built-in themes, keyed by `theme.id`. They are English UI copy,
 * translated through `t` like every other string; a custom theme has no entry and shows its name only.
 * Keep these free of the words "light"/"dark" so a theme is never confused with the mode radios.
 */
const THEME_DESCRIPTIONS: Record<string, string> = {
  classic: "Lilac-tinted surfaces, soft depth and lively controls.",
  "material-you":
    "Rounded Material surfaces that follow your Android system colors.",
  "high-contrast": "Maximum contrast and bold edges for easy reading.",
};

/** Lines reserved for a card's description (or Custom badge), so all cards share one height. */
export const DESCRIPTION_LINES = 4;

/** The narrowest a card may be; the picker fits as many columns of at least this width as it can. */
const MIN_CARD_WIDTH = 150;

/**
 * Whether the user's accent choice applies to `theme`. `system` only differs from `fixed` on
 * Android, where the platform supplies the accent; anywhere else it falls back to the theme's own.
 */
export function effectiveAccentMode(
  theme: ThemeDefinition,
  os: string = Platform.OS,
): "user" | "fixed" | "system" {
  if (theme.accent.mode === "system" && os !== "android") return "fixed";
  return theme.accent.mode;
}

export function themeDescription(theme: ThemeDefinition): string | undefined {
  return THEME_DESCRIPTIONS[theme.id];
}

/**
 * A theme drawn from its own data, without switching the app: a mini page, a raised card and an
 * accent button built from `accentTokens(theme.accent.default, dark, theme)`, set in the theme's own
 * type face and corner radius. No icons: `AppIcon` always reads the *active* theme.
 */
export function ThemePreviewCard({
  theme,
  selected,
  dark,
  onPress,
  custom = false,
  width,
}: {
  theme: ThemeDefinition;
  selected: boolean;
  dark: boolean;
  onPress: () => void;
  /** A user-authored theme: its name is data (shown as written) and it carries a "Custom" badge. */
  custom?: boolean;
  /** The card's width, set by the picker so every card in the grid is the same size. */
  width?: number;
}) {
  const app = useQashyTheme();
  const { t } = useLocalization();
  const preview = accentTokens(theme.accent.default, dark, theme);
  const description = themeDescription(theme);
  const name = t(theme.name);
  const label = [
    name,
    custom ? t("Custom") : undefined,
    description ? t(description) : undefined,
  ]
    .filter(Boolean)
    .join(". ");
  const captionLine = app.type.scale.caption.lineHeight;
  return (
    <MotionPressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      active={selected}
      onPress={() => {
        hapticSelection();
        onPress();
      }}
      pressedScale={0.97}
      hoverScale={1.02}
      style={{
        ...(width === undefined
          ? { flexGrow: 1, flexBasis: MIN_CARD_WIDTH, minWidth: 140 }
          : { width }),
        minHeight: 44,
        padding: app.space.sm,
        gap: app.space.sm,
        borderRadius: app.radius.card,
        borderCurve: "continuous",
        // The border never changes width, so selecting a card cannot resize it or shift its content.
        borderWidth: 1,
        borderColor: selected ? app.accent : app.border,
        backgroundColor: app.surface,
      }}
    >
      {/* Selection is a thicker accent ring drawn over the border (out of layout) plus the
          checkmark below, never color alone. */}
      {selected ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: -1,
            left: -1,
            right: -1,
            bottom: -1,
            borderWidth: 3,
            borderColor: app.accent,
            borderRadius: app.radius.card,
            borderCurve: "continuous",
          }}
        />
      ) : null}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          backgroundColor: preview.background,
          padding: app.space.sm,
          gap: app.space.sm,
          borderRadius: theme.radius.card,
          borderCurve: "continuous",
        }}
      >
        <View
          style={[
            {
              padding: app.space.sm,
              gap: 2,
              borderRadius: theme.radius.control,
              borderCurve: "continuous",
            },
            materialStyle(preview, "card"),
          ]}
        >
          {/* Fixed line heights: each theme's own face has different metrics, which would
              otherwise give every preview a different height. */}
          <Text
            selectable={false}
            numberOfLines={1}
            style={[
              fontStyle("semibold", theme.type),
              { fontSize: 14, lineHeight: 20, color: preview.text },
            ]}
          >
            {name}
          </Text>
          <Text
            selectable={false}
            numberOfLines={1}
            style={[
              fontStyle("regular", theme.type),
              { fontSize: 11, lineHeight: 16, color: preview.textMuted },
            ]}
          >
            $1,284.35
          </Text>
        </View>
        <View
          style={[
            {
              alignSelf: "flex-start",
              height: 22,
              paddingHorizontal: app.space.md,
              justifyContent: "center",
              borderRadius: theme.radius.pill,
              borderCurve: "continuous",
              backgroundColor: preview.accent,
            },
            { boxShadow: preview.shadowAccent },
          ]}
        >
          <Text
            selectable={false}
            style={[
              fontStyle("medium", theme.type),
              { fontSize: 11, lineHeight: 16, color: preview.onAccent },
            ]}
          >
            Aa
          </Text>
        </View>
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: app.space.xs,
        }}
      >
        <View style={{ flex: 1 }}>
          <AppText variant="label" literal numberOfLines={1}>
            {name}
          </AppText>
        </View>
        <View
          style={{
            width: 20,
            height: 20,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {selected ? (
            <AppIcon name="checkmark" color={app.accent} size={18} />
          ) : null}
        </View>
      </View>
      {/* The same room for every card, so a long translation or the Custom badge never makes
          one card taller than its neighbours. Sized for the longest built-in description in
          English and Hebrew; the full text is always in the accessibility label. */}
      <View style={{ minHeight: captionLine * DESCRIPTION_LINES }}>
        {description ? (
          <AppText variant="caption" muted numberOfLines={DESCRIPTION_LINES}>
            {description}
          </AppText>
        ) : null}
        {custom ? (
          <View style={{ alignSelf: "flex-start" }}>
            <StatusPill label="Custom" icon="paintbrush" />
          </View>
        ) : null}
      </View>
    </MotionPressable>
  );
}

/** The theme choice: a radiogroup of live preview cards. Used by Appearance and onboarding. */
export function ThemePicker({
  value,
  onChange,
  themes,
  dark,
  customIds,
  onDelete,
}: {
  value: string;
  onChange: (id: string) => void;
  /** Defaults to every theme this platform offers. */
  themes?: readonly ThemeDefinition[];
  /** Which scheme to preview; defaults to the app's current one. */
  dark?: boolean;
  /** Ids of user-authored themes: they get a "Custom" badge, and a Delete action when `onDelete` is set. */
  customIds?: readonly string[];
  onDelete?: (id: string) => void;
}) {
  const app = useQashyTheme();
  const { t } = useLocalization();
  const list = themes ?? listAvailableThemes();
  const previewDark = dark ?? app.mode === "dark";
  const deletable = onDelete
    ? list.filter((theme) => customIds?.includes(theme.id))
    : [];
  // Every card gets the same width, so a card alone on the last row does not stretch across it.
  const [rowWidth, setRowWidth] = useState(0);
  const gap = app.space.md;
  const columns = Math.max(
    1,
    Math.floor((rowWidth + gap) / (MIN_CARD_WIDTH + gap)),
  );
  // Floored, so rounding can never push the last card of a row onto the next one.
  const cardWidth =
    rowWidth > 0
      ? Math.floor((rowWidth - gap * (columns - 1)) / columns)
      : undefined;
  return (
    <View style={{ gap: app.space.md }}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("Theme")}
        onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
        style={{ flexDirection: "row", flexWrap: "wrap", gap }}
      >
        {list.map((theme) => (
          <ThemePreviewCard
            key={theme.id}
            theme={theme}
            selected={theme.id === value}
            dark={previewDark}
            custom={customIds?.includes(theme.id) ?? false}
            width={cardWidth}
            onPress={() => onChange(theme.id)}
          />
        ))}
      </View>
      {/* Delete lives outside the cards, so a custom theme's card is the same height as the rest. */}
      {onDelete
        ? deletable.map((theme) => (
            <View
              key={theme.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: app.space.md,
              }}
            >
              <View style={{ flex: 1 }}>
                <AppText variant="label" literal numberOfLines={1}>
                  {theme.name}
                </AppText>
              </View>
              <TextButton
                title="Delete theme"
                icon="trash"
                tone="danger"
                accessibilityLabel={`${t("Delete theme")}: ${theme.name}`}
                onPress={() => onDelete(theme.id)}
              />
            </View>
          ))
        : null}
    </View>
  );
}
