import { View } from "react-native";

import { SasDisplay } from "@/components/sync/sas-display";
import { ActionButton } from "@/components/ui/action-button";
import { AppText } from "@/components/ui/app-text";
import { useQashyTheme } from "@/theme/theme";
import { SunkenWell } from "@/features/sync/pair/pair-primitives";

export function ConfirmStep({
  sas,
  busy,
  onMatch,
  onReject,
}: {
  readonly sas: readonly string[];
  readonly busy: boolean;
  readonly onMatch: () => void;
  readonly onReject: () => void;
}) {
  const theme = useQashyTheme();
  const { space } = theme;
  return (
    <>
      <AppText variant="title">Do these words match?</AppText>
      <AppText muted>
        The other device is showing six words too. Compare them now, in the same
        order. If even one differs, stop — someone else may be trying to join.
      </AppText>

      {/* A larger, better-spaced sunken well around the six words — the single most important
          comparison in the app deserves more room than the cramped tiles the words render as
          on their own. */}
      <SunkenWell>
        <SasDisplay words={sas} />
      </SunkenWell>

      {/* Equal weight, deliberately. The dangerous answer is "yes" given reflexively, so "yes"
          gets no visual advantage over "no" and neither is the default focus target. */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        <ActionButton
          title={busy ? "Pairing…" : "They match"}
          icon="checkmark"
          size="large"
          busy={busy}
          disabled={busy}
          onPress={onMatch}
          style={{ flex: 1, minWidth: 160 }}
        />
        <ActionButton
          title="They don’t match"
          icon="xmark"
          variant="danger"
          size="large"
          disabled={busy}
          onPress={onReject}
          style={{ flex: 1, minWidth: 160 }}
        />
      </View>

      <AppText variant="caption" muted>
        Nothing has been sent yet. Your vault key only leaves this device after
        you confirm.
      </AppText>
    </>
  );
}
