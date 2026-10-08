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
 *   to avoid. (`useNow` does keep a display clock ticking, but it talks to nothing.)
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
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { TextButton } from "@/components/ui/text-button";
import { DeviceCard } from "@/features/sync/device-card";
import { RelayCard } from "@/features/sync/relay-card";
import { describeActivity, summarizeSync } from "@/features/sync/sync-summary";
import { useLocalization } from "@/localization/localization";
import { useSync } from "@/providers/sync-provider";
import { disableSync, resumeSync, rotateVaultKey } from "@/sync/setup";
import type { RelayHealth } from "@/sync/transport/relay-health";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import type { SpaceScale } from "@/theme/themes/types";
import { confirmDestructive, errorMessage, showError } from "@/utils/confirm";
import { relativeTime } from "@/utils/relative-time";
import { useNow } from "@/utils/use-now";

/** Which long-running action owns the screen, so two cannot be started at once. */
type Busy = "pause" | "resume" | "rotate" | "leave" | null;

export function SyncScreen() {
  const { status, syncing, error, refresh, reconcile, checkRelay, setup } =
    useSync();
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const rowDividerInset = 38 + space.md;
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
        contentInsetAdjustmentBehavior="automatic"
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
  ) => {
    // A ref, not `busy`: a second tap inside the same render would still see the old state.
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    let acted = false;
    try {
      await work();
      acted = true;
      await refresh();
    } catch (reason) {
      // Only the action can claim "nothing was changed". Once it has succeeded, a failed refresh
      // leaves the change in place and the message has to say so.
      if (acted) {
        showError(
          "This change was saved",
          errorMessage(reason, "Reopen this screen to see the current state."),
        );
      } else {
        showError(failure, errorMessage(reason, "Nothing was changed."));
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const rotate = async () => {
    const confirmed = await confirmDestructive({
      title: "Replace the vault key?",
      // The cost is the headline, not a footnote. Someone doing this after losing a phone needs
      // to know before they start that they will be re-pairing everything they still own.
      message:
        "Every device is removed and must be paired again, including this one’s partners. Do this when a device is lost: it makes the copy of the drop-box that device knows about unreadable to it.",
      confirmLabel: "Replace key",
    });
    if (!confirmed) return;
    await run(
      "rotate",
      () => rotateVaultKey(setup),
      "Couldn’t replace the vault key",
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
      () => disableSync(setup, { forget: true }),
      "Couldn’t leave the vault",
    );
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={containerStyle(space)}
      refreshControl={
        <RefreshControl
          refreshing={syncing}
          onRefresh={() => void reconcile()}
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
                  width: 64,
                  height: 64,
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
                size={28}
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
                disabled={syncing}
                onPress={() => void reconcile()}
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
            <AppText variant="label" style={{ color: theme.negative }}>
              The last sync didn’t finish
            </AppText>
            {/* The engine's own message, verbatim. It is transport-level by construction and it
                is the only thing here that tells a self-hoster which layer failed. */}
            <AppText literal selectable variant="caption" muted>
              {error}
            </AppText>
            <AppText variant="caption" muted>
              Your data is untouched, and the next sync retries on its own.
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

      <SectionHeader title="How this works" />
      <Card style={{ gap: space.md }}>
        <Explains icon="lock.shield" title="Only your devices can read it">
          Every change is sealed on the device that made it, with a key that
          exists only on devices you paired in person. Nothing else can open it.
        </Explains>
        <Explains
          icon="antenna.radiowaves.left.and.right"
          title="A blind drop-box in between"
        >
          When your other device is closed, sealed changes wait on a relay. It
          sees a random-looking address and padded ciphertext — never who you
          are, what changed, or how much you have.
        </Explains>
        <Explains icon="key" title="No account, ever">
          There is no sign-in, no server-side identity, and nothing to recover
          through us. The recovery phrase is the only key.
        </Explains>
      </Card>

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
                    // `literal` is all-or-nothing, so the fixed halves are translated here and
                    // `detail` — a transport-level string from the engine — passes through raw.
                    literal
                    title={t(described.title)}
                    subtitle={row.detail || undefined}
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
    padding: 18,
    paddingBottom: 40,
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

/**
 * One claim about the system, with the glyph that makes a scanned list readable.
 *
 * This card is the feature's central promise written down where the feature lives, rather than
 * in a help page nobody opens. If any line here stops being true, the line is the bug.
 */
function Explains({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: string;
}) {
  const { radius, space } = useQashyTheme();
  return (
    <View style={{ gap: space.xs }}>
      <StatusPill
        label={title}
        icon={icon}
        tone="neutral"
        style={{ borderRadius: radius.control }}
      />
      <AppText variant="caption" muted>
        {children}
      </AppText>
    </View>
  );
}
