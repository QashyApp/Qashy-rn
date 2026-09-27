/**
 * The pure layout model behind the customizable Overview screen.
 *
 * The fixed header (net worth, income, spent, net flow) is not a card and never appears here.
 * Everything below it is an ordered list of cards the user can reorder, remove, add back,
 * resize, and configure — this module is that list plus the structural rules a card must obey
 * (which sizes it accepts, whether more than one instance can exist). Titles, icons, and the
 * components that actually render a widget belong to the UI layer, not here.
 *
 * Deliberately dependency-free of storage, React, and time: `overviewLayoutReducer` is a pure
 * reducer (no `Date.now`, no `Math.random`, no id generation — every action already carries
 * whatever identity it needs), and `normalizeOverviewLayout` is a tolerant parser that turns
 * anything — `undefined`, a stale shape, a hand-edited blob — into a layout this module is
 * willing to render, defaulting to `DEFAULT_OVERVIEW_LAYOUT` rather than throwing.
 */

import { z } from '@/utils/zod';

export const OVERVIEW_WIDGET_TYPES = [
  'insight',
  'budget-pulse',
  'accounts',
  'upcoming',
  'recent',
  'goals',
  'top-categories',
] as const;

export type OverviewWidgetType = (typeof OVERVIEW_WIDGET_TYPES)[number];

export type WidgetSize = 'compact' | 'regular' | 'wide';

const WIDGET_SIZES: readonly WidgetSize[] = ['compact', 'regular', 'wide'];

export interface OverviewCard {
  readonly id: string;
  readonly type: OverviewWidgetType;
  readonly size: WidgetSize;
  readonly config: Readonly<Record<string, unknown>>;
}

export interface OverviewLayout {
  readonly version: 1;
  readonly cards: readonly OverviewCard[];
}

export interface WidgetRule {
  readonly sizes: readonly WidgetSize[];
  readonly defaultSize: WidgetSize;
  /** Whether more than one card of this type may exist in the same layout at once. */
  readonly multiple: boolean;
}

/**
 * Structural rules only — no titles, no icons, no component references. Those live with the
 * UI that renders a widget, not with the model that orders and sizes it.
 */
export const WIDGET_RULES: Record<OverviewWidgetType, WidgetRule> = {
  insight: { sizes: ['regular', 'wide'], defaultSize: 'wide', multiple: false },
  'budget-pulse': { sizes: ['compact', 'regular', 'wide'], defaultSize: 'regular', multiple: true },
  accounts: { sizes: ['regular', 'wide'], defaultSize: 'regular', multiple: false },
  upcoming: { sizes: ['regular', 'wide'], defaultSize: 'wide', multiple: false },
  recent: { sizes: ['regular', 'wide'], defaultSize: 'wide', multiple: false },
  goals: { sizes: ['compact', 'regular', 'wide'], defaultSize: 'regular', multiple: true },
  'top-categories': { sizes: ['regular', 'wide'], defaultSize: 'regular', multiple: false },
};

const EMPTY_CONFIG: Readonly<Record<string, unknown>> = Object.freeze({});

const card = (
  id: string,
  type: OverviewWidgetType,
  size: WidgetSize,
  config: Readonly<Record<string, unknown>> = EMPTY_CONFIG,
): OverviewCard => ({ id, type, size, config });

/** The current screen's order, given stable deterministic ids rather than generated ones. */
export const DEFAULT_OVERVIEW_LAYOUT: OverviewLayout = {
  version: 1,
  cards: [
    card('default-insight', 'insight', 'wide'),
    card('default-budget-pulse', 'budget-pulse', 'regular'),
    card('default-accounts', 'accounts', 'regular'),
    card('default-upcoming', 'upcoming', 'wide'),
    card('default-recent', 'recent', 'wide'),
  ],
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export interface AddCardInput {
  readonly id: string;
  readonly type: OverviewWidgetType;
  readonly size?: WidgetSize;
  readonly config?: Record<string, unknown>;
}

export type OverviewLayoutAction =
  | { readonly type: 'add'; readonly card: AddCardInput; readonly index?: number }
  | { readonly type: 'remove'; readonly id: string }
  | { readonly type: 'move'; readonly id: string; readonly toIndex: number }
  | { readonly type: 'moveBy'; readonly id: string; readonly delta: number }
  | { readonly type: 'resize'; readonly id: string; readonly size: WidgetSize }
  | { readonly type: 'configure'; readonly id: string; readonly config: Record<string, unknown> }
  | { readonly type: 'reset' };

const resolveSize = (type: OverviewWidgetType, size: WidgetSize | undefined): WidgetSize => {
  const rule = WIDGET_RULES[type];
  if (size && (rule.sizes as readonly string[]).includes(size)) return size;
  return rule.defaultSize;
};

const clampIndex = (index: number, length: number) => Math.max(0, Math.min(index, length));

function addCard(layout: OverviewLayout, action: Extract<OverviewLayoutAction, { type: 'add' }>): OverviewLayout {
  const { card: input, index } = action;
  if (layout.cards.some((existing) => existing.id === input.id)) return layout;
  const rule = WIDGET_RULES[input.type];
  if (!rule.multiple && layout.cards.some((existing) => existing.type === input.type)) return layout;

  const next: OverviewCard = {
    id: input.id,
    type: input.type,
    size: resolveSize(input.type, input.size),
    config: input.config ? { ...input.config } : EMPTY_CONFIG,
  };

  const insertAt = index === undefined ? layout.cards.length : clampIndex(index, layout.cards.length);
  const cards = [...layout.cards];
  cards.splice(insertAt, 0, next);
  return { ...layout, cards };
}

function removeCard(layout: OverviewLayout, id: string): OverviewLayout {
  if (!layout.cards.some((existing) => existing.id === id)) return layout;
  return { ...layout, cards: layout.cards.filter((existing) => existing.id !== id) };
}

function moveCard(layout: OverviewLayout, id: string, toIndex: number): OverviewLayout {
  const fromIndex = layout.cards.findIndex((existing) => existing.id === id);
  if (fromIndex === -1) return layout;

  const clamped = clampIndex(toIndex, layout.cards.length - 1);
  if (clamped === fromIndex) return layout;

  const cards = [...layout.cards];
  const [moved] = cards.splice(fromIndex, 1);
  cards.splice(clamped, 0, moved);
  return { ...layout, cards };
}

function resizeCard(layout: OverviewLayout, id: string, size: WidgetSize): OverviewLayout {
  const index = layout.cards.findIndex((existing) => existing.id === id);
  if (index === -1) return layout;
  const existing = layout.cards[index];
  const rule = WIDGET_RULES[existing.type];
  if (!(rule.sizes as readonly string[]).includes(size)) return layout;
  if (existing.size === size) return layout;

  const cards = [...layout.cards];
  cards[index] = { ...existing, size };
  return { ...layout, cards };
}

function configureCard(
  layout: OverviewLayout,
  id: string,
  config: Record<string, unknown>,
): OverviewLayout {
  const index = layout.cards.findIndex((existing) => existing.id === id);
  if (index === -1) return layout;
  const existing = layout.cards[index];
  const merged = { ...existing.config, ...config };

  const cards = [...layout.cards];
  cards[index] = { ...existing, config: merged };
  return { ...layout, cards };
}

/**
 * Pure by contract: no clock, no randomness, no id generation. Every action already carries
 * whatever identity or ordering it needs, so the same `(layout, action)` pair always produces
 * the same result — which is what lets `useOverviewLayout` persist first and trust that a
 * successful write and the in-memory update it triggers describe the same layout.
 *
 * Returns the same object reference when an action changes nothing, so callers can skip a
 * write with `next === layout` rather than re-serializing and re-persisting an identical value.
 */
export function overviewLayoutReducer(
  layout: OverviewLayout,
  action: OverviewLayoutAction,
): OverviewLayout {
  switch (action.type) {
    case 'add':
      return addCard(layout, action);
    case 'remove':
      return removeCard(layout, action.id);
    case 'move':
      return moveCard(layout, action.id, action.toIndex);
    case 'moveBy': {
      const fromIndex = layout.cards.findIndex((existing) => existing.id === action.id);
      if (fromIndex === -1) return layout;
      return moveCard(layout, action.id, fromIndex + action.delta);
    }
    case 'resize':
      return resizeCard(layout, action.id, action.size);
    case 'configure':
      return configureCard(layout, action.id, action.config);
    case 'reset':
      return layout === DEFAULT_OVERVIEW_LAYOUT ? layout : DEFAULT_OVERVIEW_LAYOUT;
    default:
      return layout;
  }
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const rawCardSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  size: z.string().optional(),
  config: z.unknown().optional(),
});

const rawLayoutSchema = z.object({
  version: z.literal(1),
  cards: z.array(rawCardSchema),
});

const isWidgetType = (value: string): value is OverviewWidgetType =>
  (OVERVIEW_WIDGET_TYPES as readonly string[]).includes(value);

const isWidgetSize = (value: unknown): value is WidgetSize =>
  typeof value === 'string' && (WIDGET_SIZES as readonly string[]).includes(value);

const normalizeConfig = (value: unknown): Readonly<Record<string, unknown>> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return EMPTY_CONFIG;
};

/**
 * Tolerant by design: `raw` may be `undefined` (first launch), a stale shape from an older
 * build, or a hand-edited blob restored from a backup. Anything this parser cannot make sense
 * of degrades to `DEFAULT_OVERVIEW_LAYOUT` rather than throwing — a corrupt layout preference
 * should never be the reason the Overview screen fails to render.
 *
 * An empty `cards` array is a valid, deliberate state (the user removed every card) and is
 * preserved rather than treated as "missing".
 */
export function normalizeOverviewLayout(raw: unknown): OverviewLayout {
  const parsed = rawLayoutSchema.safeParse(raw);
  if (!parsed.success) return DEFAULT_OVERVIEW_LAYOUT;

  const seenIds = new Set<string>();
  const seenSingleTypes = new Set<OverviewWidgetType>();
  const cards: OverviewCard[] = [];

  for (const raw of parsed.data.cards) {
    if (!isWidgetType(raw.type)) continue;
    if (seenIds.has(raw.id)) continue;

    const rule = WIDGET_RULES[raw.type];
    if (!rule.multiple && seenSingleTypes.has(raw.type)) continue;

    seenIds.add(raw.id);
    if (!rule.multiple) seenSingleTypes.add(raw.type);

    cards.push({
      id: raw.id,
      type: raw.type,
      size: isWidgetSize(raw.size) && (rule.sizes as readonly string[]).includes(raw.size)
        ? raw.size
        : rule.defaultSize,
      config: normalizeConfig(raw.config),
    });
  }

  return { version: 1, cards };
}

/** Types that can currently be added: `multiple` types always, single-instance types only when absent. */
export function availableToAdd(layout: OverviewLayout): OverviewWidgetType[] {
  const present = new Set(layout.cards.map((existing) => existing.type));
  return OVERVIEW_WIDGET_TYPES.filter((type) => WIDGET_RULES[type].multiple || !present.has(type));
}

export function serializeOverviewLayout(layout: OverviewLayout): string {
  return JSON.stringify(layout);
}
