import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState, Platform, ScrollView, View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { ColorSwatch } from "@/components/ui/color-swatch";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { QashySwitch } from "@/components/ui/qashy-switch";
import {
  SegmentedControl,
  type SegmentOption,
} from "@/components/ui/segmented-control";
import { TextButton } from "@/components/ui/text-button";
import {
  readWidgetSettings,
  subscribeWidgetSettings,
  updateWidgetSettings,
} from "@/data/device-local/widget-settings-store";
import {
  knownPlacedWidgets,
  type PlacedWidgetRef,
  type WidgetKind,
} from "@/features/widgets/kinds";
import {
  configFor,
  normalizeWidgetConfig,
  type WidgetAppearance,
  type WidgetConfig,
  type WidgetMode,
  type WidgetSettings,
  type WidgetTheme,
} from "@/features/widgets/settings";
import {
  WidgetKindSection,
  widgetKindTitle,
} from "@/features/more/widget-kind-sections";
import { WidgetTransparencySlider } from "@/features/more/widget-transparency-slider";
import {
  opacityFromTransparency,
  transparencyFromOpacity,
} from "@/features/more/widget-transparency";
import { useLocalization } from "@/localization/localization";
import { useQashyTheme } from "@/theme/theme";
import { ACCENT_PRESETS } from "@/theme/tokens";
import { errorMessage, showError } from "@/utils/confirm";
import * as QashyWidgets from "../../../modules/qashy-widgets";

const THEME_OPTIONS: SegmentOption<WidgetTheme>[] = [
  { value: "qashy", label: "Qashy" },
  { value: "materialYou", label: "Material You" },
];
const MODE_OPTIONS: SegmentOption<WidgetMode>[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
const BACKGROUND_OPTIONS: SegmentOption<WidgetConfig["background"]>[] = [
  { value: "surface", label: "Surface" },
  { value: "accent", label: "Accent" },
  { value: "custom", label: "Custom" },
];
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
/** Reading-width cap of the settings column, shared with the other More screens. */
const CONTENT_MAX_WIDTH = 720;

/** Material You wallpaper colors arrive with Android 12 (API 31). */
const MATERIAL_YOU_UNSUPPORTED =
  process.env.EXPO_OS === "android" && Number(Platform.Version) < 31;

/**
 * The fields one control changes; `kind` never changes. A kind's own fields are typed by its
 * section (`KindSectionProps`) and validated by `normalizeWidgetConfig` when saved.
 */
type WidgetPatch = Partial<WidgetAppearance> & Record<string, unknown>;

/** The placed widgets and the stored settings, kept current for the screen's lifetime. */
function useWidgetsState() {
  const [placed, setPlaced] = useState<PlacedWidgetRef[] | null>(null);
  const [settings, setSettings] = useState<WidgetSettings | null>(null);
  // True while the stored settings could not be read and nothing is on screen from an earlier read.
  // Showing defaults then would draw "Hide amounts" as off whatever is stored, and the next edit
  // would be built from them.
  const [settingsFailed, setSettingsFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  useEffect(() => {
    let live = true;
    let placedRequest = 0;
    const loadPlaced = () => {
      const request = ++placedRequest;
      QashyWidgets.getPlacedWidgets().then(
        (all) => {
          const next = knownPlacedWidgets(all);
          if (live && request === placedRequest)
            setPlaced([...next].sort((a, b) => a.id - b.id));
        },
        () => {
          // The list is a convenience: a failure reads as "none placed", not a stuck screen.
          if (live && request === placedRequest) setPlaced([]);
        },
      );
    };
    const loadSettings = () => {
      readWidgetSettings().then(
        (next) => {
          if (!live) return;
          setSettings(next);
          setSettingsFailed(false);
        },
        () => {
          if (live) setSettingsFailed(true);
        },
      );
    };
    loadPlaced();
    loadSettings();
    const unsubscribe = subscribeWidgetSettings(loadSettings);
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      loadPlaced();
      loadSettings();
    });
    return () => {
      live = false;
      unsubscribe();
      appState.remove();
    };
  }, [attempt]);

  return {
    placed,
    settings,
    setSettings,
    settingsUnavailable: settingsFailed && settings === null,
    retry,
  };
}

export function WidgetsScreen() {
  const theme = useQashyTheme();
  const { space } = theme;
  const { t } = useLocalization();
  const { widgetId: widgetIdParam } = useLocalSearchParams<{
    widgetId?: string | string[];
  }>();
  const requestedId = Number(
    Array.isArray(widgetIdParam) ? widgetIdParam[0] : widgetIdParam,
  );
  // "Show all" belongs to the widget a deep link focused: a link to another widget focuses it.
  const requestKey = String(requestedId);
  const [showAllFor, setShowAllFor] = useState<string | null>(null);
  const showAll = showAllFor === requestKey;
  const available = QashyWidgets.isAvailable();
  const { placed, settings, setSettings, settingsUnavailable, retry } =
    useWidgetsState();

  const apply = useCallback(
    async (
      update: (current: WidgetSettings) => WidgetSettings | null,
    ): Promise<boolean> => {
      try {
        setSettings(await updateWidgetSettings(update));
        return true;
      } catch (reason) {
        showError(
          "Couldn’t apply this setting",
          errorMessage(reason, "Try again."),
        );
        return false;
      }
    },
    [setSettings],
  );

  const stored = settings ?? { hideAmounts: false, widgets: {} };
  const focused =
    !showAll && placed?.some((widget) => widget.id === requestedId)
      ? placed.filter((widget) => widget.id === requestedId)
      : null;
  const visible = focused ?? placed ?? [];
  // Numbered by position among all placed widgets of the kind, so "Budget widget 2" keeps its
  // number while only that one is shown.
  const ordinals = new Map<number, number>();
  const totals = new Map<WidgetKind, number>();
  for (const widget of placed ?? []) {
    const count = (totals.get(widget.kind) ?? 0) + 1;
    totals.set(widget.kind, count);
    ordinals.set(widget.id, count);
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{
        padding: space.lg,
        paddingBottom: space.xxxl + space.sm,
        gap: space.lg,
        width: "100%",
        maxWidth: CONTENT_MAX_WIDTH,
        alignSelf: "center",
      }}
    >
      {!available ? (
        <Card style={{ gap: space.sm }}>
          <AppText variant="headline">Widgets are an Android feature</AppText>
          <AppText muted>
            Home screen widgets are available in the Android app only.
          </AppText>
        </Card>
      ) : (
        <>
          {settingsUnavailable ? (
            <Card style={{ gap: space.sm }}>
              <AppText variant="headline" accessibilityRole="alert">
                Couldn’t load widget settings
              </AppText>
              <AppText muted>
                Your widget settings couldn’t be read, so they aren’t shown
                here. Nothing was changed.
              </AppText>
              <TextButton
                title="Try again"
                icon="arrow.clockwise"
                onPress={retry}
              />
            </Card>
          ) : null}
          {/* Not drawn until the stored value is read, so it never flashes the wrong state. */}
          {settings !== null ? (
            <Card style={{ gap: space.lg }}>
              <View
                style={{
                  minHeight: 48,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: space.md,
                }}
              >
                <View style={{ flex: 1, gap: space.xxs }}>
                  <AppText variant="label">Hide amounts</AppText>
                  <AppText variant="caption" muted>
                    Amounts are hidden on all widgets.
                  </AppText>
                </View>
                <QashySwitch
                  accessibilityLabel={t("Hide amounts")}
                  value={stored.hideAmounts}
                  onValueChange={(hideAmounts) => {
                    void apply((current) =>
                      current.hideAmounts === hideAmounts
                        ? null
                        : { ...current, hideAmounts },
                    );
                  }}
                />
              </View>
            </Card>
          ) : null}

          {placed !== null && placed.length === 0 ? (
            <Card>
              <EmptyState
                compact
                icon="ion:apps-outline"
                title="No widgets yet"
                body="Press and hold an empty spot on your home screen, choose Widgets, then pick Qashy to add one."
              />
            </Card>
          ) : null}

          {focused && (placed?.length ?? 0) > 1 ? (
            <TextButton
              title="Show all widgets"
              icon="ion:apps-outline"
              onPress={() => setShowAllFor(requestKey)}
            />
          ) : null}

          {settings !== null
            ? visible.map((widget) => (
                <WidgetCard
                  key={widget.id}
                  id={widget.id}
                  kind={widget.kind}
                  ordinal={
                    (totals.get(widget.kind) ?? 0) > 1
                      ? (ordinals.get(widget.id) ?? null)
                      : null
                  }
                  config={configFor(stored, widget.id, widget.kind)}
                  apply={apply}
                />
              ))
            : null}
        </>
      )}
    </ScrollView>
  );
}

/** Resolves true when the change was saved (or needed no save), false when the write failed. */
type Apply = (
  update: (current: WidgetSettings) => WidgetSettings | null,
) => Promise<boolean>;

/** Replaces the one widget's config, validated, leaving every other widget's untouched. */
function patchWidget(id: number, kind: WidgetKind, patch: WidgetPatch) {
  return (current: WidgetSettings): WidgetSettings | null => {
    const base = configFor(current, id, kind);
    const next = normalizeWidgetConfig({ ...base, ...patch });
    if (!next) return null;
    if (
      current.widgets[String(id)] &&
      JSON.stringify(current.widgets[String(id)]) === JSON.stringify(next)
    )
      return null;
    return { ...current, widgets: { ...current.widgets, [String(id)]: next } };
  };
}

function WidgetCard({
  id,
  kind,
  ordinal,
  config,
  apply,
}: {
  id: number;
  kind: WidgetKind;
  /** Set only when several widgets of this kind are placed. */
  ordinal: number | null;
  config: WidgetConfig;
  apply: Apply;
}) {
  const theme = useQashyTheme();
  const { space } = theme;
  const { t } = useLocalization();
  const change = (patch: WidgetPatch) => apply(patchWidget(id, kind, patch));

  const [hex, setHex] = useState(config.customColor ?? "");
  // Follows a color chosen elsewhere (a preset swatch, another editor of the same settings).
  const [seenColor, setSeenColor] = useState(config.customColor);
  if (config.customColor !== seenColor) {
    setSeenColor(config.customColor);
    if (config.customColor !== null) setHex(config.customColor);
  }
  const hexValid = HEX_COLOR.test(hex);

  const title = `${t(widgetKindTitle(kind))}${ordinal === null ? "" : ` ${ordinal}`}`;
  const transparency = transparencyFromOpacity(config.opacity);

  return (
    <Card style={{ gap: space.lg }}>
      <AppText literal variant="headline" accessibilityRole="header">
        {title}
      </AppText>

      <View style={{ gap: space.sm }}>
        <AppText variant="label">Theme</AppText>
        <SegmentedControl
          label="Theme"
          options={THEME_OPTIONS}
          value={config.theme}
          onChange={(value) => change({ theme: value })}
        />
        {MATERIAL_YOU_UNSUPPORTED ? (
          <AppText variant="caption" muted>
            Material You colors need Android 12 or later. On this device the
            widget uses Qashy colors.
          </AppText>
        ) : null}
      </View>

      <View style={{ gap: space.sm }}>
        <AppText variant="label">Mode</AppText>
        <SegmentedControl
          label="Mode"
          options={MODE_OPTIONS}
          value={config.mode}
          onChange={(value) => change({ mode: value })}
        />
      </View>

      <View style={{ gap: space.sm }}>
        <AppText variant="label">Background</AppText>
        <SegmentedControl
          label="Background"
          options={BACKGROUND_OPTIONS}
          value={config.background}
          onChange={(background) =>
            change(
              background === "custom" && config.customColor === null
                ? { background, customColor: ACCENT_PRESETS[0] }
                : { background },
            )
          }
        />
        <AppText variant="caption" muted>
          Surface follows the theme, Accent tints it with the accent color, and
          Custom uses a color you choose.
        </AppText>
      </View>

      {config.background === "custom" ? (
        <View style={{ gap: space.md }}>
          <Card variant="inset">
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={t("Custom color")}
              style={{ flexDirection: "row", gap: space.md, flexWrap: "wrap" }}
            >
              {ACCENT_PRESETS.map((color) => (
                <ColorSwatch
                  key={color}
                  color={color}
                  selected={config.customColor === color}
                  onPress={() => {
                    setHex(color);
                    change({ background: "custom", customColor: color });
                  }}
                />
              ))}
            </View>
          </Card>
          <FormField
            label="Custom color"
            value={hex}
            onChangeText={(value) => {
              setHex(value);
              if (HEX_COLOR.test(value))
                change({
                  background: "custom",
                  customColor: value.toUpperCase(),
                });
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={7}
            error={
              hex.length > 0 && !hexValid
                ? "Use a six-digit hex color such as #5070FF."
                : undefined
            }
          />
        </View>
      ) : null}

      <View style={{ gap: space.sm }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: space.md,
          }}
        >
          <AppText variant="label">Transparency</AppText>
          <AppText literal variant="label" muted>
            {`${transparency}%`}
          </AppText>
        </View>
        <WidgetTransparencySlider
          label="Transparency"
          value={transparency}
          onCommit={(next) =>
            change({ opacity: opacityFromTransparency(next) })
          }
        />
      </View>

      <View
        style={{
          minHeight: 48,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space.md,
        }}
      >
        <View style={{ flex: 1, gap: space.xxs }}>
          <AppText variant="label">Frosted look</AppText>
          <AppText variant="caption" muted>
            A soft, frosted look. Widgets can’t blur what is behind them, so
            this is an approximation.
          </AppText>
        </View>
        <QashySwitch
          accessibilityLabel={t("Frosted look")}
          value={config.frosted}
          onValueChange={(frosted) => {
            void change({ frosted });
          }}
        />
      </View>

      <WidgetKindSection config={config} change={change} />
    </Card>
  );
}
