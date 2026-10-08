/**
 * Where this device is willing to send bytes, and whether that place is answering.
 *
 * The user's explicit ask for this feature was "so I can understand if the relay is down",
 * and everything here follows from taking that literally. The three questions it has to
 * answer, in the order somebody asks them:
 *
 * 1. **Is it up?** — a pill with an icon and a word, plus when that verdict was measured, plus
 *    a button to measure it again now. A status with no timestamp is a status nobody can
 *    trust; a status with no way to re-check is one that makes people reload the app.
 * 2. **Does it matter?** — every failing state says what still works. A relay outage does not
 *    stop a transfer file, and a screen that implies otherwise sends the user to fix
 *    infrastructure when there is another way through.
 * 3. **What do I fix?** — the raw transport error, verbatim and selectable. This is the one
 *    place in the app where an unpolished string is the right answer: whoever runs the relay
 *    needs to know whether it was DNS, TLS, a 502, or a refused write token, and a friendly
 *    paraphrase of all four is worth nothing.
 *
 * The endpoint fields are validated with the same pure functions the storage layer uses, run
 * per field before saving, so an error lands under the box that caused it rather than in one
 * combined message under the button.
 */

import { useRef, useState } from "react";
import { View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { QashySwitch } from "@/components/ui/qashy-switch";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { MotionView } from "@/components/ui/motion";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusPill } from "@/components/ui/status-pill";
import { TextButton } from "@/components/ui/text-button";
import { describeRelay } from "@/features/sync/sync-summary";
import { useLocalization } from "@/localization/localization";
import { useSync } from "@/providers/sync-provider";
import { setEndpoints, type SyncStatus } from "@/sync/setup";
import {
  EndpointError,
  normalizeEndpointUrl,
  type EndpointPatch,
} from "@/sync/transport/endpoints";
import type { RelayHealth } from "@/sync/transport/relay-health";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import { errorMessage, showError } from "@/utils/confirm";
import { relativeTime } from "@/utils/relative-time";

/** The states where the raw transport error is worth more than the summary above it. */
const FAILING = new Set(["unreachable", "unauthorized", "degraded"]);

export function RelayCard({
  status,
  health,
  now,
  onCheck,
  onChanged,
}: {
  readonly status: SyncStatus;
  /** The freshest verdict — a live probe if one has been taken, else the cached one. */
  readonly health: RelayHealth;
  readonly now: number;
  /**
   * Measures the relay now.
   *
   * Owned by the screen rather than by this card, because the hero above reports the same
   * verdict and the two must never disagree. A live probe is also the only way `offline` ever
   * reaches a screen — the cached verdict deliberately refuses to persist it — so the result
   * has to live somewhere both readers can see.
   */
  readonly onCheck: () => Promise<void>;
  readonly onChanged: () => Promise<void>;
}) {
  const { setup } = useSync();
  const theme = useQashyTheme();
  const { radius, space } = theme;

  const [advanced, setAdvanced] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  // Refs for the in-flight checks: state is stale inside a double tap.
  const checkingRef = useRef(false);
  const savingRef = useRef(false);

  const { endpoints } = status;
  // `null` means the user is not editing, so the field follows the saved address (a change from
  // elsewhere, or the save that just landed). A string is an unsaved draft that wins until saved.
  const [draftRelay, setDraftRelay] = useState<string | null>(null);
  const relayUrl = draftRelay ?? endpoints.relayUrl;
  const [error, setError] = useState<string | undefined>();

  const relay = describeRelay(health);
  const checked = relativeTime(health.checkedAt, now);

  const patch = async (change: EndpointPatch) => {
    try {
      await setEndpoints(setup, change);
      await onChanged();
    } catch (reason) {
      showError(
        "Couldn’t save that",
        errorMessage(reason, "Check the address and try again."),
      );
    }
  };

  const check = async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    try {
      await onCheck();
    } catch (reason) {
      // A failed probe is a verdict, not an error — it comes back as `unreachable` and lands in
      // the pill. Reaching here means something above the probe broke, and swallowing it would
      // leave the button looking like it did nothing at all.
      showError(
        "Couldn’t reach the relay",
        errorMessage(reason, "Try again in a moment."),
      );
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  };

  /** Validated before saving, so the error lands under the box rather than in a dialog. */
  const save = async () => {
    if (savingRef.current) return;
    try {
      normalizeEndpointUrl(relayUrl);
      setError(undefined);
    } catch (reason) {
      setError(
        reason instanceof EndpointError
          ? reason.message
          : "That address is not valid.",
      );
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      await setEndpoints(setup, { relayUrl });
      setDraftRelay(null);
      await onChanged();
    } catch (reason) {
      showError(
        "Couldn’t save these addresses",
        errorMessage(reason, "Check them and try again."),
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <>
      <SectionHeader title="Connections" />
      <Card style={{ gap: space.lg }}>
        {!status.enabled ? (
          <AppText variant="caption" muted>
            These are preferences only. Nothing connects until sync is turned
            on.
          </AppText>
        ) : null}
        <ToggleRow
          title="Relay server"
          body="Holds sealed changes for a device that is closed. It can never read them."
          value={endpoints.relayEnabled}
          onValueChange={(value) => void patch({ relayEnabled: value })}
        />

        {/* The answer to "is it down". Deliberately below the switch it describes, so the
            reading order is "relay: on, and it is unreachable" rather than the reverse. */}
        <View
          accessibilityLiveRegion="polite"
          style={{
            flexDirection: "row",
            alignItems: "center",
            flexWrap: "wrap",
            gap: space.sm,
          }}
        >
          <StatusPill label={relay.label} icon={relay.icon} tone={relay.tone} />
          {/* One assembled string, not two children: `AppText` translates whole strings, and a
              split "Checked" + time would leave the dictionary with a bare fragment to match. */}
          {checked ? (
            <AppText variant="caption" muted>{`Checked ${checked}`}</AppText>
          ) : null}
          <View style={{ flex: 1 }} />
          <TextButton
            title={checking ? "Checking…" : "Check now"}
            icon="arrow.clockwise"
            disabled={checking || !endpoints.relayUrl}
            onPress={() => void check()}
          />
        </View>

        {!endpoints.relayUrl ? (
          <AppText variant="caption" muted>
            No relay address is set, so this device only syncs through transfer
            files you carry yourself.
          </AppText>
        ) : null}

        {FAILING.has(health.status) && health.detail ? (
          <MotionView key={health.detail} variant="up" exit animateLayout>
            <View
              style={[
                {
                  borderRadius: radius.tile,
                  borderCurve: "continuous",
                  padding: space.md,
                  gap: space.xs,
                },
                materialStyle(theme, "sunken"),
              ]}
            >
              <AppText variant="caption" muted>
                What the server said
              </AppText>
              {/* Verbatim and selectable. Whoever runs this relay needs the actual error. */}
              <AppText literal selectable variant="caption">
                {health.detail}
              </AppText>
            </View>
          </MotionView>
        ) : null}

        <TextButton
          title={advanced ? "Hide addresses" : "Change addresses"}
          icon={advanced ? "chevron.down" : "chevron.right"}
          tone="muted"
          accessibilityState={{ expanded: advanced }}
          style={{ alignSelf: "flex-start" }}
          onPress={() => setAdvanced((open) => !open)}
        />

        {advanced ? (
          <MotionView variant="up" exit animateLayout style={{ gap: space.lg }}>
            <FormField
              label="Relay address"
              value={relayUrl}
              onChangeText={(value) => setDraftRelay(value)}
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="url"
              placeholder="https://sync.example.com"
              error={error}
              hint="Leave this blank to contact nothing and sync only through transfer files."
            />
            <TextButton
              title={saving ? "Saving…" : "Save addresses"}
              icon="checkmark"
              disabled={saving}
              style={{ alignSelf: "flex-start" }}
              onPress={() => void save()}
            />
          </MotionView>
        ) : null}
      </Card>
    </>
  );
}

/** A switch with its own explanation, because it is not self-evident. */
function ToggleRow({
  title,
  body,
  value,
  onValueChange,
}: {
  readonly title: string;
  readonly body: string;
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
}) {
  const { space } = useQashyTheme();
  const { t } = useLocalization();
  return (
    <View
      style={{ flexDirection: "row", alignItems: "flex-start", gap: space.lg }}
    >
      <View style={{ flex: 1, gap: space.xxs }}>
        <AppText variant="label">{title}</AppText>
        <AppText variant="caption" muted>
          {body}
        </AppText>
      </View>
      <QashySwitch
        accessibilityLabel={t(title)}
        value={value}
        onValueChange={onValueChange}
      />
    </View>
  );
}
