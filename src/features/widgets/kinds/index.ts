/**
 * The registry of widget kinds. Adding a kind is a new file in this directory that exports a
 * `WidgetKindDefinition`, plus its config type in `WidgetConfig` and its definition in `REGISTRY`
 * below; the compiler rejects a kind that is in one but not the other. The wire shape of its
 * snapshot payload (`WidgetSnapshotEntry`) and the native side (`WidgetKinds.kt`) change with it.
 */

import {
  budgetKind,
  type BudgetWidgetConfig,
} from "@/features/widgets/kinds/budget";
import {
  quickAddKind,
  type QuickAddWidgetConfig,
} from "@/features/widgets/kinds/quick-add";
import type {
  KindFields,
  WidgetKindDefinition,
  WidgetKindPayload,
} from "@/features/widgets/kinds/types";
import type { SnapshotInput } from "@/features/widgets/snapshot";

export type { BudgetWidgetConfig } from "@/features/widgets/kinds/budget";
export type { QuickAddWidgetConfig } from "@/features/widgets/kinds/quick-add";
export type { KindFields, WidgetKindDefinition, WidgetKindPayload };

export type WidgetConfig = QuickAddWidgetConfig | BudgetWidgetConfig;
export type WidgetKind = WidgetConfig["kind"];

type Registry = {
  [K in WidgetKind]: WidgetKindDefinition<Extract<WidgetConfig, { kind: K }>>;
};

const REGISTRY: Registry = {
  quickAdd: quickAddKind,
  budget: budgetKind,
};

export const WIDGET_KINDS = Object.keys(REGISTRY) as WidgetKind[];

export function isWidgetKind(value: unknown): value is WidgetKind {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(REGISTRY, value)
  );
}

export function widgetKind<K extends WidgetKind>(kind: K): Registry[K] {
  return REGISTRY[kind];
}

/** A placed widget of a kind this build knows. */
export interface PlacedWidgetRef {
  /** The Android appWidgetId; the key into the snapshot's `widgets` map. */
  id: number;
  kind: WidgetKind;
}

/** Drops placed widgets whose kind this build does not know (the native side may be newer). */
export function knownPlacedWidgets(
  placed: readonly { id: number; kind: string }[],
): PlacedWidgetRef[] {
  return placed.filter((widget): widget is PlacedWidgetRef =>
    isWidgetKind(widget.kind),
  );
}

/** The kind's own default fields on top of the shared appearance. */
export function kindDefaults<K extends WidgetKind>(
  kind: K,
): KindFields<Extract<WidgetConfig, { kind: K }>> {
  return widgetKind(kind).defaults;
}

// The registry is correlated with the union, which TypeScript cannot follow through a lookup by a
// union-typed key: these two are the only places that widen a definition to the whole union.
function definitionFor(kind: WidgetKind): WidgetKindDefinition<WidgetConfig> {
  return REGISTRY[kind] as WidgetKindDefinition<WidgetConfig>;
}

export function normalizeKindFields(
  kind: WidgetKind,
  raw: Record<string, unknown>,
): KindFields<WidgetConfig> {
  return definitionFor(kind).normalize(raw);
}

export function buildKindPayload(
  config: WidgetConfig,
  input: SnapshotInput,
  hideAmounts: boolean,
): WidgetKindPayload {
  return definitionFor(config.kind).build(config, input, hideAmounts);
}
