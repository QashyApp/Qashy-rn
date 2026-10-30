import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View, useColorScheme } from "react-native";

import { AnimatedMoney } from "@/components/finance/animated-money";
import { useNavBarStyleSheet } from "@/components/navigation/nav-bar-style-sheet-context";
import { ActionButton } from "@/components/ui/action-button";
import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { ColorSwatch } from "@/components/ui/color-swatch";
import { FormField } from "@/components/ui/form-field";
import { MotionView } from "@/components/ui/motion";
import { ProgressBar } from "@/components/ui/progress-bar";
import {
  SegmentedControl,
  type SegmentOption,
} from "@/components/ui/segmented-control";
import { effectiveAccentMode, ThemePicker } from "@/components/ui/theme-picker";
import { AppearanceOverridesCard } from "@/features/more/appearance-overrides-card";
import {
  saveThemeFile,
  pickThemeFileText,
} from "@/features/more/custom-theme-files";
import type { AccentSource, AppSettings, ThemeMode } from "@/domain/models";
import { useLocalization } from "@/localization/localization";
import {
  useFinanceRepository,
  useFinanceSettings,
} from "@/providers/finance-provider";
import {
  evaluateThemeImport,
  exportCustomThemeJson,
  summarizeImportErrors,
  themeExportFilename,
} from "@/theme/custom/theme-import";
import { useCustomThemes } from "@/theme/custom/use-custom-themes";
import { previewAccentTokens, useQashyTheme } from "@/theme/theme";
import { getTheme, listAvailableThemes } from "@/theme/themes/registry";
import { ACCENT_PRESETS, mixHex } from "@/theme/tokens";
import { confirmDestructive, errorMessage, showError } from "@/utils/confirm";
import { hapticSuccess } from "@/services/haptics";

const THEME_MODE_ICONS: Record<ThemeMode, string> = {
  system: "circle.lefthalf.filled",
  light: "sun.max",
  dark: "moon",
};
const THEME_MODE_OPTIONS: SegmentOption<ThemeMode>[] = [
  { value: "system", label: "System", icon: THEME_MODE_ICONS.system },
  { value: "light", label: "Light", icon: THEME_MODE_ICONS.light },
  { value: "dark", label: "Dark", icon: THEME_MODE_ICONS.dark },
];
/** A representative amount for the live preview hero — never a real balance. */
const PREVIEW_NET_WORTH_MINOR = 1284350;

/** The settings this form owns; a write to any other setting must not disturb the form or its save. */
type OwnedFields = Pick<
  AppSettings,
  "themeId" | "themeMode" | "accentSource" | "accentHex"
>;
const ownedFields = (settings: OwnedFields): OwnedFields => ({
  themeId: settings.themeId,
  themeMode: settings.themeMode,
  accentSource: settings.accentSource,
  accentHex: settings.accentHex,
});
const sameOwnedFields = (a: OwnedFields, b: OwnedFields) =>
  a.themeId === b.themeId &&
  a.themeMode === b.themeMode &&
  a.accentSource === b.accentSource &&
  a.accentHex.toUpperCase() === b.accentHex.toUpperCase();

export function AppearanceScreen() {
  const repository = useFinanceRepository();
  const settings = useFinanceSettings();
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const { t, locale } = useLocalization();
  const systemScheme = useColorScheme();
  const navBarSheet = useNavBarStyleSheet();
  const [expectedRevision, setExpectedRevision] = useState(settings.revision);
  const [themeId, setThemeId] = useState(settings.themeId);
  const [mode, setMode] = useState<ThemeMode>(settings.themeMode);
  const [source, setSource] = useState<AccentSource>(settings.accentSource);
  const [hex, setHex] = useState(settings.accentHex);
  // The stored values the form and `expectedRevision` were last in step with.
  const inStep = useRef(ownedFields(settings));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const {
    themes: customThemes,
    files: customFiles,
    save: saveCustomTheme,
    remove: removeCustomTheme,
  } = useCustomThemes();
  const validHex = /^#[0-9A-Fa-f]{6}$/.test(hex);
  // Other writes to the settings row (a font or icon override, a sync pass) bump its revision, which
  // would make every later save fail as "changed in another window". Only a change to the fields this
  // form owns can conflict with its edits, so: if they did not move, follow the revision; if they moved
  // and the form has no unsaved edits, adopt them; if they moved under unsaved edits, keep the stale
  // revision so the save is refused instead of overwriting them.
  useEffect(() => {
    const live = ownedFields(settings);
    if (sameOwnedFields(live, inStep.current)) {
      setExpectedRevision(settings.revision);
      return;
    }
    const form = {
      themeId,
      themeMode: mode,
      accentSource: source,
      accentHex: hex,
    };
    if (!sameOwnedFields(form, inStep.current)) return;
    inStep.current = live;
    setThemeId(live.themeId);
    setMode(live.themeMode);
    setSource(live.accentSource);
    setHex(live.accentHex);
    setExpectedRevision(settings.revision);
  }, [settings, themeId, mode, source, hex]);
  const previewMode =
    mode === "system" ? (systemScheme === "dark" ? "dark" : "light") : mode;
  const selectedTheme = getTheme(themeId, customThemes);
  const customIds = customThemes.map((item) => item.id);
  const selectedCustomFile = customFiles.find((file) => file.id === themeId);
  const accentMode = effectiveAccentMode(selectedTheme);
  const userAccent = accentMode === "user";
  // A theme that owns its accent ('fixed', or 'system' off Android) ignores the accent controls, so the
  // preview shows what the provider will actually apply.
  const preview = userAccent
    ? previewAccentTokens(
        source,
        validHex ? hex : theme.staticAccent,
        previewMode === "dark",
        selectedTheme,
      )
    : previewAccentTokens(
        accentMode === "system" ? "system" : "preset",
        selectedTheme.accent.default,
        previewMode === "dark",
        selectedTheme,
      );
  // Android's Material You accent is a dynamic platform color, so it cannot be
  // blended in JS the way a hex accent can. Fade the secondary lines instead.
  const dynamicAccent =
    typeof preview.accent !== "string" || typeof preview.onAccent !== "string";
  const previewMuted = dynamicAccent
    ? preview.onAccent
    : mixHex(preview.onAccent as string, preview.accent as string, 0.25);
  const previewMutedStyle = {
    color: previewMuted,
    opacity: dynamicAccent ? 0.75 : 1,
  };
  const customError =
    userAccent && source === "custom" && !validHex
      ? "Use a six-digit hex color such as #5070FF."
      : undefined;
  // Choosing a theme only changes the pending selection (the live preview and accent controls
  // follow it); it is written, with the mode and accent, when "Save appearance" is pressed.
  const changeTheme = (id: string) => {
    if (id === themeId) return;
    setThemeId(id);
    setSaved(false);
  };
  // Import reads a file the user picked, validates the whole theme, and changes nothing unless it
  // is valid (and, when it would replace a stored theme, confirmed). Theme contents are never logged.
  const importTheme = async () => {
    if (importing) return;
    setImporting(true);
    setNotice(null);
    try {
      const text = await pickThemeFileText();
      if (text === null) return;
      const evaluation = evaluateThemeImport(text, customFiles);
      if (!evaluation.ok) {
        showError(
          "Couldn’t import theme",
          summarizeImportErrors(evaluation.errors, t),
        );
        return;
      }
      if (evaluation.replaces) {
        const confirmed = await confirmDestructive({
          title: "Replace this theme?",
          message:
            "A custom theme with the same ID is already on this device. Importing replaces it.",
          confirmLabel: "Replace",
        });
        if (!confirmed) return;
      }
      await saveCustomTheme(evaluation.file);
      setNotice(
        [
          t("Theme imported."),
          ...evaluation.warnings.map((line) => t(line)),
        ].join("\n"),
      );
      // Importing stores the file on this device but only selects it; like any other theme choice it
      // applies on "Save appearance". (A replaced theme that is already applied does update live.)
      changeTheme(evaluation.file.id);
      // A confirmed replace has already buzzed a warning.
      if (!evaluation.replaces) hapticSuccess();
    } catch (reason) {
      showError("Couldn’t import theme", errorMessage(reason, "Try again."));
    } finally {
      setImporting(false);
    }
  };
  const exportTheme = async () => {
    if (!selectedCustomFile) return;
    try {
      await saveThemeFile(
        themeExportFilename(selectedCustomFile),
        exportCustomThemeJson(selectedCustomFile),
        t("Export theme"),
      );
    } catch (reason) {
      showError("Couldn’t export theme", errorMessage(reason, "Try again."));
    }
  };
  const deleteTheme = async (id: string) => {
    // Deleting the applied theme drops back to Classic; say so before it happens.
    const deletingApplied = settings.themeId === id;
    const confirmed = await confirmDestructive({
      title: "Delete this theme?",
      message: deletingApplied
        ? [
            "The theme is removed from this device. Export it first to keep a copy.",
            "Classic will be applied.",
          ]
        : "The theme is removed from this device. Export it first to keep a copy.",
    });
    if (!confirmed) return;
    try {
      // Deleting is immediate, so an applied theme must be left first: settings never point at a
      // theme that no longer exists. A theme that is only the pending selection needs no write.
      if (settings.themeId === id) {
        const updated = await repository.updateSettings({ themeId: "classic" });
        setExpectedRevision(updated.revision);
        inStep.current = { ...inStep.current, themeId: "classic" };
        if (themeId === id) setThemeId("classic");
      } else if (themeId === id) {
        setThemeId(settings.themeId);
      }
      await removeCustomTheme(id);
      setNotice(null);
    } catch (reason) {
      showError("Couldn’t delete theme", errorMessage(reason, "Try again."));
    }
  };
  const save = async () => {
    if (saving || customError) return;
    setSaving(true);
    setSaved(false);
    try {
      const written = {
        themeId,
        themeMode: mode,
        accentSource: source,
        accentHex: validHex ? hex.toUpperCase() : settings.accentHex,
      };
      const updated = await repository.updateSettings(
        written,
        expectedRevision,
      );
      setExpectedRevision(updated.revision);
      inStep.current = written;
      setSaved(true);
      hapticSuccess();
    } catch (reason) {
      showError("Couldn’t save appearance", errorMessage(reason, "Try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{
        padding: space.lg,
        paddingBottom: space.xxxl + space.sm,
        gap: space.lg,
        width: "100%",
        maxWidth: 720,
        alignSelf: "center",
      }}
    >
      {/* Live preview: a mini hero built from the pending (unsaved) mode/accent, not the applied
          theme. `ActionButton` and `ProgressBar` always render off the applied `useQashyTheme()`
          context, so the button below is a hand-styled stand-in that mirrors its look using
          `preview.accent`/`preview.onAccent` directly — it is not interactive and never becomes
          real chrome, it exists purely so a color choice reads instantly, before Save. */}
      <MotionView
        key={`${themeId}-${mode}-${source}-${hex}`}
        variant="fade"
        exit
        animateLayout
      >
        {/* A plain View, not `Card`: Card's raised material paints a neutral gradient over any
            backgroundColor, which hid the accent (and left on-accent text white on white). */}
        <View
          style={{
            backgroundColor: preview.accent,
            gap: space.lg,
            padding: space.lg,
            borderRadius: radius.card,
            borderCurve: "continuous",
            boxShadow: theme.shadowCard,
          }}
        >
          <View style={{ gap: space.xxs }}>
            <AppText variant="overline" style={previewMutedStyle}>
              Preview · Net worth
            </AppText>
            <AnimatedMoney
              minor={PREVIEW_NET_WORTH_MINOR}
              currency={settings.baseCurrency}
              locale={locale}
              variant="display"
              style={{ color: preview.onAccent }}
            />
          </View>
          <ProgressBar
            value={0.64}
            label={t("Preview progress")}
            color={preview.onAccent}
          />
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              alignSelf: "flex-start",
              minHeight: 40,
              paddingHorizontal: space.lg,
              borderRadius: radius.pill,
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              backgroundColor: preview.onAccent,
            }}
          >
            <AppIcon name="checkmark" color={preview.accent} size={16} />
            <AppText
              selectable={false}
              variant="label"
              style={{ color: preview.accent }}
            >
              Looks good
            </AppText>
          </View>
        </View>
      </MotionView>
      <MotionView>
        <Card style={{ gap: space.lg }}>
          <AppText variant="headline">Appearance</AppText>
          <SegmentedControl
            label="Appearance"
            options={THEME_MODE_OPTIONS}
            value={mode}
            onChange={(value) => {
              setMode(value);
              setSaved(false);
            }}
          />
        </Card>
      </MotionView>
      <MotionView>
        <Card style={{ gap: space.lg }}>
          <AppText variant="headline">Theme</AppText>
          <AppText muted>
            Choose the overall look. Every theme has a light and a dark version.
          </AppText>
          <ThemePicker
            value={themeId}
            onChange={(id) => {
              changeTheme(id);
            }}
            themes={listAvailableThemes(customThemes)}
            customIds={customIds}
            onDelete={(id) => {
              void deleteTheme(id);
            }}
            dark={previewMode === "dark"}
          />
        </Card>
      </MotionView>
      <MotionView>
        <AppearanceOverridesCard />
      </MotionView>
      <MotionView>
        <Card style={{ gap: space.lg }}>
          <AppText variant="headline">Custom themes</AppText>
          <AppText muted>
            Import a theme file (.json) or export the selected custom theme.
            Custom themes stay on this device.
          </AppText>
          {notice ? (
            <AppText literal accessibilityRole="alert">
              {notice}
            </AppText>
          ) : null}
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}
          >
            <ActionButton
              title="Import theme"
              icon="square.and.arrow.down"
              variant="secondary"
              disabled={importing}
              busy={importing}
              onPress={importTheme}
            />
            <ActionButton
              title="Export theme"
              icon="square.and.arrow.up"
              variant="secondary"
              disabled={!selectedCustomFile}
              onPress={exportTheme}
            />
          </View>
          {!selectedCustomFile ? (
            <AppText variant="caption" muted>
              Select a custom theme to export it.
            </AppText>
          ) : null}
        </Card>
      </MotionView>
      {navBarSheet.available ? (
        <MotionView>
          <Card style={{ gap: space.lg }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Navigation bar style")}
              accessibilityHint={t(
                settings.navBarStyle === "floating" ? "Floating" : "Native",
              )}
              onPress={navBarSheet.open}
              style={{
                minHeight: 48,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: space.md,
              }}
            >
              <View style={{ flex: 1, gap: space.xxs }}>
                <AppText variant="label">Navigation bar style</AppText>
                <AppText variant="caption" muted>
                  {settings.navBarStyle === "floating" ? "Floating" : "Native"}
                </AppText>
              </View>
              <AppIcon
                name="chevron.right"
                color={theme.textMuted}
                size={16}
                mirrorInRtl
              />
            </Pressable>
          </Card>
        </MotionView>
      ) : null}
      {!userAccent ? (
        <MotionView>
          <Card style={{ gap: space.sm }}>
            <AppText variant="headline">Accent source</AppText>
            <AppText muted>
              {accentMode === "system"
                ? "This theme uses your device’s accent color."
                : "This theme sets its own accent color."}
            </AppText>
          </Card>
        </MotionView>
      ) : (
        <MotionView>
          <Card style={{ gap: space.lg }}>
            <AppText variant="headline">Accent source</AppText>
            <View
              accessibilityLabel={t("Accent source")}
              accessibilityRole="radiogroup"
              style={{ gap: space.md }}
            >
              <ChoiceChip
                label={
                  process.env.EXPO_OS === "android"
                    ? "Material You wallpaper"
                    : "Qashy default"
                }
                selected={source === "system"}
                onPress={() => {
                  setSource("system");
                  setSaved(false);
                }}
                icon="paintbrush"
              />
              <AppText muted>
                {process.env.EXPO_OS === "android"
                  ? "Android 12 and later derive this from your wallpaper. Older versions use Qashy’s default palette."
                  : "Uses Qashy’s indigo accent on neutral surfaces."}
              </AppText>
              <AppText variant="label">Curated accents</AppText>
              {/* A raised well around the swatches, so the selected one (pressed-in via its own
                checkmark + border) reads as sitting inside a carved tray rather than floating
                loose on the card. `ColorSwatch` itself is untouched. */}
              <Card variant="inset">
                <View
                  style={{
                    flexDirection: "row",
                    gap: space.md,
                    flexWrap: "wrap",
                  }}
                >
                  {ACCENT_PRESETS.map((color) => (
                    <ColorSwatch
                      key={color}
                      color={color}
                      selected={
                        source === "preset" && hex.toUpperCase() === color
                      }
                      onPress={() => {
                        setSource("preset");
                        setHex(color);
                        setSaved(false);
                      }}
                    />
                  ))}
                </View>
              </Card>
            </View>
            <FormField
              label="Custom accent"
              value={hex}
              onChangeText={(value) => {
                setSource("custom");
                setHex(value);
                setSaved(false);
              }}
              autoCapitalize="characters"
              maxLength={7}
              error={customError}
              hint="Only the accent changes. Qashy gently adjusts unsafe colors to preserve contrast."
            />
          </Card>
        </MotionView>
      )}
      <MotionView>
        <ActionButton
          title={saving ? "Saving…" : saved ? "Saved" : "Save appearance"}
          icon="checkmark"
          size="large"
          disabled={saving || Boolean(customError)}
          busy={saving}
          onPress={save}
        />
      </MotionView>
    </ScrollView>
  );
}
