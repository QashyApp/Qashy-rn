import { useState } from "react";
import { View } from "react-native";

import { QrCode } from "@/components/sync/qr-code";
import { ActionButton } from "@/components/ui/action-button";
import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { MotionView } from "@/components/ui/motion";
import { StatusPill } from "@/components/ui/status-pill";
import { TextButton } from "@/components/ui/text-button";
import { useLocalization } from "@/localization/localization";
import { formatPairingCodeForTyping } from "@/sync/crypto";
import { useQashyTheme } from "@/theme/theme";
import {
  DisplayedPairingCode,
  TYPED_CODE_HINT,
} from "@/features/sync/pair/pair-model";
import { SunkenWell } from "@/features/sync/pair/pair-primitives";

export function HostCodeStep({
  code,
  remaining,
  onRestart,
}: {
  readonly code: DisplayedPairingCode | null;
  readonly remaining: number;
  readonly onRestart: () => void;
}) {
  const theme = useQashyTheme();
  const { space } = theme;
  const { t } = useLocalization();
  const [showTyped, setShowTyped] = useState(false);
  const expired = remaining <= 0;

  if (!code) return <AppText muted>Preparing a code…</AppText>;

  return (
    <>
      <AppText variant="title">Scan this on the other device</AppText>
      <AppText muted>
        Open Qashy there, go to More → Sync → Add device, and choose “Add this
        device to a vault”.
      </AppText>

      <Card style={{ alignItems: "center", gap: space.md }}>
        {code.unusable || expired ? (
          <View
            style={{
              alignItems: "center",
              gap: space.md,
              paddingVertical: space.xl,
            }}
          >
            <AppIcon name="clock" color={theme.textMuted} size={28} />
            <AppText muted style={{ textAlign: "center" }}>
              {code.unusable
                ? "This pairing attempt has ended. Its code cannot be used again, even before the countdown ends."
                : "This code has expired. Codes are single use and short-lived on purpose."}
            </AppText>
            <ActionButton
              title="Show a new code"
              icon="arrow.triangle.2.circlepath"
              size="large"
              onPress={onRestart}
            />
          </View>
        ) : (
          <>
            <QrCode
              value={code.value}
              label={t("Pairing code for the other device to scan")}
            />
            {/* Counted down rather than shown as a deadline: "44 seconds left" is actionable
                where a timestamp is arithmetic somebody has to do while holding two phones. */}
            <StatusPill
              literal
              label={t(
                remaining === 1 ? "1 second left" : `${remaining} seconds left`,
              )}
              icon="clock"
              tone={remaining < 20 ? "warning" : "neutral"}
            />
          </>
        )}
      </Card>

      {!code.unusable && !expired ? (
        <>
          <TextButton
            title={showTyped ? "Hide the typed code" : "Can’t scan?"}
            icon={showTyped ? "eye.slash" : "ion:keyboard-outline"}
            tone="muted"
            accessibilityState={{ expanded: showTyped }}
            onPress={() => setShowTyped((open) => !open)}
          />
          {showTyped ? (
            <MotionView
              variant="up"
              exit
              animateLayout
              style={{ gap: space.sm }}
            >
              {/* A sunken well, like the six-word confirmation below: this string is looked at
                  and copied by eye, not tapped, so it reads better carved into the page than
                  floating above it. */}
              <SunkenWell>
                {/* Selectable, and that is the only concession made here. The code carries the
                    pairing secret, so there is no copy button and it is never persisted or
                    logged — a selection the user makes and pastes once is the shortest life
                    this string can have while still being usable on a desktop. */}
                <AppText
                  literal
                  selectable
                  variant="label"
                  style={{
                    fontFamily: "monospace",
                    letterSpacing: 1,
                    lineHeight: 26,
                    // The groups are read against the other screen, in order. AppText sets the
                    // writing direction from the app language, which would reorder them in
                    // Hebrew, so this pins left-to-right while the text around it stays RTL.
                    writingDirection: "ltr",
                    textAlign: "left",
                  }}
                >
                  {formatPairingCodeForTyping(code.value)}
                </AppText>
              </SunkenWell>
              <AppText variant="caption" muted>
                {TYPED_CODE_HINT}
              </AppText>
            </MotionView>
          ) : null}
        </>
      ) : null}

      <AppText variant="caption" muted>
        Waiting for the other device. The next screen shows six words that must
        be identical on both — that comparison is what makes a photographed code
        useless.
      </AppText>
      <TextButton title="Start over" tone="muted" onPress={onRestart} />
    </>
  );
}
