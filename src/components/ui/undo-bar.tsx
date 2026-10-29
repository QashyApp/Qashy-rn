import { useEffect, useRef, useState } from "react";
import { Platform, type ViewStyle } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { MotionView } from "@/components/ui/motion";
import { TextButton } from "@/components/ui/text-button";
import { undoDuration, undoRemaining } from "@/components/ui/undo-duration";
import { useScreenReaderEnabled } from "@/components/ui/use-screen-reader";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";

const DEFAULT_DURATION = 5000;

/**
 * An inline "undo" snackbar. There is no global host: the screen that triggers
 * a reversible action (removing a card, a batch move) renders this itself,
 * positions it with `style` (typically `position: absolute` pinned to the
 * bottom of that screen, above any tab bar/safe area), and keeps `message` in
 * its own state — passing a new message re-arms the auto-dismiss timer.
 *
 * The countdown waits while the bar is pressed, hovered or focused, and picks up again where it
 * was left. With a screen reader running the bar stays for at least ten seconds.
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
  /** Auto-dismiss delay in ms (at least 10 000 while a screen reader is running). */
  duration?: number;
  /** Set when `message` is user data rather than dictionary text. */
  literal?: boolean;
  style?: ViewStyle;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const m3 = theme.materialControls;

  const screenReader = useScreenReaderEnabled();
  const total = undoDuration(duration, screenReader);

  // What is holding the countdown: a finger on the bar, the pointer over it, focus on its button.
  const holds = useRef({ touch: false, hover: false, focus: false });
  const [held, setHeld] = useState(false);
  const hold = (key: keyof typeof holds.current, on: boolean) => {
    holds.current[key] = on;
    const { touch, hover, focus } = holds.current;
    setHeld(touch || hover || focus);
  };

  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });
  const remaining = useRef(total);
  const startedAt = useRef(0);

  // A new message (a new occurrence of the bar) or a new duration starts the countdown over.
  useEffect(() => {
    remaining.current = total;
  }, [message, total]);
  // Runs the countdown whenever nothing holds it, and keeps what is left when something does.
  // `onDismiss` goes through a ref so a caller passing a fresh closure each render does not reset it.
  useEffect(() => {
    if (held) return;
    startedAt.current = Date.now();
    const timer = setTimeout(() => onDismissRef.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = undoRemaining(
        remaining.current,
        Date.now() - startedAt.current,
      );
    };
  }, [held, message, total]);

  return (
    <MotionView
      variant="up"
      exit
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      {...(Platform.OS === "web"
        ? {
            role: "status" as const,
            onPointerEnter: () => hold("hover", true),
            onPointerLeave: () => hold("hover", false),
          }
        : null)}
      onTouchStart={() => hold("touch", true)}
      onTouchEnd={() => hold("touch", false)}
      onTouchCancel={() => hold("touch", false)}
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
        onFocus={() => hold("focus", true)}
        onBlur={() => hold("focus", false)}
        color={m3 ? theme.inversePrimary : undefined}
      />
    </MotionView>
  );
}
