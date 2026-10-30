/**
 * Backup, restore, and sneakernet.
 *
 * Three flows live on one screen because from the user's side they are one thing: getting a
 * vault off this device, and getting one back onto a device that has nothing.
 *
 * It exists to close a gap the recovery phrase cannot close alone. The phrase recovers the
 * **key**, not the data — every frame waiting in the drop-box is sealed to a specific device
 * id and would not open for a replacement device, and the drop-box holds a fortnight of
 * deltas rather than a vault. Twenty-four words and no archive restore nothing. This screen is
 * what makes writing them down worth doing.
 *
 * Two rules shape the layout, and both are load-bearing rather than cosmetic:
 *
 * - **Restore is what an unpaired device needs; export is what a paired one needs.** They are
 *   never offered together. Restoring onto a live vault would overwrite the thing being backed
 *   up, and `restoreVaultBackup` refuses it — so the screen says so up front instead of letting
 *   the user discover it from an error at the end of a long flow.
 * - **Nothing is written until it has been read.** A file is decrypted, summarized, and shown —
 *   when it was made, which device made it, how many transactions it holds — before one row is
 *   replaced. The same preview-then-commit shape the CSV screen uses, for a stronger reason:
 *   this is the one genuinely irreversible button in the whole feature.
 *
 * The `.qashysync` half is the transport that involves nobody: no relay and no signaling.
 * It is the answer when the relay is down, when no relay is configured at all, and
 * for anyone who would simply rather no server existed.
 */

import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { ActionButton } from "@/components/ui/action-button";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { FormField } from "@/components/ui/form-field";
import { FormScreen } from "@/components/ui/form-screen";
import { MotionView } from "@/components/ui/motion";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusPill } from "@/components/ui/status-pill";
import { livePeers } from "@/features/sync/sync-summary";
import { saveFile } from "@/features/shared/save-file";
import { useLocalization } from "@/localization/localization";
import { useFinanceRepository } from "@/providers/finance-provider";
import { useSync } from "@/providers/sync-provider";
import {
  BACKUP_MIME,
  backupFileName,
  exportVaultBackup,
  readBackupLock,
  readVaultBackup,
  restoreVaultBackup,
  type BackupKeySource,
  type VaultArchive,
} from "@/sync/backup";
import {
  MIN_PASSPHRASE_LENGTH,
  PASSPHRASE_WEAKNESS_MESSAGES,
  RECOVERY_WORD_COUNT,
  assessPassphrase,
  isValidRecoveryPhrase,
} from "@/sync/crypto";
import type {
  BundleExport,
  BundleImport,
  SyncPassReason,
} from "@/sync/runtime";
import { BUNDLE_MIME, bundleFileName } from "@/sync/transport/file";
import { useQashyTheme } from "@/theme/theme";
import {
  confirmDestructive,
  errorMessage,
  showError,
  showNotice,
} from "@/utils/confirm";
import { todayLocal } from "@/utils/date";
import { hapticSuccess } from "@/services/haptics";
import { Preview, Tally } from "@/features/sync/transfer/transfer-previews";
import { Busy, PickedBackup } from "@/features/sync/transfer/transfer-types";
import { pickBytes, pickText } from "@/features/sync/transfer/pick-files";
import {
  nextBackupPhase,
  type BackupPhase,
} from "@/features/sync/transfer/backup-phase";

/**
 * Why a `.qashysync` pass did nothing, in the user's terms.
 *
 * The runtime's `SyncPassReason` is deliberately not a message — the same reason reads
 * differently on a screen offering to pair than on one offering to unlock.
 */
const BUNDLE_REASONS: Record<Exclude<SyncPassReason, "ok">, string> = {
  disabled:
    "Sync is paused on this device. Resume it from the sync screen, then try again.",
  unpaired:
    "This device is not part of a vault, so there is nothing to send or receive.",
  locked:
    "This device’s key is locked. Unlock it from the sync screen and try again.",
  unavailable:
    "This device can’t read its stored key, so nothing can be sealed or opened.",
};

/** Paused or unpaired is nothing to act on; a locked or unreadable key is a failure worth a buzz. */
const isPrecondition = (reason: keyof typeof BUNDLE_REASONS) =>
  reason === "disabled" || reason === "unpaired";

function reportBundleReason(
  title: string,
  reason: keyof typeof BUNDLE_REASONS,
) {
  if (isPrecondition(reason)) showNotice(title, BUNDLE_REASONS[reason]);
  else showError(title, BUNDLE_REASONS[reason]);
}

export function TransferScreen() {
  const { radius, space, tile } = useQashyTheme();
  const { status, refresh, setup, runtime } = useSync();
  const onboardingParam = useLocalSearchParams<{ onboarding?: string }>()
    .onboarding;
  const repository = useFinanceRepository();
  // `t` is only for strings that leave React — the native share sheet's title. Everything
  // rendered through AppText, StatusPill, or the confirm helpers is translated by those.
  const { t } = useLocalization();

  const [busy, setBusy] = useState<Busy>(null);

  // Export
  const [lock, setLock] = useState<BackupKeySource["kind"]>("passphrase");
  const [passphrase, setPassphrase] = useState("");
  const [repeated, setRepeated] = useState("");
  // The save sheet cannot report whether the file landed anywhere, so this is "ready", not
  // "saved", until the person says they have it (see `backup-phase.ts`).
  const [phase, setPhase] = useState<BackupPhase>("idle");

  // Restore
  const [picked, setPicked] = useState<PickedBackup | null>(null);
  const [secret, setSecret] = useState("");
  /**
   * The decrypted archive, held between "Open" and "Restore".
   *
   * This object contains the vault's private keys and every record in it, in the clear. Holding
   * it is the price of a preview step, and the preview is worth it — the alternative is a button
   * that overwrites a device with a file nobody has looked inside. It is dropped the moment the
   * restore finishes or the file is replaced, and, exactly as on the recovery screen, JS cannot
   * promise the bytes are gone.
   */
  const [archive, setArchive] = useState<VaultArchive | null>(null);

  // Sync files
  const [sent, setSent] = useState<BundleExport | null>(null);
  const [received, setReceived] = useState<BundleImport | null>(null);

  if (!status) {
    return (
      <FormScreen maxWidth={720}>
        <AppText muted>Reading this device’s sync state…</AppText>
      </FormScreen>
    );
  }

  const paired = Boolean(status.deviceId);
  // Reached from onboarding's "I already use Qashy": nothing exists here yet, so only the
  // restore half of this screen applies.
  const firstRun = onboardingParam === "1";
  const readable = status.keystore === "unlocked";
  const strength = assessPassphrase(passphrase);
  // Length is already said by the hint, so only the reasons the hint does not cover are shown.
  const strengthError =
    !strength.ok && strength.reason !== "tooShort"
      ? t(PASSPHRASE_WEAKNESS_MESSAGES[strength.reason])
      : undefined;
  const passphraseReady = strength.ok && passphrase === repeated;
  const secretReady =
    picked?.wants === "recoveryPhrase"
      ? isValidRecoveryPhrase(secret)
      : secret.length > 0;

  const run = async (
    kind: Exclude<Busy, null>,
    work: () => Promise<unknown>,
    failure: string,
  ) => {
    if (busy) return;
    setBusy(kind);
    try {
      await work();
    } catch (reason) {
      showError(failure, errorMessage(reason, "Nothing was changed."));
    } finally {
      setBusy(null);
    }
  };

  // -------------------------------------------------------------------------
  // Backup
  // -------------------------------------------------------------------------

  const backup = () =>
    run(
      "backup",
      async () => {
        setPhase((current) => nextBackupPhase(current, "edit"));
        const file = await exportVaultBackup(
          setup,
          lock === "passphrase"
            ? { kind: "passphrase", passphrase }
            : { kind: "recoveryPhrase" },
        );
        await saveFile(
          backupFileName(todayLocal()),
          BACKUP_MIME,
          file,
          t("Save Qashy vault backup"),
        );
        // Handing the file to the platform is not the same as it being saved: a dismissed share
        // sheet resolves identically. So the passphrase stays until the person confirms they
        // have the file (`confirmSaved`), in case they have to export again.
        setPhase((current) => nextBackupPhase(current, "handedOff"));
      },
      "Couldn’t create the backup",
    );

  /**
   * The person says the file is where they want it. Cleared now rather than kept for a second
   * export: a passphrase sitting in a form field is one screenshot, one shoulder, or one
   * handed-over phone away from being the thing that opens the file it protects.
   */
  const confirmSaved = () => {
    setPassphrase("");
    setRepeated("");
    setPhase((current) => nextBackupPhase(current, "confirm"));
    hapticSuccess();
  };

  // -------------------------------------------------------------------------
  // Restore
  // -------------------------------------------------------------------------

  const choose = () =>
    run(
      "open",
      async () => {
        const file = await pickBytes();
        if (!file) return;
        // Once a new file was selected, the old archive must not remain restorable if this one
        // turns out not to be a vault backup.
        setArchive(null);
        setPicked(null);
        setSecret("");
        const wants = readBackupLock(file.bytes);
        if (!wants) {
          showError(
            "That isn’t a Qashy backup",
            "Choose the .qashyvault file you saved from Sync → Backup & transfer.",
          );
          return;
        }
        setPicked({ name: file.name, bytes: file.bytes, wants });
      },
      "Couldn’t read that file",
    );

  const open = () =>
    run(
      "open",
      async () => {
        if (!picked) return;
        const opened = await readVaultBackup(
          picked.bytes,
          picked.wants === "passphrase"
            ? { kind: "passphrase", passphrase: secret }
            : { kind: "recoveryPhrase", phrase: secret },
        );
        // The secret has done its work. Keeping it would leave a recovery phrase in component
        // state for as long as the confirm step is on screen, which is exactly the window
        // somebody walks past.
        setSecret("");
        setArchive(opened);
      },
      "Couldn’t open that backup",
    );

  const restore = async () => {
    if (!archive || busy) return;
    const confirmed = await confirmDestructive({
      title: "Restore this backup?",
      // Named plainly, because this is the one button on the screen that destroys something.
      // "Replaces everything" is the whole truth and it is short enough to read in a dialog.
      message:
        "Everything currently on this device — accounts, transactions, budgets, goals, and schedules — is replaced by what is in this file. This device then continues as the device that made the backup, so do not do this while that device is still in use.",
      confirmLabel: "Restore",
    });
    if (!confirmed) return;
    await run(
      "restore",
      async () => {
        await restoreVaultBackup(setup, archive);
        setArchive(null);
        setPicked(null);
        // The repository is holding a snapshot of the vault that was just replaced underneath
        // it. Refreshing is not a nicety: without it every screen keeps rendering the old one.
        await repository.refresh();
        await refresh();
        hapticSuccess();
        // This is the one moment worth interrupting for — the screen the user lands on next
        // looks the same whether the restore worked or silently did nothing.
        showNotice(
          "Backup restored",
          "Your data is back on this device. Your other devices already know it, so sync continues from where the backup left off.",
        );
        // From onboarding the restored settings have just completed setup, so go straight in.
        router.replace(firstRun ? "/overview" : "/sync");
      },
      "Couldn’t restore that backup",
    );
  };

  // -------------------------------------------------------------------------
  // Sync files
  // -------------------------------------------------------------------------

  const send = () =>
    run(
      "send",
      async () => {
        setSent(null);
        const bundle = await runtime.exportBundle();
        if (bundle.reason !== "ok") {
          reportBundleReason("Nothing to send", bundle.reason);
          return;
        }
        setSent(bundle);
        if (!bundle.frames) return;
        await saveFile(
          bundleFileName(todayLocal()),
          BUNDLE_MIME,
          bundle.text,
          t("Send Qashy changes"),
        );
      },
      "Couldn’t create the sync file",
    );

  const receive = () =>
    run(
      "receive",
      async () => {
        setReceived(null);
        const file = await pickText();
        if (!file) return;
        const outcome = await runtime.importBundle(file);
        if (outcome.reason !== "ok") {
          reportBundleReason("Nothing was applied", outcome.reason);
          return;
        }
        setReceived(outcome);
        await refresh();
        if (outcome.applied) hapticSuccess();
      },
      "Couldn’t import that sync file",
    );

  // -------------------------------------------------------------------------

  return (
    <FormScreen
      maxWidth={720}
      contentContainerStyle={{
        gap: space.lg,
        paddingBottom: space.xxxl + space.sm,
      }}
    >
      <Card style={{ gap: space.md }}>
        <AppText variant="title">
          {firstRun ? "Restore a backup" : "Backup & transfer"}
        </AppText>
        <AppText muted>
          {firstRun
            ? "Open the .qashyvault file you saved from your old device. Everything in it — accounts, history and your vault key — moves onto this one."
            : "A vault backup is a complete, encrypted copy of this device — its key, its records, and its history — in one file you keep. It is the only thing that can put your data on a replacement device when every device you had is gone."}
        </AppText>
      </Card>

      {paired ? (
        <>
          <SectionHeader title="Create a vault backup" />
          <Card style={{ gap: space.md }}>
            {readable ? null : (
              <StatusPill
                label="This device’s key is locked"
                icon="lock"
                tone="warning"
                style={{ borderRadius: radius.control }}
              />
            )}
            <AppText variant="caption" muted>
              Choose what opens the file later. A passphrase is right for a copy
              you store somewhere else; the recovery phrase is right if those
              twenty-four words are already written down and this file will sit
              beside them.
            </AppText>
            <View
              accessibilityLabel={t("How the backup is protected")}
              accessibilityRole="radiogroup"
              style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}
            >
              <ChoiceChip
                label="A passphrase"
                icon="textformat"
                selected={lock === "passphrase"}
                onPress={() => {
                  setLock("passphrase");
                  setPhase("idle");
                }}
              />
              <ChoiceChip
                label="My recovery phrase"
                icon="key"
                selected={lock === "recoveryPhrase"}
                onPress={() => {
                  setLock("recoveryPhrase");
                  setPhase("idle");
                }}
              />
            </View>

            {lock === "passphrase" ? (
              <MotionView
                variant="up"
                exit
                animateLayout
                style={{ gap: space.md }}
              >
                <FormField
                  label="Passphrase"
                  value={passphrase}
                  onChangeText={(value) => {
                    setPassphrase(value);
                    setPhase((current) => nextBackupPhase(current, "edit"));
                  }}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="new-password"
                  hint={t(
                    `At least ${MIN_PASSPHRASE_LENGTH} characters. Qashy cannot reset this — the file is unreadable without it.`,
                  )}
                  error={strengthError}
                />
                <FormField
                  label="Passphrase again"
                  value={repeated}
                  onChangeText={setRepeated}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="new-password"
                  error={
                    repeated && passphrase !== repeated
                      ? "These two do not match."
                      : undefined
                  }
                />
              </MotionView>
            ) : (
              <MotionView variant="up" exit animateLayout>
                <AppText variant="caption" muted>
                  Nothing to type. The file is sealed with the key this device
                  already holds, so the phrase that opens it is this vault’s own
                  — which also means a file written this way cannot be opened by
                  a phrase you mistyped into a box.
                </AppText>
              </MotionView>
            )}

            <ActionButton
              title={busy === "backup" ? "Working…" : "Create backup"}
              icon="tray"
              size="large"
              busy={busy === "backup"}
              disabled={
                Boolean(busy) ||
                !readable ||
                (lock === "passphrase" && !passphraseReady)
              }
              onPress={() => void backup()}
            />
            {phase === "ready" ? (
              <MotionView
                variant="up"
                exit
                animateLayout
                style={{ gap: space.sm }}
              >
                <StatusPill
                  label="Backup ready — make sure you saved it"
                  icon="tray"
                  tone="warning"
                  style={{ borderRadius: radius.control }}
                />
                <AppText variant="caption" muted>
                  Qashy can’t tell whether the file was saved or the save dialog
                  was closed. If it wasn’t saved, create the backup again. Your
                  passphrase stays here until you confirm.
                </AppText>
                <ActionButton
                  title="I’ve saved it"
                  icon="checkmark"
                  variant="secondary"
                  onPress={confirmSaved}
                />
              </MotionView>
            ) : null}
            {phase === "confirmed" ? (
              <MotionView variant="up" exit animateLayout>
                <StatusPill
                  label="Backup saved"
                  icon="checkmark.circle"
                  tone="positive"
                  style={{ borderRadius: radius.control }}
                />
              </MotionView>
            ) : null}
            <AppText variant="caption" muted>
              Treat the file exactly like the recovery phrase: whoever can open
              it can read every account, transaction, and balance you have.
              Storing it somewhere only you can reach is the whole job.
            </AppText>
          </Card>

          <SectionHeader title="Sync with a file" />
          <Card style={{ gap: space.md }}>
            <AppText variant="caption" muted>
              Carry your changes to another of your devices yourself — AirDrop,
              a USB stick, an email to yourself. No relay, no signaling, no
              network of any kind is involved. This is the path when the relay
              is down, or when two devices are never online together.
            </AppText>
            <View
              style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}
            >
              <ActionButton
                title={busy === "send" ? "Sealing…" : "Export changes"}
                icon="square.and.arrow.up"
                busy={busy === "send"}
                disabled={Boolean(busy)}
                onPress={() => void send()}
              />
              <ActionButton
                title={busy === "receive" ? "Applying…" : "Import a sync file"}
                icon="square.and.arrow.down"
                variant="secondary"
                busy={busy === "receive"}
                disabled={Boolean(busy)}
                onPress={() => void receive()}
              />
            </View>

            {sent ? (
              <MotionView
                variant="up"
                exit
                animateLayout
                style={{ gap: space.sm }}
              >
                {sent.frames ? (
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      gap: space.sm,
                    }}
                  >
                    <Tally
                      value={sent.frames}
                      label="Sealed batches"
                      tone="accent"
                    />
                    <Tally value={sent.peers} label="Devices covered" />
                  </View>
                ) : livePeers(status.peers).length ? (
                  <StatusPill
                    label="Every device is already up to date"
                    icon="checkmark.circle"
                    tone="positive"
                    style={{ borderRadius: radius.control }}
                  />
                ) : (
                  <StatusPill
                    label="No other devices yet"
                    icon="person.2"
                    tone="neutral"
                    style={{ borderRadius: radius.control }}
                  />
                )}
                {sent.frames ? (
                  <AppText variant="caption" muted>
                    Exporting again later is harmless. Changes stay queued until
                    a device confirms it received them, so a file that never
                    arrives costs nothing but a second export.
                  </AppText>
                ) : null}
              </MotionView>
            ) : null}

            {received ? (
              <MotionView
                variant="up"
                exit
                animateLayout
                style={{ gap: space.sm }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: space.sm,
                  }}
                >
                  <Tally
                    value={received.applied}
                    label="Changes applied"
                    tone="accent"
                  />
                  <Tally value={received.skipped} label="For another device" />
                  <Tally
                    value={received.rejected}
                    label="Refused"
                    tone={received.rejected ? "negative" : "plain"}
                  />
                </View>
                <AppText variant="caption" muted>
                  Batches meant for a different device in this vault are
                  skipped, not lost — one file carries a share for each of them.
                  Anything refused is recorded on the sync screen with the
                  reason.
                </AppText>
              </MotionView>
            ) : null}
          </Card>
        </>
      ) : (
        <>
          <SectionHeader title="Restore from a backup" />
          <Card style={{ gap: space.md }}>
            <AppText variant="caption" muted>
              Everything currently on this device is replaced by what the file
              holds. The restored device carries on as the one that made the
              backup, so restore onto a replacement — never alongside a device
              that is still in use.
            </AppText>
            <ActionButton
              title={
                picked ? "Choose a different file" : "Choose a backup file"
              }
              icon="folder"
              variant={picked ? "secondary" : "primary"}
              size="large"
              busy={busy === "open" && !picked}
              disabled={Boolean(busy)}
              onPress={() => void choose()}
            />

            {picked && !archive ? (
              <MotionView
                variant="up"
                exit
                animateLayout
                style={{ gap: space.md }}
              >
                <StatusPill
                  label={picked.name}
                  icon="doc"
                  tone="neutral"
                  literal
                  style={{ borderRadius: radius.control }}
                />
                {picked.wants === "passphrase" ? (
                  <FormField
                    label="Passphrase"
                    value={secret}
                    onChangeText={setSecret}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    hint="The passphrase you chose when this backup was created."
                  />
                ) : (
                  <FormField
                    label="Recovery phrase"
                    value={secret}
                    onChangeText={setSecret}
                    multiline
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    spellCheck={false}
                    numberOfLines={4}
                    style={{ minHeight: tile.size * 2 + space.lg }}
                    hint={`All ${RECOVERY_WORD_COUNT} words, separated by spaces.`}
                  />
                )}
                <ActionButton
                  title={busy === "open" ? "Opening…" : "Open backup"}
                  icon="lock.open"
                  size="large"
                  busy={busy === "open"}
                  disabled={Boolean(busy) || !secretReady}
                  onPress={() => void open()}
                />
              </MotionView>
            ) : null}

            {archive ? (
              <Preview
                archive={archive}
                busy={busy}
                onRestore={() => void restore()}
              />
            ) : null}
          </Card>

          <Card>
            <AppText variant="caption" muted>
              No backup file? A device that still has your data can add this one
              from Sync → Add a device instead, which copies the vault across
              without a file at all.
            </AppText>
          </Card>
        </>
      )}
    </FormScreen>
  );
}
