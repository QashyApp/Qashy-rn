import { router } from "expo-router";
import { View } from "react-native";

import { ActionButton } from "@/components/ui/action-button";
import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { MotionPressable } from "@/components/ui/motion";
import { TextButton } from "@/components/ui/text-button";
import { useLocalization } from "@/localization/localization";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import { Role } from "@/features/sync/pair/pair-model";

export function RoleStep({
  role,
  onRole,
  canJoin,
  canHost,
  deviceName,
  onDeviceName,
  busy,
  onContinue,
  joinOnly = false,
}: {
  readonly role: Role;
  readonly onRole: (role: Role) => void;
  readonly canJoin: boolean;
  readonly canHost: boolean;
  readonly joinOnly?: boolean;
  readonly deviceName: string;
  readonly onDeviceName: (name: string) => void;
  readonly busy: boolean;
  readonly onContinue: () => void;
}) {
  const theme = useQashyTheme();
  const { space } = theme;
  const blockedHost = role === "host" && !canHost;

  return (
    <>
      <AppText variant="title">
        {joinOnly ? "Join your other device" : "Add a device"}
      </AppText>
      <AppText muted>
        {joinOnly
          ? "On the device that already has your data, open More → Sync → Add device. It will show a code for this one to scan."
          : "Both devices end up holding the same key, and only those two can read anything. Start on whichever one has the data you want to keep."}
      </AppText>

      <View style={{ gap: space.sm, display: joinOnly ? "none" : "flex" }}>
        <RoleOption
          icon="iphone"
          title="This device has my data"
          body={
            canHost
              ? "Shows a code for the other device to scan."
              : "Needs a relay address first — the two devices have nowhere to meet without one."
          }
          selected={role === "host"}
          onPress={() => onRole("host")}
        />
        <RoleOption
          icon="qrcode.viewfinder"
          title="Add this device to a vault"
          body={
            canJoin
              ? "Scans a code shown by a device that is already set up."
              : "Not available — this device is already part of a vault. Removing it from the other device is the way out."
          }
          selected={role === "join"}
          disabled={!canJoin}
          onPress={() => onRole("join")}
        />
      </View>

      <FormField
        label="Name this device"
        value={deviceName}
        onChangeText={onDeviceName}
        autoCapitalize="words"
        returnKeyType="done"
        hint="Only your paired devices ever see this. It is sent encrypted, and the relay never learns it."
      />

      {blockedHost ? (
        <Card style={{ gap: space.sm, borderColor: theme.warning }}>
          <AppText variant="label">Set a relay address first</AppText>
          <AppText variant="caption" muted>
            Showing a code needs somewhere the two devices can agree to meet.
            The relay never sees your data — it forwards sealed bytes between
            devices that already hold each other’s keys. Add its address under
            Connections in Sync settings.
          </AppText>
          <TextButton
            title="Open sync settings"
            icon="gear"
            onPress={() => router.replace("/sync")}
          />
        </Card>
      ) : null}

      <ActionButton
        title={busy ? "Preparing…" : "Continue"}
        icon="arrow.right"
        mirrorIcon
        size="large"
        busy={busy}
        disabled={busy || blockedHost}
        onPress={onContinue}
      />
    </>
  );
}

function RoleOption({
  icon,
  title,
  body,
  selected,
  disabled = false,
  onPress,
}: {
  readonly icon: string;
  readonly title: string;
  readonly body: string;
  readonly selected: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const { t } = useLocalization();
  // A pressable rather than a `Card` with a touch handler: the choice needs press feedback and
  // a real `radio` role, and a `View` that happens to react to `onTouchEnd` gives neither — nor
  // does it respond to a keyboard, which is how this screen is used on the desktop PWA.
  return (
    <MotionPressable
      accessibilityRole="radio"
      accessibilityLabel={`${t(title)}. ${t(body)}`}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        {
          gap: space.xs,
          padding: space.lg,
          borderRadius: radius.card,
          borderCurve: "continuous",
          opacity: disabled ? 0.5 : 1,
        },
        selected && !disabled
          ? materialStyle(theme, "selected")
          : materialStyle(theme, "control"),
      ]}
    >
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
      >
        <AppIcon
          name={icon}
          color={
            selected && !disabled ? theme.onAccentContainer : theme.textMuted
          }
          size={18}
        />
        <AppText variant="label">{title}</AppText>
      </View>
      <AppText variant="caption" muted>
        {body}
      </AppText>
    </MotionPressable>
  );
}
