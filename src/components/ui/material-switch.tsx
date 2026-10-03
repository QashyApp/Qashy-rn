import { useEffect } from "react";
import { Pressable, type ColorValue, type SwitchProps } from "react-native";
import Animated, {
  interpolate,
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { AppIcon } from "@/components/ui/app-icon";
import { motionCurves, useMotionDurations } from "@/components/ui/motion";
import { useLocalization } from "@/localization/localization";
import { useQashyTheme } from "@/theme/theme";
import { contrastRatio } from "@/theme/tokens";
import { hapticSelection } from "@/utils/haptics";

// Material 3 switch geometry: a 52x32 track with a 2px outline, and a thumb that grows
// from 16px (off) to 24px (on) and slides across.
const TRACK_WIDTH = 52;
const TRACK_HEIGHT = 32;
const TRACK_BORDER = 2;
const THUMB = 24;
const THUMB_OFF_SCALE = 16 / THUMB;
const THUMB_TOP = (TRACK_HEIGHT - 2 * TRACK_BORDER - THUMB) / 2;
const THUMB_OFF_START = 2;
const THUMB_TRAVEL = 20;

// interpolateColor wants strings; the theme's tokens are hex strings in practice.
const str = (color: ColorValue) => color as string;

/**
 * A hand-drawn Material 3 switch for platforms with no native one (web). Android draws the
 * real Compose switch instead; see `qashy-switch.android.tsx`. One animated 0→1 value
 * drives the thumb's position and size and every color.
 */
export function MaterialSwitch({
  value = false,
  onValueChange,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: SwitchProps) {
  const theme = useQashyTheme();
  const motionDuration = useMotionDurations();
  const { isRtl } = useLocalization();

  const progress = useSharedValue(value ? 1 : 0);
  const duration = motionDuration.enter;
  useEffect(() => {
    progress.value = withTiming(value ? 1 : 0, {
      duration,
      easing: motionCurves.standard,
      reduceMotion: ReduceMotion.System,
    });
  }, [value, duration, progress]);

  // `onAccent` is picked for text contrast, so a bright accent gets a black thumb. A
  // thumb only needs 3:1 against the track, so prefer white whenever that holds.
  const accent = str(theme.accent);
  const onThumb =
    /^#[0-9a-f]{6}$/i.test(accent) && contrastRatio("#FFFFFF", accent) >= 3
      ? "#FFFFFF"
      : str(theme.onAccent);
  const offTrack = str(theme.surfaceMuted);
  const offOutline = str(theme.textMuted);
  const direction = isRtl ? -1 : 1;

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [offTrack, accent],
    ),
    borderColor: interpolateColor(progress.value, [0, 1], [offOutline, accent]),
  }));

  const thumbStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [offOutline, onThumb],
    ),
    transform: [
      { translateX: direction * progress.value * THUMB_TRAVEL },
      { scale: interpolate(progress.value, [0, 1], [THUMB_OFF_SCALE, 1]) },
    ],
  }));

  // The check fades in over the second half of the slide.
  const checkStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.5, 1], [0, 1], "clamp"),
  }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ checked: value, disabled }}
      aria-checked={value}
      disabled={disabled}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      onPress={() => {
        hapticSelection();
        onValueChange?.(!value);
      }}
      testID={testID}
      style={{ opacity: disabled ? 0.38 : 1 }}
    >
      <Animated.View
        style={[
          {
            width: TRACK_WIDTH,
            height: TRACK_HEIGHT,
            borderRadius: TRACK_HEIGHT / 2,
            borderWidth: TRACK_BORDER,
          },
          trackStyle,
        ]}
      >
        <Animated.View
          style={[
            {
              position: "absolute",
              top: THUMB_TOP,
              start: THUMB_OFF_START,
              width: THUMB,
              height: THUMB,
              borderRadius: THUMB / 2,
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            },
            thumbStyle,
          ]}
        >
          <Animated.View style={checkStyle}>
            <AppIcon name="checkmark" size={14} color={theme.accent} />
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}
