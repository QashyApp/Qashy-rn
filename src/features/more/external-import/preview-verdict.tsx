import { router } from "expo-router";
import { View } from "react-native";

import { ActionButton } from "@/components/ui/action-button";
import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { TextButton } from "@/components/ui/text-button";
import {
  type ExternalImportOutcome,
  type ImportMode,
} from "@/data/import/types";
import { useLocalization } from "@/localization/localization";
import { useQashyTheme } from "@/theme/theme";
import {
  CountList,
  StatTile,
  totalOf,
} from "@/features/more/external-import/import-summary-parts";

/**
 * The decision: what will be added, what a replace would delete, what is blocked, and the
 * commit. Supporting detail (balances, notes, renames) renders below this, so the Import
 * button never sits under it.
 */
export function PreviewVerdict({
  outcome,
  mode,
  busy,
  confirming,
  onImport,
  onRetry,
}: {
  outcome: ExternalImportOutcome;
  mode: ImportMode;
  busy: boolean;
  confirming: boolean;
  onImport: () => void;
  onRetry: () => void;
}) {
  const theme = useQashyTheme();
  const { space } = theme;
  const { t } = useLocalization();
  const existing =
    outcome.duplicateTransactions +
    outcome.reused.accounts +
    outcome.reused.categories +
    outcome.reused.tags;
  const reasons = new Map<string, number>();
  for (const item of outcome.rejected)
    reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1);
  const reasonList = [...reasons.entries()];
  const replacedAny =
    mode === "replace" &&
    outcome.rejected.length === 0 &&
    (totalOf(outcome.replaced) > 0 || outcome.replaced.goals > 0);

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        <StatTile
          value={totalOf(outcome.created)}
          label="To add"
          tone="accent"
        />
        <StatTile value={existing} label="Already in Qashy" tone="muted" />
        <StatTile
          value={outcome.rejected.length}
          label="Blocked"
          tone="negative"
        />
      </View>

      <CountList title="Will be added" counts={outcome.created} />

      {replacedAny ? (
        <Card variant="inset" style={{ gap: space.sm }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
            }}
          >
            <AppIcon
              name="exclamationmark.triangle"
              color={theme.negative}
              size={18}
            />
            <AppText variant="label" style={{ color: theme.negative, flex: 1 }}>
              Your current data will be permanently deleted
            </AppText>
          </View>
          <CountList title="Will be deleted" counts={outcome.replaced} extra />
        </Card>
      ) : null}

      {outcome.rejected.length ? (
        <Card variant="inset" style={{ gap: space.sm }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
            }}
          >
            <AppIcon
              name="exclamationmark.triangle"
              color={theme.negative}
              size={18}
            />
            <AppText variant="label" style={{ color: theme.negative, flex: 1 }}>
              Can’t import yet
            </AppText>
          </View>
          {reasonList.slice(0, 4).map(([reason, count]) => (
            <AppText key={reason} literal variant="caption">
              {count > 1 ? `${t(reason)} (×${count})` : t(reason)}
            </AppText>
          ))}
          {reasonList.length > 4 ? (
            <AppText literal variant="caption" muted>
              {t(`+${reasonList.length - 4} more`)}
            </AppText>
          ) : null}
          <AppText variant="caption" muted>
            Nothing can be imported until these are fixed. For missing exchange
            rates, turn on automatic rates or add manual rates in More →
            Exchange rates, then preview again.
          </AppText>
          <ActionButton
            title="Open exchange rates"
            icon="arrow.left.arrow.right"
            variant="secondary"
            onPress={() => router.push("/exchange-rates")}
          />
          <TextButton
            title="Preview again"
            icon="arrow.clockwise"
            tone="muted"
            onPress={onRetry}
            disabled={busy}
          />
        </Card>
      ) : null}

      <ActionButton
        title={
          confirming
            ? "Waiting for confirmation…"
            : busy
              ? "Importing…"
              : "Import"
        }
        icon="checkmark"
        size="large"
        onPress={onImport}
        disabled={busy || confirming || outcome.rejected.length > 0}
      />
    </View>
  );
}
