import { useEffect } from "react";
import { Platform, type ViewStyle } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { MotionView } from "@/components/ui/motion";
import { TextButton } from "@/components/ui/text-button";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";

const DEFAULT_DURATION = 5000;

/**
 * An inline "undo" snackbar. There is no global host: the screen that triggers
 * a reversible action (removing a card, a batch move) renders this itself,
 * positions it with `style` (typically `position: absolute` pinned to the
 * bottom of that screen, above any tab bar/safe area), and keeps `message` in
 * its own state — passing a new message re-arms the auto-dismiss timer.
 */
export function UndoBar({
  message,
  actionLabel = "Undo",
  onAction,
  onDismiss,
  duration = DEFAULT_DURATION,
  literal = false,
  style,
}: {
  message: string;
  actionLabel?: string;
  onAction: () => void;
  onDismiss: () => void;
  /** Auto-dismiss delay in ms. */
  duration?: number;
  /** Set when `message` is user data rather than dictionary text. */
  literal?: boolean;
  style?: ViewStyle;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const m3 = theme.materialControls;

  useEffect(() => {
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
    // Re-arm whenever the message (a new occurrence of the bar) or the
    // duration changes; `onDismiss` is intentionally not a dependency so a
    // caller passing a fresh closure each render doesn't reset the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, duration]);

  return (
    <MotionView
      variant="up"
      exit
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      {...(Platform.OS === "web" ? { role: "status" as const } : null)}
      style={[
        {
          alignSelf: "center",
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          paddingVertical: space.sm + 2,
          paddingHorizontal: space.lg,
          borderRadius: m3 ? 4 : radius.sheet,
          borderCurve: "continuous",
          maxWidth: 480,
        },
        // M3 snackbar: the inverse surface, with the inverse primary for the action.
        m3
          ? { backgroundColor: theme.inverseSurface, minHeight: 48 }
          : materialStyle(theme, "overlay"),
        style,
      ]}
    >
      <AppText
        selectable={false}
        literal={literal}
        variant="label"
        style={
          m3
            ? { flexShrink: 1, color: theme.inverseOnSurface }
            : { flexShrink: 1 }
        }
      >
        {message}
      </AppText>
      <TextButton
        title={actionLabel}
        onPress={onAction}
        color={m3 ? theme.inversePrimary : undefined}
      />
    </MotionView>
  );
}
