/**
 * Who is in the vault.
 *
 * This is the list that has to be *exactly* right, because it is the answer to the only
 * question that matters about an end-to-end encrypted system: who can read this. A device on
 * this list can read every transaction, every balance, and every note, and there is no partial
 * membership to hide behind — so the screen shows the whole roster, including the ones that
 * were removed, and never abbreviates it behind a "3 devices" summary.
 *
 * Three deliberate choices:
 *
 * - **This device is first and labelled as such.** Somebody scanning for a device they no
 *   longer own must not have to work out which row is the phone in their hand.
 * - **Revoked devices stay visible.** The row is kept on disk so past history stays
 *   attributable, and hiding it here would make "did I actually remove the old laptop?"
 *   unanswerable — which is the exact question a person asks after losing one.
 * - **Removing a device says what it does not do.** Revocation is forward-only. It stops that
 *   device writing into this vault; it cannot reach across and erase what it already holds.
 *   A confirm dialog that implied otherwise would be the most consequential lie in the app.
 */

import { router } from "expo-router";
import { useRef, useState } from "react";
import { Platform, View } from "react-native";

import { ActionButton } from "@/components/ui/action-button";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { MotionView } from "@/components/ui/motion";
import { SectionHeader } from "@/components/ui/section-header";
import { SettingsRow } from "@/components/ui/settings-row";
import { TextButton } from "@/components/ui/text-button";
import {
  describePeer,
  deviceIcon,
  livePeers,
} from "@/features/sync/sync-summary";
import { useLocalization } from "@/localization/localization";
import { useSync } from "@/providers/sync-provider";
import {
  renameDevice,
  revokePeer,
  setRevocationPolicy,
  transferVaultOwnership,
  type SyncStatus,
} from "@/sync/setup";
import { useQashyTheme } from "@/theme/theme";
import { confirmDestructive, errorMessage, showError } from "@/utils/confirm";
import { hapticSuccess } from "@/services/haptics";

/**
 * Said before a removal is started and again before it is approved, because both end in the same
 * place. The first half is what people expect; the second is the part they do not, and finding
 * it out afterwards is much worse than reading it here.
 */
const REMOVAL_MESSAGE =
  "It stops sending and receiving changes here. It keeps the copy of your data it already has — to make that copy useless, rotate the vault key afterwards.";

export function DeviceCard({
  status,
  now,
  onChanged,
}: {
  readonly status: SyncStatus;
  readonly now: number;
  readonly onChanged: () => Promise<void>;
}) {
  const { space, tile } = useQashyTheme();
  // Rows are inset past the icon tile plus its gap, matching every other list in the app.
  const rowDividerInset = tile.size + space.md;
  const { setup } = useSync();
  const { t } = useLocalization();

  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(status.deviceName);
  const [saving, setSaving] = useState(false);
  // State is stale inside a double tap; the ref is what the in-flight check reads.
  const savingRef = useRef(false);
  const approvingRef = useRef(false);
  const removingRef = useRef(false);
  const [approving, setApproving] = useState<string | null>(null);
  const isOwner = status.revocation.ownerDeviceId === status.deviceId;

  // Newest first among the live ones, then the removed ones. Someone opening this screen after
  // pairing wants the device they just added at the top, and someone auditing it wants the
  // removals gathered at the bottom rather than interleaved by date.
  const peers = [
    ...livePeers(status.peers).sort((a, b) =>
      b.addedAt.localeCompare(a.addedAt),
    ),
    ...status.peers.filter((peer) => peer.revokedAt),
  ];

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await renameDevice(setup, trimmed);
      await onChanged();
      setRenaming(false);
      hapticSuccess();
    } catch (reason) {
      showError(
        "Couldn’t rename this device",
        errorMessage(reason, "Try a different name."),
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // A removal that needs more approvals, by the device it would remove. Under majority vote the
  // first "remove" only proposes; each further device then has to approve it on purpose.
  const pending = new Map(
    status.proposals.map((proposal) => [proposal.targetId, proposal]),
  );
  const pendingRows = peers.flatMap((peer) => {
    const proposal = pending.get(peer.deviceId);
    return proposal && !peer.revokedAt ? [{ peer, proposal }] : [];
  });

  const remove = async (peerId: string, peerName: string) => {
    // `revokePeer` approves an open proposal for this device rather than starting another, so the
    // dialog has to describe that approval, not a vote that is already under way.
    const open = pending.get(peerId);
    if (open) {
      const canApprove =
        open.voters.includes(status.deviceId) &&
        !open.approvals.includes(status.deviceId);
      if (canApprove) await approve(peerId, peerName, open);
      return;
    }
    // Held across the confirm dialog too: a second tap on the row while it is open (or while the
    // signed removal is being appended) must not start a second removal.
    if (removingRef.current) return;
    removingRef.current = true;
    try {
      // Under majority vote the tap that starts a removal counts as the proposer's own approval,
      // and the device goes only if that alone is enough (`revokePeer` builds the same quorum).
      // With three or more devices it is not, so the dialog says it only proposes.
      const voters = livePeers(status.peers).length + 1;
      const required = Math.ceil(voters / 2);
      const proposesOnly =
        status.revocation.mode === "quorum" && required > 1;
      const confirmed = await confirmDestructive(
        proposesOnly
          ? {
              title: "Propose removing this device?",
              message: `This starts a vote to remove ${peerName}. It’s removed once ${required} of ${voters} devices approve.`,
              confirmLabel: "Propose removal",
            }
          : {
              title: "Remove this device?",
              message: REMOVAL_MESSAGE,
              confirmLabel: "Remove",
            },
      );
      if (!confirmed) return;
      await revokePeer(setup, peerId);
      await onChanged();
    } catch (reason) {
      showError(
        "Couldn’t remove that device",
        errorMessage(reason, `${peerName} is still paired.`),
      );
    } finally {
      removingRef.current = false;
    }
  };

  /** Adds this device's approval to a removal somebody else proposed: the existing signed path. */
  const approve = async (
    peerId: string,
    peerName: string,
    proposal: SyncStatus["proposals"][number],
  ) => {
    if (approvingRef.current) return;
    approvingRef.current = true;
    try {
      const confirmed = await confirmDestructive({
        title: "Approve this removal?",
        // Only the approval that reaches the quorum removes the device. Any earlier one says what
        // it does instead: it counts toward the removal, which is not carried out yet.
        message:
          proposal.approvals.length + 1 >= proposal.required
            ? REMOVAL_MESSAGE
            : `Your approval counts toward removing ${peerName}. It’s removed once ${proposal.required} of ${proposal.voters.length} devices approve.`,
        confirmLabel: "Approve",
      });
      if (!confirmed) return;
      setApproving(peerId);
      await revokePeer(setup, peerId);
      await onChanged();
      hapticSuccess();
    } catch (reason) {
      showError(
        "Couldn’t approve that removal",
        errorMessage(reason, `${peerName} is still paired.`),
      );
    } finally {
      approvingRef.current = false;
      setApproving(null);
    }
  };

  const changePolicy = async (mode: "any" | "quorum" | "owner") => {
    // The rule governs every paired device at once, so it is confirmed like the other
    // destructive changes on this screen rather than applied on a single tap.
    const confirmed = await confirmDestructive({
      title: "Change who can remove devices?",
      message:
        "This applies to every paired device straight away. Removing a device is forward-only, so this only decides who may stop one from writing to this vault.",
      confirmLabel: "Change rule",
    });
    if (!confirmed) return;
    try {
      await setRevocationPolicy(setup, mode);
      await onChanged();
    } catch (reason) {
      showError(
        "Couldn’t change removal policy",
        errorMessage(reason, "Only the vault owner can change it."),
      );
    }
  };

  const transferOwner = async (peerId: string, peerName: string) => {
    const confirmed = await confirmDestructive({
      title: `Make ${peerName} the vault owner?`,
      message:
        "That device will be the only one able to change the removal policy or transfer ownership again.",
      confirmLabel: "Transfer ownership",
    });
    if (!confirmed) return;
    try {
      await transferVaultOwnership(setup, peerId);
      await onChanged();
    } catch (reason) {
      showError(
        "Couldn’t transfer ownership",
        errorMessage(reason, "The current vault owner must make this change."),
      );
    }
  };

  return (
    <>
      <SectionHeader title="Devices" />
      <Card variant="list" dividerInset={rowDividerInset}>
        <SettingsRow
          // `literal` covers the whole row, so the fixed half is translated here and the
          // user's own device name passes through exactly as they typed it.
          literal
          title={status.deviceName || t("Unnamed device")}
          subtitle={t("This device")}
          icon={deviceIcon(Platform.OS)}
        />
        {peers.map((peer) => {
          const described = describePeer(peer, now);
          const proposal = peer.revokedAt
            ? undefined
            : pending.get(peer.deviceId);
          return (
            <SettingsRow
              key={peer.deviceId}
              literal
              title={peer.name}
              subtitle={t(
                proposal
                  ? `Removal proposed · ${proposal.approvals.length} of ${proposal.required} approvals`
                  : described.subtitle,
              )}
              icon={described.icon}
              tone={peer.revokedAt || proposal ? "danger" : "default"}
              // A tap starts a removal. One that is already proposed is approved from its own
              // button below, so a second tap cannot be mistaken for starting over.
              onPress={
                peer.revokedAt || proposal
                  ? undefined
                  : () => void remove(peer.deviceId, peer.name)
              }
            />
          );
        })}
      </Card>

      {pendingRows.length ? (
        <>
          <SectionHeader title="Pending removals" />
          <Card style={{ gap: space.lg }}>
            {pendingRows.map(({ peer, proposal }) => {
              const approved = proposal.approvals.includes(status.deviceId);
              const canApprove =
                !approved && proposal.voters.includes(status.deviceId);
              return (
                <View key={proposal.id} style={{ gap: space.sm }}>
                  <AppText literal variant="label">
                    {peer.name}
                  </AppText>
                  <AppText variant="caption" muted>
                    {`${proposal.approvals.length} of ${proposal.required} approvals so far`}
                  </AppText>
                  {canApprove ? (
                    <ActionButton
                      title="Approve removal"
                      icon="checkmark"
                      variant="danger"
                      busy={approving === peer.deviceId}
                      disabled={Boolean(approving)}
                      accessibilityLabel={t(`Approve removing ${peer.name}`)}
                      onPress={() =>
                        void approve(peer.deviceId, peer.name, proposal)
                      }
                      style={{ alignSelf: "flex-start" }}
                    />
                  ) : (
                    <AppText variant="caption" muted>
                      {approved
                        ? "This device already approved. It waits for the others."
                        : "Only devices that were in the vault when this was proposed can approve it."}
                    </AppText>
                  )}
                </View>
              );
            })}
          </Card>
        </>
      ) : null}

      <SectionHeader title="Device removal" />
      <Card style={{ gap: space.md }}>
        <AppText variant="label">Who can remove a device</AppText>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          <ChoiceChip
            icon="ion:phone-portrait-outline"
            label="Any device"
            selected={status.revocation.mode === "any"}
            disabled={!isOwner}
            onPress={() => void changePolicy("any")}
          />
          <ChoiceChip
            icon="person.2"
            label="Majority vote"
            selected={status.revocation.mode === "quorum"}
            disabled={!isOwner}
            onPress={() => void changePolicy("quorum")}
          />
          <ChoiceChip
            icon="key"
            label="Vault owner"
            selected={status.revocation.mode === "owner"}
            disabled={!isOwner}
            onPress={() => void changePolicy("owner")}
          />
        </View>
        <AppText variant="caption" muted>
          {status.revocation.mode === "any"
            ? "Any paired device can remove another device immediately."
            : status.revocation.mode === "quorum"
              ? "A removal needs approval from at least half of the devices, including the proposer. With two devices, one approval is enough."
              : "Only the vault owner can remove a device."}
        </AppText>
        {!isOwner ? (
          <AppText variant="caption" muted>
            Only the vault owner can change this policy.
          </AppText>
        ) : null}
        {isOwner && peers.filter((peer) => !peer.revokedAt).length ? (
          <View style={{ gap: space.xs }}>
            <AppText variant="caption" muted>
              Transfer vault ownership
            </AppText>
            <View
              style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}
            >
              {peers
                .filter((peer) => !peer.revokedAt)
                .map((peer) => (
                  <TextButton
                    key={peer.deviceId}
                    title={`Make ${peer.name} owner`}
                    tone="muted"
                    onPress={() => void transferOwner(peer.deviceId, peer.name)}
                  />
                ))}
            </View>
          </View>
        ) : null}
        {pendingRows.length ? (
          <AppText variant="caption" muted>
            A removal is waiting for more approvals. Approve it under Pending
            removals above.
          </AppText>
        ) : null}
      </Card>

      {!status.peers.length ? (
        <EmptyState
          compact
          icon="person.2"
          title="No other devices yet"
          body="Pair a second device and Qashy keeps them in step. You compare a six-word code on both screens first, so nothing is sent to a device you didn’t confirm."
        />
      ) : null}

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: space.sm,
        }}
      >
        <ActionButton
          title="Add device"
          icon="plus"
          onPress={() => router.push("/sync-pair")}
        />
        <TextButton
          title="Rename this device"
          icon="pencil"
          tone="muted"
          accessibilityState={{ expanded: renaming }}
          onPress={() => {
            setName(status.deviceName);
            setRenaming((open) => !open);
          }}
        />
      </View>

      {renaming ? (
        <MotionView variant="up" exit animateLayout style={{ gap: space.md }}>
          <FormField
            label="Device name"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => void save()}
            hint="Only your paired devices ever see this. It is sent encrypted, and the relay never learns it."
          />
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <ActionButton
              title={saving ? "Saving…" : "Save"}
              icon="checkmark"
              disabled={saving || !name.trim()}
              busy={saving}
              onPress={() => void save()}
            />
            <TextButton
              title="Cancel"
              tone="muted"
              onPress={() => setRenaming(false)}
            />
          </View>
        </MotionView>
      ) : null}

      {status.peers.some((peer) => peer.revokedAt) ? (
        <AppText variant="caption" muted>
          Removed devices stay listed so your history keeps its author. They can
          no longer send or receive changes.
        </AppText>
      ) : null}
    </>
  );
}
