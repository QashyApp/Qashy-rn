/**
 * The pairing wizard — the only screen in Qashy where a mistake hands someone your finances.
 *
 * Everything else in the sync stack fails closed on its own: a bad signature is rejected, a
 * broken chain is refused, a stale code will not decode. This screen is the one place where
 * the security control is *a person looking at two screens*, and the entire design is in
 * service of making that comparison happen properly.
 *
 * ## Why the confirm step looks the way it does
 *
 * The six words are a Short Authentication String derived from the handshake transcript. If
 * someone photographed the QR and raced the handshake, they hold a different transcript, so
 * their words differ — and the human catches what no amount of cryptography can, because both
 * sides genuinely completed a valid handshake with *someone*. That means:
 *
 * - **Neither button is pre-selected, and neither is the default.** "They match" and "They
 *   don't match" are equally weighted, side by side. A primary-styled "Continue" would be
 *   pressed reflexively, which is precisely the failure mode.
 * - **The peer's name is never shown before confirmation.** A name is attacker-chosen; a
 *   screen reading "Pair with Ziv's phone?" earns a yes the fingerprint has not.
 * - **A failed or cancelled handshake is not resumable.** The pairing secret is single use,
 *   and `PairingHost` closes itself on failure. Going back mints a brand-new code, which is
 *   the correct behaviour rather than an inconvenience to work around.
 *
 * ## Why the async work lives in press handlers, never in effects
 *
 * `handshake()` blocks until the other device arrives, then resolves with words to show. Kicked
 * off from an effect it would be a bare `await` before a `setState`, which the React lint rules
 * reject and which would also make the "start over" path race its own cleanup. Started from a
 * press, the lifecycle is explicit: one live session at a time, held in a ref, closed on
 * unmount and before any new one is created.
 *
 * ## The one irreversible step
 *
 * `confirm()` on the host seals and sends the vault key. `adoptVault` on the joiner overwrites
 * whatever vault that device held. Both are gated on the SAS, and the join role is hidden
 * outright on a device that is already in a vault — otherwise "add this device" would silently
 * abandon the vault it was already part of, taking its peers with it.
 */

import { router } from "expo-router";
import { ScrollView, View } from "react-native";

import { QrScanner } from "@/components/sync/qr-scanner";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { MotionView } from "@/components/ui/motion";
import { ProgressBar } from "@/components/ui/progress-bar";
import { TextButton } from "@/components/ui/text-button";
import { type SyncStatus } from "@/sync/setup";
import { useQashyTheme } from "@/theme/theme";
import type { SpaceScale } from "@/theme/themes/types";
import { SCAN_CODE_HINT, STAGES } from "@/features/sync/pair/pair-model";
import { RoleStep } from "@/features/sync/pair/role-step";
import { HostCodeStep } from "@/features/sync/pair/host-code-step";
import { ConfirmStep } from "@/features/sync/pair/confirm-step";
import { DoneStep } from "@/features/sync/pair/done-step";
import { usePairFlow } from "@/features/sync/pair/use-pair-flow";

export function PairScreen() {
  const theme = useQashyTheme();
  const { space } = theme;
  const {
    status,
    t,
    firstRun,
    stage,
    direction,
    role,
    setRole,
    deviceName,
    setDeviceName,
    busy,
    error,
    codeError,
    clearCodeError,
    receiveStalled,
    retryReceive,
    code,
    remaining,
    sas,
    outcome,
    scannerRearm,
    closeSession,
    move,
    startHosting,
    restart,
    startJoining,
    confirmMatch,
    rejectMatch,
  } = usePairFlow();

  if (!status) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.background }}
        contentContainerStyle={containerStyle(space)}
      >
        <AppText muted>Reading this device’s sync state…</AppText>
      </ScrollView>
    );
  }

  const blocked = blockingReason(status);

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={containerStyle(space)}
    >
      <View style={{ gap: space.sm }}>
        <AppText
          literal
          variant="caption"
          muted
          style={{ textAlign: "center" }}
        >
          {t(`Step ${STAGES.indexOf(stage) + 1} of ${STAGES.length}`)}
        </AppText>
        <ProgressBar
          value={(STAGES.indexOf(stage) + 1) / STAGES.length}
          segments={STAGES.length}
          label={t("Pairing progress")}
        />
      </View>

      {error ? (
        <MotionView variant="up" exit animateLayout>
          <Card style={{ gap: space.xs, borderColor: theme.negative }}>
            <AppText
              accessibilityRole="alert"
              variant="label"
              style={{ color: theme.negativeText }}
            >
              Pairing stopped
            </AppText>
            {/* `literal` stops AppText translating the whole node, so the message is translated here
                instead. Messages not in the dictionary come back unchanged, so an unknown library
                error still shows as written. */}
            <AppText literal variant="caption" muted>
              {t(error)}
            </AppText>
          </Card>
        </MotionView>
      ) : null}

      {blocked ? (
        <Card style={{ gap: space.md }}>
          <AppText variant="headline">{blocked.title}</AppText>
          <AppText muted>{blocked.body}</AppText>
          <TextButton
            title="Open sync settings"
            icon="gear"
            onPress={() => router.replace("/sync")}
          />
        </Card>
      ) : (
        <MotionView
          key={`${stage}-${direction}`}
          variant={direction === "forward" ? "right" : "left"}
          exit
          animateLayout
          style={{ gap: space.lg }}
        >
          {stage === "role" ? (
            <RoleStep
              role={role}
              onRole={setRole}
              canJoin={!status.deviceId}
              canHost={Boolean(status.endpoints.relayUrl)}
              joinOnly={firstRun}
              deviceName={deviceName}
              onDeviceName={setDeviceName}
              busy={busy}
              onContinue={() => {
                if (role === "host") void startHosting();
                else move("code");
              }}
            />
          ) : null}

          {stage === "code" && role === "host" ? (
            <HostCodeStep
              code={code}
              remaining={remaining}
              onRestart={restart}
            />
          ) : null}

          {stage === "code" && role === "join" ? (
            <>
              <AppText variant="title">Scan the other device</AppText>
              <AppText muted>
                Open Sync → Add device on the device that already has your data,
                and point this one at the code it shows.
              </AppText>
              <QrScanner
                rearm={scannerRearm}
                onCode={(value) => void startJoining(value)}
                error={codeError}
                onEdit={clearCodeError}
                hint={SCAN_CODE_HINT}
              />
              <TextButton
                title="Back"
                tone="muted"
                onPress={() => {
                  // Cancels a handshake already in flight, not only the screen change: otherwise it
                  // would finish later and move the wizard forward to the words.
                  closeSession();
                  move("role");
                }}
              />
            </>
          ) : null}

          {stage === "confirm" && sas ? (
            <ConfirmStep
              sas={sas}
              busy={busy}
              onMatch={() => void confirmMatch()}
              onReject={rejectMatch}
            />
          ) : null}

          {stage === "done" ? (
            <DoneStep
              outcome={outcome}
              firstRun={firstRun}
              stalled={receiveStalled}
              onRetry={retryReceive}
            />
          ) : null}
        </MotionView>
      )}
    </ScrollView>
  );
}

const containerStyle = (space: SpaceScale) =>
  ({
    padding: 18,
    paddingBottom: 40,
    gap: space.lg,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  }) as const;

/**
 * The states in which pairing cannot start at all, with the fix.
 *
 * Checked before the wizard rather than at the point of failure, because both of these would
 * otherwise surface as a socket that never connects — which reads as "the other device is
 * broken" and sends the user to fix the wrong thing.
 *
 * A missing relay address is deliberately *not* here. It blocks hosting, because the handshake
 * runs over the rendezvous, but a joining device needs no configuration at all: the pairing
 * code carries the host's address. Blocking the whole screen on it would make a blank-endpoint
 * device unable to be added to a vault that is perfectly well configured.
 */
function blockingReason(status: SyncStatus) {
  if (status.keystore === "unavailable") {
    return {
      title: "This device can’t store a key safely",
      body: "Qashy could not reach secure storage, so it has nowhere to keep the vault key. Pairing is disabled here. Your finance data is untouched.",
    };
  }
  if (status.keystore === "locked") {
    return {
      title: "Unlock this device first",
      body: "The vault key on this device is behind a passphrase. Unlock it from the sync screen, then come back.",
    };
  }
  return null;
}
