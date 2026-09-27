/**
 * Maps every `OverviewWidgetType` to the component (and optional inline config sheet) that
 * renders it, plus the copy shown in the "Add card" gallery. Structural rules (allowed sizes,
 * whether more than one instance can exist) stay in `layout/overview-layout.ts`; this is the
 * UI-facing half of the same catalog.
 */

import type { OverviewWidgetType } from '@/features/overview/layout/overview-layout';
import { AccountsWidget } from '@/features/overview/widgets/accounts-widget';
import { BudgetPulseConfigSheet, BudgetPulseWidget } from '@/features/overview/widgets/budget-pulse-widget';
import { GoalsConfigSheet, GoalsWidget } from '@/features/overview/widgets/goals-widget';
import { InsightWidget } from '@/features/overview/widgets/insight-widget';
import { RecentWidget } from '@/features/overview/widgets/recent-widget';
import { TopCategoriesWidget } from '@/features/overview/widgets/top-categories-widget';
import type { WidgetDefinition } from '@/features/overview/widgets/types';
import { UpcomingWidget } from '@/features/overview/widgets/upcoming-widget';

export const WIDGET_REGISTRY: Record<OverviewWidgetType, WidgetDefinition> = {
  insight: {
    type: 'insight',
    title: 'Spending insight',
    description: 'A trend line or category breakdown of this month’s spending.',
    icon: 'chart.line.uptrend.xyaxis',
    Component: InsightWidget,
  },
  'budget-pulse': {
    type: 'budget-pulse',
    title: 'Budget pulse',
    description: 'How much of a budget—or all of them—has been spent.',
    icon: 'chart',
    Component: BudgetPulseWidget,
    ConfigSheet: BudgetPulseConfigSheet,
  },
  accounts: {
    type: 'accounts',
    title: 'Accounts',
    description: 'Every account and its current balance.',
    icon: 'wallet',
    Component: AccountsWidget,
  },
  upcoming: {
    type: 'upcoming',
    title: 'Coming up',
    description: 'Recurring transactions due soon, with quick skip or mark-paid actions.',
    icon: 'calendar',
    Component: UpcomingWidget,
  },
  recent: {
    type: 'recent',
    title: 'Recent activity',
    description: 'The latest transactions from this month.',
    icon: 'arrow.left.arrow.right',
    Component: RecentWidget,
  },
  goals: {
    type: 'goals',
    title: 'Goals',
    description: 'Progress toward savings targets and planned purchases.',
    icon: 'target',
    Component: GoalsWidget,
    ConfigSheet: GoalsConfigSheet,
  },
  'top-categories': {
    type: 'top-categories',
    title: 'Top categories',
    description: 'The categories driving this month’s spending.',
    icon: 'chart.pie',
    Component: TopCategoriesWidget,
  },
};
