import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { MotionPressable, MotionView } from "@/components/ui/motion";
import type { AppSettings } from "@/domain/models";
import { useLocalization } from "@/localization/localization";
import {
  useFinanceRepository,
  useFinanceSettings,
} from "@/providers/finance-provider";
import { FONT_REGISTRY, isFontId, stackFor } from "@/theme/fonts";
import { useAllFonts } from "@/theme/use-theme-fonts";
import { ICON_SET_IDS, ICON_SETS, useIconSets } from "@/theme/icon-sets";
import { useCustomThemes } from "@/theme/custom/use-custom-themes";
import { useQashyTheme } from "@/theme/theme";
import { materialStyle } from "@/theme/materials";
import { getTheme } from "@/theme/themes/registry";
import type { ThemeDefinition } from "@/theme/themes/types";
import { fontStyle, numericFontStyle } from "@/theme/typography";
import { errorMessage, showError } from "@/utils/confirm";

type OverrideKey =
  | "fontTextOverride"
  | "fontNumericOverride"
  | "uiIconSetOverride"
  | "categoryIconSetOverride";

interface Option {
  /** The stored id, or null for "follow the theme". */
  id: string | null;
  label: string;
}

/** Sample glyphs for the icon previews; every set draws these or falls back to Ionicons. */
const PREVIEW_ICONS = [
  "ion:cart-outline",
  "ion:restaurant-outline",
  "ion:home-outline",
  "ion:car-outline",
];
const PREVIEW_UI_ICONS = [
  "plus",
  "magnifyingglass",
  "calendar",
  "chevron.right",
];

interface RowSpec {
  key: OverrideKey;
  title: string;
  /** Heading of the pop-up picker. */
  dialogTitle: string;
  kind: "text" | "numeric" | "ui" | "category";
}

const ROWS: RowSpec[] = [
  {
    key: "fontTextOverride",
    title: "Text font",
    dialogTitle: "Choose text font",
    kind: "text",
  },
  {
    key: "fontNumericOverride",
    title: "Numbers font",
    dialogTitle: "Choose numbers font",
    kind: "numeric",
  },
  {
    key: "uiIconSetOverride",
    title: "App icons (UI)",
    dialogTitle: "Choose app icons",
    kind: "ui",
  },
  {
    key: "categoryIconSetOverride",
    title: "Category icons",
    dialogTitle: "Choose category icons",
    kind: "category",
  },
];

function themeDefaultId(theme: ThemeDefinition, kind: RowSpec["kind"]) {
  switch (kind) {
    case "text":
      return theme.type.text.family;
    case "numeric":
      return theme.type.numeric.family;
    case "ui":
      return theme.icons.set;
    case "category":
      return theme.icons.categorySet ?? theme.icons.set;
  }
}

function labelOf(kind: RowSpec["kind"], id: string): string {
  if (kind === "text" || kind === "numeric")
    return FONT_REGISTRY[id]?.label ?? id;
  return ICON_SETS[id]?.label ?? id;
}

/**
 * Per-device font and icon-set overrides that sit on top of the selected theme. They are stored as
 * `deviceLocal` settings (never synced). "Theme default" clears the override. An id this build no
 * longer knows reads as the theme default, matching `applyAppearanceOverrides`.
 */
export function AppearanceOverridesCard() {
  const repository = useFinanceRepository();
  const settings = useFinanceSettings();
  const theme = useQashyTheme();
  const { space, radius } = theme;
  const { t } = useLocalization();
  const { height } = useWindowDimensions();
  const { themes: customThemes } = useCustomThemes();
  const [openKey, setOpenKey] = useState<OverrideKey | null>(null);
  const [busy, setBusy] = useState(false);
  // The selected theme's own choices, before any override: what "Theme default" means.
  const baseTheme = getTheme(settings.themeId, customThemes);

  const choose = async (key: OverrideKey, id: string | null) => {
    if (busy) return;
    if ((settings[key] ?? null) === id) {
      setOpenKey(null);
      return;
    }
    setBusy(true);
    try {
      await repository.updateSettings({
        [key]: id,
      } as Pick<AppSettings, OverrideKey>);
      setOpenKey(null);
    } catch (reason) {
      showError(
        "Couldn’t apply this setting",
        errorMessage(reason, "Try again."),
      );
    } finally {
      setBusy(false);
    }
  };

  const optionsFor = (spec: RowSpec): Option[] => {
    const fonts = spec.kind === "text" || spec.kind === "numeric";
    const ids = fonts ? Object.keys(FONT_REGISTRY) : Object.keys(ICON_SETS);
    return [
      {
        id: null,
        label: `${t("Theme default")} (${labelOf(spec.kind, themeDefaultId(baseTheme, spec.kind))})`,
      },
      ...ids.map((id) => ({ id, label: labelOf(spec.kind, id) })),
    ];
  };

  const preview = (spec: RowSpec, id: string) => {
    if (spec.kind === "text" || spec.kind === "numeric") {
      const type = { ...theme.type, [spec.kind]: stackFor(id) };
      const style =
        spec.kind === "text"
          ? fontStyle("semibold", type)
          : numericFontStyle("semibold", type);
      return (
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          allowFontScaling={false}
          numberOfLines={1}
          style={[
            style,
            { color: theme.textMuted, fontSize: 16, lineHeight: 22 },
          ]}
        >
          {spec.kind === "text" ? "Aa Groceries שלום" : "1,234.56 ₪ 0123"}
        </Text>
      );
    }
    const icons = spec.kind === "ui" ? PREVIEW_UI_ICONS : PREVIEW_ICONS;
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ flexDirection: "row", gap: space.md }}
      >
        {icons.map((icon) => (
          <AppIcon
            key={icon}
            name={icon}
            iconSetId={id}
            color={theme.textMuted}
            size={22}
          />
        ))}
      </View>
    );
  };

  const activeIdOf = (spec: RowSpec): string | null => {
    const stored = settings[spec.key];
    const known =
      typeof stored === "string" &&
      (spec.kind === "text" || spec.kind === "numeric"
        ? isFontId(stored)
        : Object.prototype.hasOwnProperty.call(ICON_SETS, stored));
    return known ? stored : null;
  };

  const openSpec = ROWS.find((spec) => spec.key === openKey) ?? null;
  const fontPicker = openSpec?.kind === "text" || openSpec?.kind === "numeric";
  useAllFonts(fontPicker);
  useIconSets(openSpec && !fontPicker ? ICON_SET_IDS : []);
  const close = () => setOpenKey(null);

  return (
    <Card style={{ gap: space.sm }}>
      <AppText variant="headline">Fonts and icons</AppText>
      <AppText muted>
        Override the theme’s typefaces and icon styles on this device. These
        choices are not synced.
      </AppText>
      {ROWS.map((spec) => {
        const activeId = activeIdOf(spec);
        const defaultId = themeDefaultId(baseTheme, spec.kind);
        const current = labelOf(spec.kind, activeId ?? defaultId);
        return (
          <MotionPressable
            key={spec.key}
            accessibilityRole="button"
            accessibilityLabel={`${t(spec.title)}, ${current}`}
            accessibilityHint={t("Opens a list of choices")}
            onPress={() => setOpenKey(spec.key)}
            style={{
              minHeight: 48,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: space.md,
            }}
          >
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{ flex: 1, gap: space.xxs }}
            >
              <AppText variant="label">{spec.title}</AppText>
              <AppText variant="caption" muted literal>
                {activeId === null
                  ? `${t("Theme default")} (${current})`
                  : current}
              </AppText>
            </View>
            <AppIcon name="chevron.right" color={theme.textMuted} size={16} />
          </MotionPressable>
        );
      })}

      <Modal
        animationType="fade"
        transparent
        visible={openSpec !== null}
        onRequestClose={close}
      >
        <SafeAreaView
          edges={["top", "right", "bottom", "left"]}
          style={{ flex: 1, justifyContent: "center", padding: space.lg }}
        >
          <Pressable
            accessibilityLabel={t("Close font and icon choices")}
            accessibilityRole="button"
            onPress={close}
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: theme.scrim,
            }}
          />
          {openSpec ? (
            <MotionView
              accessibilityViewIsModal
              importantForAccessibility="yes"
              variant="zoom"
              style={[
                {
                  width: "100%",
                  maxWidth: 520,
                  maxHeight: Math.max(320, height - 72),
                  alignSelf: "center",
                  padding: space.lg,
                  gap: space.md,
                  borderRadius: radius.card,
                  borderCurve: "continuous",
                },
                materialStyle(theme, "overlay"),
              ]}
            >
              <View
                style={{
                  minHeight: 44,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                }}
              >
                <AppText variant="headline" style={{ flex: 1 }}>
                  {openSpec.dialogTitle}
                </AppText>
                <IconButton
                  label="Close font and icon choices"
                  icon="xmark"
                  onPress={close}
                />
              </View>
              <ScrollView
                accessibilityLabel={t(openSpec.dialogTitle)}
                accessibilityRole="radiogroup"
                style={{ flexShrink: 1 }}
                contentContainerStyle={{ gap: space.xs }}
              >
                {optionsFor(openSpec).map((option) => {
                  const activeId = activeIdOf(openSpec);
                  const selected = option.id === activeId;
                  const previewId =
                    option.id ?? themeDefaultId(baseTheme, openSpec.kind);
                  return (
                    <MotionPressable
                      key={option.id ?? "theme-default"}
                      accessibilityRole="radio"
                      accessibilityLabel={option.label}
                      accessibilityState={{ selected, disabled: busy }}
                      disabled={busy}
                      onPress={() => {
                        void choose(openSpec.key, option.id);
                      }}
                      style={{
                        minHeight: 48,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.md,
                        paddingHorizontal: space.md,
                        paddingVertical: space.sm,
                        borderRadius: radius.control,
                        borderCurve: "continuous",
                        backgroundColor: selected
                          ? theme.accentContainer
                          : theme.surfaceMuted,
                      }}
                    >
                      <View
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        style={{ flex: 1, gap: space.xxs }}
                      >
                        <AppText
                          literal
                          variant="label"
                          style={
                            selected
                              ? { color: theme.onAccentContainer }
                              : undefined
                          }
                        >
                          {option.label}
                        </AppText>
                        {preview(openSpec, previewId)}
                      </View>
                      {selected ? (
                        <AppIcon
                          name="checkmark"
                          color={theme.onAccentContainer}
                          size={18}
                        />
                      ) : null}
                    </MotionPressable>
                  );
                })}
              </ScrollView>
            </MotionView>
          ) : null}
        </SafeAreaView>
      </Modal>
    </Card>
  );
}
