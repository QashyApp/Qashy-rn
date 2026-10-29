import { View, type ColorValue } from "react-native";

import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { type ImportCounts, type ImportSourceInfo } from "@/data/import/types";
import { useQashyTheme } from "@/theme/theme";

const COUNT_LABELS: {
  key: keyof ImportCounts;
  label: string;
  singular: string;
  plural: string;
}[] = [
  {
    key: "accounts",
    label: "Accounts",
    singular: "account",
    plural: "accounts",
  },
  {
    key: "categories",
    label: "Categories",
    singular: "category",
    plural: "categories",
  },
  { key: "tags", label: "Tags", singular: "tag", plural: "tags" },
  {
    key: "transactions",
    label: "Transactions",
    singular: "transaction",
    plural: "transactions",
  },
  {
    key: "recurringRules",
    label: "Recurring schedules",
    singular: "recurring schedule",
    plural: "recurring schedules",
  },
  { key: "budgets", label: "Budgets", singular: "budget", plural: "budgets" },
];

/**
 * The non-zero counts as translated bullet lines ("• 3 transactions"); null when everything is
 * zero. One line per kind, translated on its own, so no sentence has to join a list of
 * counts in every language.
 */
export function describeCounts(
  counts: ImportCounts & { goals?: number },
  t: (message: string) => string,
): string | null {
  const items = COUNT_LABELS.filter((item) => counts[item.key] > 0).map(
    (item) =>
      `${counts[item.key]} ${counts[item.key] === 1 ? item.singular : item.plural}`,
  );
  if (counts.goals)
    items.push(`${counts.goals} ${counts.goals === 1 ? "goal" : "goals"}`);
  if (!items.length) return null;
  return items.map((item) => `• ${t(item)}`).join("\n");
}

export function totalOf(counts: ImportCounts) {
  return (
    counts.accounts +
    counts.categories +
    counts.tags +
    counts.transactions +
    counts.recurringRules +
    counts.budgets
  );
}

function BulletList({
  items,
  icon,
  color,
}: {
  items: string[];
  icon: string;
  color: ColorValue;
}) {
  const { space } = useQashyTheme();
  return (
    <View style={{ gap: space.sm }}>
      {items.map((item) => (
        <View
          key={item}
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: space.sm,
          }}
        >
          <View style={{ paddingTop: space.xxs }}>
            <AppIcon name={icon} color={color} size={16} />
          </View>
          <AppText variant="caption" style={{ flex: 1 }}>
            {item}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function InfoSection({
  title,
  items,
  icon,
  tone,
}: {
  title: string;
  items: string[];
  icon: string;
  tone: "positive" | "negative" | "muted";
}) {
  const theme = useQashyTheme();
  const { space } = theme;
  if (!items.length) return null;
  const color =
    tone === "positive"
      ? theme.positive
      : tone === "negative"
        ? theme.negative
        : theme.textMuted;
  return (
    <View accessibilityLabel={title} role="group" style={{ gap: space.sm }}>
      <AppText variant="label">{title}</AppText>
      <BulletList items={items} icon={icon} color={color} />
    </View>
  );
}

/** The reference copy, collapsed behind a disclosure on the source step. */
export function SourceDetails({ source }: { source: ImportSourceInfo }) {
  const { space } = useQashyTheme();
  return (
    <View style={{ gap: space.lg }}>
      <InfoSection
        title="Will be imported"
        items={source.imports}
        icon="checkmark"
        tone="positive"
      />
      <InfoSection
        title="Will not be imported"
        items={source.notImported}
        icon="xmark"
        tone="negative"
      />
      <InfoSection
        title="Good to know"
        items={source.caveats}
        icon="info.circle"
        tone="muted"
      />
    </View>
  );
}

export function StatTile({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "accent" | "muted" | "negative";
}) {
  const theme = useQashyTheme();
  const { radius } = theme;
  return (
    <View
      style={{
        flex: 1,
        minWidth: 100,
        padding: 14,
        borderRadius: radius.card,
        backgroundColor:
          tone === "accent" ? theme.accentContainer : theme.surfaceMuted,
      }}
    >
      <AppText
        literal
        figure
        variant="headline"
        style={{
          color:
            tone === "accent"
              ? theme.accentText
              : tone === "negative" && value
                ? theme.negativeText
                : theme.text,
        }}
      >
        {String(value)}
      </AppText>
      <AppText variant="caption" muted>
        {label}
      </AppText>
    </View>
  );
}

function CountRow({ label, value }: { label: string; value: number }) {
  const { space } = useQashyTheme();
  return (
    <View
      style={{
        minHeight: 32,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space.md,
      }}
    >
      <AppText variant="caption" style={{ flex: 1 }}>
        {label}
      </AppText>
      <AppText literal figure variant="label">
        {String(value)}
      </AppText>
    </View>
  );
}

export function CountList({
  title,
  counts,
  extra,
}: {
  title: string;
  counts: ImportCounts & { goals?: number };
  extra?: boolean;
}) {
  const { space } = useQashyTheme();
  const rows = COUNT_LABELS.filter((item) => counts[item.key] > 0);
  const goals = extra ? (counts.goals ?? 0) : 0;
  if (!rows.length && !goals) return null;
  return (
    <View accessibilityLabel={title} role="group" style={{ gap: space.xxs }}>
      <AppText variant="label">{title}</AppText>
      {rows.map((item) => (
        <CountRow key={item.key} label={item.label} value={counts[item.key]} />
      ))}
      {goals ? <CountRow label="Goals" value={goals} /> : null}
    </View>
  );
}
