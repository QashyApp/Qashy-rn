/**
 * The whole of sync, on one screen.
 *
 * Sync is the only feature in Qashy whose correctness a user cannot see by looking at their
 * data. A wrong balance is visible; a device that quietly stopped receiving changes three weeks
 * ago is not, and neither is a relay that has been refusing uploads since a redeploy. So this
 * screen is built to be *readable when something is wrong*, which drives every decision here:
 *
 * - **One verdict, computed once.** The hero, the More row, and the relay pill all descend from
 *   `summarizeSync` and one `RelayHealth` value held here. Two components deriving "is this
 *   fine?" independently is how a screen ends up saying "Up to date" above "Unreachable".
 * - **Every state says what still works.** A relay outage is not a sync outage — a transfer
 *   file never needed the relay — and copy that blurs the two sends people to restart routers
 *   over nothing.
 * - **Nothing here contacts the network on a schedule.** The relay is measured on foreground,
 *   on pull-to-refresh, and on the two explicit buttons — never on a timer. A relay contacted on
 *   a schedule is itself a traffic pattern, which is the thing the design went to some trouble
 *   to avoid. (`useNow` does keep a display clock ticking, but it talks to nothing.) The one
 *   exception is the Android-only, per-device "Sync in the background" switch, off by default
 *   and worded to say the relay can see when the device checks in.
 * - **The irreversible actions are last, spelled out, and confirmed.** Rotating the key unpairs
 *   every device; leaving the vault cannot be undone from here. Both say so in the dialog rather
 *   than in a tooltip.
 */

import { router } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

import { ActionButton } from "@/components/ui/action-button";
import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { MotionView } from "@/components/ui/motion";
import { SectionHeader } from "@/components/ui/section-header";
import { SettingsRow } from "@/components/ui/settings-row";
import type { StatusTone } from "@/components/ui/status-pill";
import { TextButton } from "@/components/ui/text-button";
import { BackgroundSyncCard } from "@/features/sync/background-sync-card";
import { DeviceCard } from "@/features/sync/device-card";
import { RelayCard } from "@/features/sync/relay-card";
import { describeActivity, summarizeSync } from "@/features/sync/sync-summary";
import { useLocalization } from "@/localization/localization";
import { useSync } from "@/providers/sync-provider";
import { ROTATION_INTERRUPTED_MESSAGE } from "@/sync/rotation";
import { disableSync, resumeSync, rotateVaultKey } from "@/sync/setup";
import type { RelayHealth } from "@/sync/transport/relay-health";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import type { SpaceScale } from "@/theme/themes/types";
import { confirmDestructive, errorMessage, showError } from "@/utils/confirm";
import { hapticSuccess } from "@/services/haptics";
import { relativeTime } from "@/utils/relative-time";
import { useNow } from "@/hooks/use-now";

/** Which long-running action owns the screen, so two cannot be started at once. */
type Busy = "pause" | "resume" | "rotate" | "leave" | null;

export function SyncScreen() {
  const {
    status,
    syncing,
    error,
    pass,
    clearError,
    refresh,
    reconcile,
    checkRelay,
    setup,
  } = useSync();
  const theme = useQashyTheme();
  const { radius, space, tile, iconSize } = theme;
  const rowDividerInset = tile.size + space.md;
  const { t } = useLocalization();

  /**
   * The last measured relay verdict.
   *
   * Held here rather than read from `status.relay` because the cached verdict deliberately
   * never persists `offline` — that describes this device's moment, not the endpoint, and
   * replaying it after a flight would blame the relay for a tunnel. A live probe is the only
   * source of that state, so it has to survive here between renders.
   */
  const [probed, setProbed] = useState<RelayHealth | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const busyRef = useRef(false);
  // A manual sync that did nothing, so the person who asked is told why instead of watching the
  // spinner stop. Set from that attempt's own result; nothing schedules it.
  const [skipped, setSkipped] = useState(false);

  // Read once per render, and passed down. Every relative time on the screen then agrees with
  // every other one, which a per-component clock read cannot promise. Above the early return
  // because it is a hook, so it has to run on the loading render too.
  const now = useNow();

  const check = useCallback(async () => {
    setProbed(await checkRelay());
  }, [checkRelay]);

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

  // An endpoint change invalidates the probe rather than ageing it: a verdict about the old
  // address says nothing about the new one, and showing it would be a stale answer to a
  // question the user just changed.
  const health =
    probed && probed.endpoint === status.relay.endpoint ? probed : status.relay;
  const summary = summarizeSync(status, { now, relay: health });
  const paired = Boolean(status.deviceId);

  const run = async (
    kind: Exclude<Busy, null>,
    work: () => Promise<unknown>,
    failure: string,
    /** The user already confirmed a destructive dialog, which buzzed; a second buzz would stack. */
    confirmed = false,
  ) => {
    // A ref, not `busy`: a second tap inside the same render would still see the old state.
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    setSkipped(false);
    let acted = false;
    try {
      await work();
      acted = true;
      await refresh();
      if (!confirmed) hapticSuccess();
    } catch (reason) {
      // Only the action can claim "nothing was changed". Once it has succeeded, a failed refresh
      // leaves the change in place and the message has to say so.
      if (acted) {
        showError(
          "This change was saved",
          errorMessage(reason, "Reopen this screen to see the current state."),
          { quiet: true },
        );
      } else {
        showError(failure, errorMessage(reason, "Nothing was changed."));
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  /** The provider reports a failed pass on its own banner, so only a finished one buzzes here. */
  const syncNow = async () => {
    // A rotation replaces the key and epoch a pass seals under (and runs in the same queue as the
    // passes), so nothing here starts one while it owns the screen. The ref covers a tap that
    // lands before the next render; pull-to-refresh arrives here too.
    if (busyRef.current) return;
    setSkipped(false);
    if (await reconcile()) hapticSuccess();
    else setSkipped(true);
  };

  const rotate = async () => {
    const confirmed = await confirmDestructive({
      title: "Replace the vault key?",
      // The cost is the headline, not a footnote. Someone doing this after losing a phone needs
      // to know before they start that they will be re-pairing everything they still own.
      message:
        "Every other device is removed from the vault and has to be paired with this one again. Do this when a device is lost: it makes the copy of the drop-box that device knows about unreadable to it.",
      confirmLabel: "Replace key",
    });
    if (!confirmed) return;
    await run(
      "rotate",
      // Serialized with sync passes inside `rotateVaultKey` itself (the pass lock). The new key
      // resolves an interrupted rotation, and no pass follows that could clear its banner.
      async () => {
        await rotateVaultKey(setup);
        clearError();
      },
      "Couldn’t replace the vault key",
      true,
    );
  };

  const leave = async () => {
    const confirmed = await confirmDestructive({
      title: "Leave this vault?",
      message:
        "This device stops syncing and forgets the vault key. Your accounts, transactions, budgets, and goals stay exactly as they are on this device. Your other devices keep syncing with each other.",
      confirmLabel: "Leave vault",
    });
    if (!confirmed) return;
    await run(
      "leave",
      async () => {
        await disableSync(setup, { forget: true });
        // Whatever the last pass reported belongs to a vault this device is no longer in.
        clearError();
      },
      "Couldn’t leave the vault",
      true,
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={containerStyle(space)}
      refreshControl={
        <RefreshControl
          refreshing={syncing}
          onRefresh={() => void syncNow()}
          tintColor={theme.accent}
        />
      }
    >
      <MotionView>
        {/* `accessibilityLiveRegion` is why the hero is one node: a state change here is the
            single thing on the screen worth interrupting a screen reader for. */}
        <Card accessibilityLiveRegion="polite" style={{ gap: space.md }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.lg,
            }}
          >
            {/* A sunken well, not a tinted fill — tone lives in the icon color
                beside it, never in the well itself, so this reads correctly under the same
                "icon plus text, never color alone" rule `StatusPill` follows. */}
            <View
              style={[
                {
                  width: tile.size + space.xxl,
                  height: tile.size + space.xxl,
                  borderRadius: radius.pill,
                  alignItems: "center",
                  justifyContent: "center",
                },
                materialStyle(theme, "sunken"),
              ]}
            >
              <AppIcon
                name={summary.icon}
                color={toneColor(theme, summary.tone)}
                size={iconSize.xl}
              />
            </View>
            <View style={{ flex: 1, gap: space.xxs, minWidth: 0 }}>
              <AppText variant="title">{summary.headline}</AppText>
            </View>
          </View>
          <AppText muted>{summary.body}</AppText>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              gap: space.sm,
              paddingTop: space.xs,
            }}
          >
            {paired && status.enabled ? (
              <ActionButton
                title={syncing ? "Syncing…" : "Sync now"}
                icon="arrow.triangle.2.circlepath"
                busy={syncing}
                disabled={syncing || Boolean(busy)}
                onPress={() => void syncNow()}
              />
            ) : (
              <ActionButton
                title={paired ? "Resume sync" : "Set up sync"}
                icon={paired ? "arrow.clockwise" : "plus"}
                busy={busy === "resume"}
                disabled={Boolean(busy)}
                onPress={
                  paired
                    ? () =>
                        void run(
                          "resume",
                          () => resumeSync(setup),
                          "Couldn’t resume sync",
                        )
                    : () => router.push("/sync-pair")
                }
              />
            )}
            {paired && status.enabled ? (
              <TextButton
                title="Pause"
                icon="pause.circle"
                tone="muted"
                disabled={Boolean(busy)}
                onPress={() =>
                  void run(
                    "pause",
                    () => disableSync(setup),
                    "Couldn’t pause sync",
                  )
                }
              />
            ) : null}
          </View>
          {paired && status.enabled ? (
            <AppText variant="caption" muted>
              Pause stops this device sending and receiving changes until you
              resume. Your data stays here.
            </AppText>
          ) : null}
          {skipped && !error && !syncing && pass && pass.reason !== "ok" ? (
            <AppText variant="caption" muted accessibilityLiveRegion="polite">
              {/* Chosen from this device's own state: a pass on a device that was never set up
                  reports "disabled" before it checks for a vault. */}
              {pass.reason === "disabled" && paired
                ? "Sync is paused on this device, so nothing was sent or received. Resume sync to continue."
                : pass.reason === "disabled" || pass.reason === "unpaired"
                  ? "This device isn’t paired with another device yet, so there was nothing to sync."
                  : "Sync didn’t run on this device. The status above says why."}
            </AppText>
          ) : null}
          {status.pending ? (
            <AppText variant="caption" muted>
              Some changes on this device are still being signed. They go out on
              the next sync.
            </AppText>
          ) : null}
        </Card>
      </MotionView>

      {error ? (
        <MotionView key={error} variant="up" exit animateLayout>
          <Card style={{ gap: space.xs, borderColor: theme.negative }}>
            <AppText variant="label" style={{ color: theme.negativeText }}>
              The last sync didn’t finish
            </AppText>
            {/* The engine's own message, translated when the dictionary knows it and otherwise as
                written: it is transport-level by construction and it is what tells a self-hoster
                which layer failed. */}
            <AppText literal selectable variant="caption" muted>
              {t(error)}
            </AppText>
            {/* An interrupted rotation does not retry: every pass refuses until the person picks
                one of the two Danger zone exits, so say that instead of promising a retry. Those
                exits exist only while paired. */}
            <AppText variant="caption" muted>
              {paired && error === ROTATION_INTERRUPTED_MESSAGE
                ? "Syncing stays stopped on this device until you use “Replace the vault key” or “Leave this vault” in the Danger zone below."
                : paired
                  ? "Your data is untouched, and the next sync retries on its own."
                  : "Your data is untouched."}
            </AppText>
          </Card>
        </MotionView>
      ) : null}

      {paired ? (
        <DeviceCard status={status} now={now} onChanged={refresh} />
      ) : null}

      {/* Outside the paired guard on purpose, and high on the page. A device with nothing on it
          is exactly the device that needs restoring, and burying the one path back from "I lost
          every device" underneath the setup flow would make it findable only by someone who did
          not need it. Pairing is still the primary action above; this is the other way in. */}
      {!paired ? (
        <Card variant="list" dividerInset={rowDividerInset}>
          <SettingsRow
            title="Restore from a backup"
            subtitle="Put an encrypted vault backup onto this device."
            icon="arrow.down.circle"
            onPress={() => router.push("/sync-transfer")}
          />
        </Card>
      ) : null}

      <RelayCard
        status={status}
        health={health}
        now={now}
        onCheck={check}
        onChanged={refresh}
      />

      {paired ? <BackgroundSyncCard status={status} /> : null}

      {paired ? (
        <>
          <SectionHeader title="Activity" />
          <Card variant="list" dividerInset={rowDividerInset}>
            {status.activity.length ? (
              status.activity.map((row) => {
                const described = describeActivity(row);
                return (
                  <SettingsRow
                    key={row.key}
                    // `literal` is all-or-nothing, so each half is translated here: `detail` is a
                    // transport-level string from the engine, shown as written when unknown.
                    literal
                    title={t(described.title)}
                    subtitle={row.detail ? t(row.detail) : undefined}
                    value={t(relativeTime(row.recordedAt, now))}
                    icon={described.icon}
                    tone={described.tone === "negative" ? "danger" : "default"}
                  />
                );
              })
            ) : (
              <View style={{ paddingVertical: space.md }}>
                <AppText variant="caption" muted>
                  Sends, receives, and anything refused will appear here.
                </AppText>
              </View>
            )}
          </Card>
          <AppText variant="caption" muted>
            The log records how much moved and in which direction — never what
            changed. It is safe to share when asking for help.
          </AppText>

          <SectionHeader title="Recovery" />
          <Card variant="list" dividerInset={rowDividerInset}>
            <SettingsRow
              title="Recovery phrase"
              subtitle="Twenty-four words that are the vault. Anyone holding them holds your data."
              icon="key"
              onPress={() => router.push("/sync-recovery")}
            />
            {/* Beside the phrase rather than in its own section, because the two are one plan:
                the words recover the key and this recovers the data, and neither is a disaster
                plan on its own. */}
            <SettingsRow
              title="Backup & transfer"
              subtitle="Save an encrypted copy of this device, or move changes by file."
              icon="tray"
              onPress={() => router.push("/sync-transfer")}
            />
          </Card>

          <SectionHeader title="Danger zone" />
          <Card variant="list" dividerInset={rowDividerInset}>
            <SettingsRow
              title="Replace the vault key"
              subtitle="For a lost device. Every device must be paired again."
              icon="lock"
              tone="danger"
              value={busy === "rotate" ? t("Replacing…") : undefined}
              disabled={Boolean(busy)}
              onPress={() => void rotate()}
            />
            <SettingsRow
              title="Leave this vault"
              subtitle="Stop syncing and forget the key. Your finance data stays on this device."
              icon="trash"
              tone="danger"
              value={busy === "leave" ? t("Leaving…") : undefined}
              disabled={Boolean(busy)}
              onPress={() => void leave()}
            />
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

const containerStyle = (space: SpaceScale) =>
  ({
    padding: space.lg,
    paddingBottom: space.xxxl + space.sm,
    gap: space.lg,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  }) as const;

/** The same tone → color mapping `StatusPill` uses internally, for the hero's icon well. */
function toneColor(theme: ReturnType<typeof useQashyTheme>, tone: StatusTone) {
  if (tone === "transfer") return theme.transfer;
  return {
    neutral: theme.textMuted,
    positive: theme.positive,
    warning: theme.warning,
    negative: theme.negative,
  }[tone];
}
