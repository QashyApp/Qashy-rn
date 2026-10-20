/**
 * The settings UI of each widget kind: its title and the controls for the fields that kind adds
 * to the shared appearance controls of `widgets-screen.tsx`. A new kind adds a section here and
 * one line in `UI`; the compiler rejects a kind in `WidgetConfig` that has no entry.
 */

import type { ComponentType } from "react";
import { View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { OptionRow } from "@/components/ui/option-row";
import {
  SegmentedControl,
  type SegmentOption,
} from "@/components/ui/segmented-control";
import type {
  GraphMonths,
  KindFields,
  SummaryWidgetConfig,
  TransactionsWidgetConfig,
  WidgetConfig,
  WidgetKind,
} from "@/features/widgets/kinds";
import { useLocalization } from "@/localization/localization";
import { useFinanceState } from "@/providers/finance-provider";
import { useQashyTheme } from "@/theme/theme";

export interface KindSectionProps<C extends WidgetConfig> {
  config: C;
  /** Saves a change to the kind's own fields; resolves true when it was saved. */
  change: (patch: Partial<KindFields<C>>) => Promise<boolean>;
}

interface WidgetKindUi<C extends WidgetConfig> {
  /** The card heading (numbered by the screen when several of the kind are placed). */
  title: string;
  Section: ComponentType<KindSectionProps<C>>;
}

const GRAPH_OPTIONS: SegmentOption<`${GraphMonths}`>[] = [
  { value: "3", label: "3 months" },
  { value: "6", label: "6 months" },
  { value: "12", label: "12 months" },
];

function TransactionsSection({
  config,
  change,
}: KindSectionProps<TransactionsWidgetConfig>) {
  const { space } = useQashyTheme();
  const { t } = useLocalization();
  const { accounts } = useFinanceState();
  const liveAccounts = accounts.filter(
    (account) => !account.archived && !account.deletedAt,
  );
  const selectedAccountId = liveAccounts.some(
    (account) => account.id === config.accountId,
  )
    ? config.accountId
    : null;
  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="label">Show transactions from</AppText>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("Show transactions from")}
        style={{ gap: space.sm }}
      >
        <OptionRow
          title="All accounts"
          selected={selectedAccountId === null}
          onPress={() => change({ accountId: null })}
        />
        {liveAccounts.map((account) => (
          <OptionRow
            key={account.id}
            literal
            title={account.name}
            description={account.currency}
            selected={selectedAccountId === account.id}
            onPress={() => change({ accountId: account.id })}
          />
        ))}
      </View>
    </View>
  );
}

function SummarySection({
  config,
  change,
}: KindSectionProps<SummaryWidgetConfig>) {
  const { space } = useQashyTheme();
  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="label">Graph range</AppText>
      <SegmentedControl
        label="Graph range"
        options={GRAPH_OPTIONS}
        value={`${config.graphMonths}` as `${GraphMonths}`}
        onChange={(value) =>
          change({ graphMonths: Number(value) as GraphMonths })
        }
      />
    </View>
  );
}

type Ui = {
  [K in WidgetKind]: WidgetKindUi<Extract<WidgetConfig, { kind: K }>>;
};

const UI: Ui = {
  transactions: { title: "Transactions widget", Section: TransactionsSection },
  summary: { title: "Summary widget", Section: SummarySection },
};

export function widgetKindTitle(kind: WidgetKind): string {
  return UI[kind].title;
}

/** Renders the section of `config`'s kind. */
export function WidgetKindSection({
  config,
  change,
}: KindSectionProps<WidgetConfig>) {
  // The lookup by a union-typed kind loses the pairing of section and config type.
  const Section = UI[config.kind].Section as ComponentType<
    KindSectionProps<WidgetConfig>
  >;
  return <Section config={config} change={change} />;
}
