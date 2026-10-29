import { View } from "react-native";

import { ActionButton } from "@/components/ui/action-button";
import { AppText } from "@/components/ui/app-text";
import { MotionView } from "@/components/ui/motion";
import { StatusPill } from "@/components/ui/status-pill";
import { summarizeArchive, type VaultArchive } from "@/sync/backup";
import { useQashyTheme } from "@/theme/theme";
import { toLocalDate } from "@/utils/date";
import { Busy } from "@/features/sync/transfer/transfer-types";

/**
 * What the file turned out to contain, before anything is replaced.
 *
 * Deliberately concrete. "A backup from 12 March, from Laptop, with 1 482 transactions" is
 * something a person can recognise as theirs or not; "a valid archive" is not.
 */
export function Preview({
  archive,
  busy,
  onRestore,
}: {
  archive: VaultArchive;
  busy: Busy;
  onRestore: () => void;
}) {
  const summary = summarizeArchive(archive);
  const theme = useQashyTheme();
  const { radius, space } = theme;
  // The timestamp is UTC, but the file name carries the local day it was made. Slicing the UTC
  // string showed a different date to anyone away from UTC around midnight.
  const madeOnDate = (createdAt: string) => {
    const made = new Date(createdAt);
    return Number.isNaN(made.getTime())
      ? createdAt.slice(0, 10)
      : toLocalDate(made);
  };
  return (
    <MotionView variant="up" exit animateLayout style={{ gap: space.md }}>
      <StatusPill
        label="Backup opened"
        icon="checkmark.circle"
        tone="positive"
        style={{ borderRadius: radius.control }}
      />
      <View style={{ gap: space.xxs }}>
        <Detail label="Made on" value={madeOnDate(summary.createdAt)} />
        <Detail label="Made by" value={summary.deviceName || "—"} />
        <Detail label="Base currency" value={summary.baseCurrency || "—"} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        <Tally
          value={summary.transactionCount}
          label="Transactions"
          tone="accent"
        />
        <Tally value={summary.recordCount} label="Records" />
        <Tally value={summary.peerCount} label="Other devices" />
      </View>
      <ActionButton
        title={
          busy === "restore"
            ? "Restoring…"
            : "Replace this device with this backup"
        }
        icon="arrow.down.circle"
        variant="danger"
        size="large"
        busy={busy === "restore"}
        disabled={Boolean(busy)}
        onPress={onRestore}
      />
      <AppText variant="caption" style={{ color: theme.negativeText }}>
        This cannot be undone from inside Qashy.
      </AppText>
    </MotionView>
  );
}

/** One fact about the archive. The value is data, so it is never translated. */
function Detail({ label, value }: { label: string; value: string }) {
  const { space } = useQashyTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "baseline",
        gap: space.sm,
      }}
    >
      <AppText variant="label">{label}</AppText>
      <AppText literal variant="caption" muted>
        {value}
      </AppText>
    </View>
  );
}

/**
 * A count and what it counts.
 *
 * Built as two nodes rather than one interpolated sentence on purpose: the number is data and
 * the label is a fixed string, so this needs no dynamic-translation entry and reads correctly
 * in Hebrew without a reordered sentence template.
 */
export function Tally({
  value,
  label,
  tone = "plain",
}: {
  value: number;
  label: string;
  tone?: "accent" | "negative" | "plain";
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  return (
    <View
      style={{
        flex: 1,
        minWidth: 108,
        padding: space.md,
        borderRadius: radius.card,
        borderCurve: "continuous",
        backgroundColor:
          tone === "accent" ? theme.accentContainer : theme.surfaceMuted,
      }}
    >
      <AppText
        literal
        variant="headline"
        style={{
          color:
            tone === "accent"
              ? theme.onAccentContainer
              : tone === "negative"
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
