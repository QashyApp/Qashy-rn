/**
 * Shared types for the Overview widget registry.
 *
 * Every card on the Overview screen is a `WidgetDefinition` keyed by `OverviewWidgetType` in
 * `registry.ts`. A widget's `Component` receives only what it needs to render itself — the
 * `OverviewCard` (id/type/size/config), the month currently selected on the screen, and whether
 * the screen is in edit mode (so a widget can suppress its own interactive affordances while
 * `EditableCardFrame` makes the whole card non-interactive anyway).
 */

import type { ReactNode } from 'react';

import type { OverviewCard, OverviewWidgetType, WidgetSize } from '@/features/overview/layout/overview-layout';

export interface WidgetProps {
  readonly card: OverviewCard;
  /** Start-of-month ISO date, matching the screen's own `month` state. */
  readonly month: string;
  readonly monthDirection: 'left' | 'right';
  readonly size: WidgetSize;
  readonly editing: boolean;
}

export interface WidgetConfigSheetProps {
  readonly card: OverviewCard;
  readonly onConfigure: (config: Record<string, unknown>) => void;
}

export interface WidgetDefinition {
  readonly type: OverviewWidgetType;
  readonly title: string;
  readonly description: string;
  /** An `AppIcon` name that exists in the SF→Ionicon map. */
  readonly icon: string;
  readonly Component: (props: WidgetProps) => ReactNode;
  /** Rendered inline inside `EditableCardFrame` as an expandable settings panel. */
  readonly ConfigSheet?: (props: WidgetConfigSheetProps) => ReactNode;
}
