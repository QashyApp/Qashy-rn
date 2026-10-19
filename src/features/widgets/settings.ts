/**
 * Home-screen widget settings: types, defaults and fail-safe validation.
 *
 * Device-local by construction (they live in `sync_meta`, see `data/widget-settings-store.ts`),
 * never in `AppSettings`, which replicates to peers. Pure: no I/O, no clock, no randomness.
 *
 * Validation never throws. Any invalid field falls back to its default, a config whose `kind`
 * is unknown is dropped, and a whole document that does not parse is the default settings.
 */

export type WidgetTheme = "qashy" | "materialYou";
export type WidgetMode = "system" | "light" | "dark";
export type WidgetBackground = "surface" | "accent" | "custom";
export type GraphMonths = 3 | 6 | 12;

export interface WidgetAppearance {
  theme: WidgetTheme;
  mode: WidgetMode;
  background: WidgetBackground;
  /** `#RRGGBB`; only read when `background` is `custom`. */
  customColor: string | null;
  /** Integer percent, 0 (transparent) to 100 (opaque). */
  opacity: number;
  frosted: boolean;
}

export interface TransactionsWidgetConfig extends WidgetAppearance {
  kind: "transactions";
  /** `null` means every account. */
  accountId: string | null;
}

export interface SummaryWidgetConfig extends WidgetAppearance {
  kind: "summary";
  graphMonths: GraphMonths;
}

export type WidgetConfig = TransactionsWidgetConfig | SummaryWidgetConfig;

export interface WidgetSettings {
  /** Masks every amount, and the net-worth line, on every widget. */
  hideAmounts: boolean;
  /** Keyed by the Android appWidgetId, as a string. */
  widgets: Record<string, WidgetConfig>;
}

/** Far more than anyone places; a hand-edited document cannot grow the stored value without bound. */
export const MAX_WIDGET_CONFIGS = 200;

export const DEFAULT_APPEARANCE: Readonly<WidgetAppearance> = {
  theme: "qashy",
  mode: "system",
  background: "surface",
  customColor: null,
  opacity: 100,
  frosted: false,
};

export const DEFAULT_WIDGET_SETTINGS: WidgetSettings = {
  hideAmounts: false,
  widgets: {},
};

const THEMES: readonly WidgetTheme[] = ["qashy", "materialYou"];
const MODES: readonly WidgetMode[] = ["system", "light", "dark"];
const BACKGROUNDS: readonly WidgetBackground[] = [
  "surface",
  "accent",
  "custom",
];
const GRAPH_MONTHS: readonly GraphMonths[] = [3, 6, 12];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function defaultWidgetConfig(kind: "transactions"): TransactionsWidgetConfig;
export function defaultWidgetConfig(kind: "summary"): SummaryWidgetConfig;
export function defaultWidgetConfig(kind: WidgetConfig["kind"]): WidgetConfig;
export function defaultWidgetConfig(kind: WidgetConfig["kind"]): WidgetConfig {
  return kind === "transactions"
    ? { kind, ...DEFAULT_APPEARANCE, accountId: null }
    : { kind, ...DEFAULT_APPEARANCE, graphMonths: 12 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string | number>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeAppearance(raw: Record<string, unknown>): WidgetAppearance {
  const opacity = raw.opacity;
  return {
    theme: oneOf(raw.theme, THEMES, DEFAULT_APPEARANCE.theme),
    mode: oneOf(raw.mode, MODES, DEFAULT_APPEARANCE.mode),
    background: oneOf(raw.background, BACKGROUNDS, DEFAULT_APPEARANCE.background),
    customColor:
      typeof raw.customColor === "string" && HEX_COLOR.test(raw.customColor)
        ? raw.customColor.toUpperCase()
        : null,
    opacity:
      typeof opacity === "number" &&
      Number.isInteger(opacity) &&
      opacity >= 0 &&
      opacity <= 100
        ? opacity
        : DEFAULT_APPEARANCE.opacity,
    frosted:
      typeof raw.frosted === "boolean"
        ? raw.frosted
        : DEFAULT_APPEARANCE.frosted,
  };
}

/** A valid config for `raw`, or `null` when its `kind` is not one this build knows. */
export function normalizeWidgetConfig(raw: unknown): WidgetConfig | null {
  if (!isRecord(raw)) return null;
  const appearance = normalizeAppearance(raw);
  if (raw.kind === "transactions") {
    return {
      kind: "transactions",
      ...appearance,
      accountId:
        typeof raw.accountId === "string" && raw.accountId.length > 0
          ? raw.accountId
          : null,
    };
  }
  if (raw.kind === "summary") {
    return {
      kind: "summary",
      ...appearance,
      graphMonths: oneOf(raw.graphMonths, GRAPH_MONTHS, 12),
    };
  }
  return null;
}

/** Turns whatever was stored (or passed) into valid settings. Never throws. */
export function normalizeWidgetSettings(raw: unknown): WidgetSettings {
  if (!isRecord(raw)) return { hideAmounts: false, widgets: {} };
  const widgets: Record<string, WidgetConfig> = {};
  if (isRecord(raw.widgets)) {
    let count = 0;
    for (const [id, value] of Object.entries(raw.widgets)) {
      if (count >= MAX_WIDGET_CONFIGS) break;
      if (!/^\d{1,12}$/.test(id)) continue;
      const config = normalizeWidgetConfig(value);
      if (!config) continue;
      widgets[id] = config;
      count += 1;
    }
  }
  return { hideAmounts: raw.hideAmounts === true, widgets };
}

/** Parses stored JSON; unparseable text is the default settings. Never throws. */
export function parseWidgetSettings(raw: string | undefined): WidgetSettings {
  if (raw === undefined) return { hideAmounts: false, widgets: {} };
  try {
    return normalizeWidgetSettings(JSON.parse(raw));
  } catch {
    return { hideAmounts: false, widgets: {} };
  }
}

export function serializeWidgetSettings(settings: WidgetSettings): string {
  return JSON.stringify(normalizeWidgetSettings(settings));
}

/** The config for a widget id, or the default for `kind` when none is stored yet. */
export function configFor(
  settings: WidgetSettings,
  id: number | string,
  kind: WidgetConfig["kind"],
): WidgetConfig {
  const stored = settings.widgets[String(id)];
  return stored && stored.kind === kind ? stored : defaultWidgetConfig(kind);
}
