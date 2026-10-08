import { useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";

import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { DirectionScope } from "@/components/ui/direction-scope";
import {
  motionCurves,
  MotionPressable,
  useMotionDurations,
  useMotionPreference,
} from "@/components/ui/motion";
import { useLocalization } from "@/localization/localization";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import { hapticSelection } from "@/utils/haptics";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: string;
  /** Shown and announced exactly as given (a language's own name, say). */
  literal?: boolean;
}

/**
 * One choice out of a few, shown all at once. Material You draws an M3
 * outlined segmented button (selected segment filled in place, with a check);
 * other themes use a sunken track with a sliding thumb, and the selected label
 * also switches to the stronger text color and weight so the state never rests
 * on the thumb's fill alone.
 *
 * Use it for 2–5 short, mutually exclusive options that change a view (a
 * filter, a chart mode, a theme). Longer or open-ended lists belong in
 * `ChoiceListField`.
 */
export function JsSegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  size = "regular",
  lockLtr = false,
}: {
  /** Accessible name for the group. */
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "regular" | "compact";
  /**
   * Keep the control left-to-right whatever the UI language, for choices whose
   * position must not jump when the choice itself flips the layout — the
   * language selector.
   */
  lockLtr?: boolean;
}) {
  const theme = useQashyTheme();
  if (theme.materialControls) {
    return (
      <MaterialSegmentedControl
        label={label}
        options={options}
        value={value}
        onChange={onChange}
        size={size}
        lockLtr={lockLtr}
      />
    );
  }
  return (
    <ThumbSegmentedControl
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      size={size}
      lockLtr={lockLtr}
    />
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size: "regular" | "compact";
  lockLtr: boolean;
}

/**
 * Material 3 outlined segmented button. One outlined, fully rounded container; each segment is a
 * rectangle divided by a shared outline, and the selected one fills with the secondary container
 * in place and shows a check. Nothing slides: only the outer corners are round, so the selected
 * fill never has a rounded edge pressing on its neighbour.
 */
function MaterialSegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  size,
  lockLtr,
}: SegmentedProps<T>) {
  const theme = useQashyTheme();
  const { space } = theme;
  const { t, isRtl } = useLocalization();
  const rtl = lockLtr ? false : isRtl;
  // Material's segmented button is 40dp; the hit slop brings the target to the 44px minimum.
  const height = size === "compact" ? 36 : 40;
  return (
    <DirectionScope direction={rtl ? "rtl" : "ltr"}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t(label)}
        style={{
          flexDirection: "row",
          height,
          borderRadius: height / 2,
          borderWidth: 1,
          borderColor: theme.outline,
          overflow: "hidden",
        }}
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          const content = selected
            ? theme.onSecondaryContainer
            : theme.textMuted;
          return (
            <MotionPressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={
                option.literal ? option.label : t(option.label)
              }
              accessibilityState={{ checked: selected }}
              aria-checked={selected}
              hitSlop={{ top: 4, bottom: 4 }}
              onPress={() => {
                if (selected) return;
                hapticSelection();
                onChange(option.value);
              }}
              stateLayerColor={content}
              style={{
                flex: 1,
                // MotionPressable's inner views don't stretch with the wrapper, so the segment
                // states its own height (the container's, less its 1px border on each side).
                height: height - 2,
                minWidth: 44,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: space.xs,
                paddingHorizontal: space.sm,
                // The divider is the start edge of every segment but the first.
                borderStartWidth: index === 0 ? 0 : 1,
                borderStartColor: theme.outline,
                backgroundColor: selected
                  ? theme.secondaryContainer
                  : "transparent",
              }}
            >
              {selected ? (
                <AppIcon name="checkmark" size={18} color={content} />
              ) : option.icon ? (
                <AppIcon name={option.icon} size={18} color={content} />
              ) : null}
              <AppText
                selectable={false}
                literal={option.literal}
                numberOfLines={1}
                variant={size === "compact" ? "caption" : "label"}
                style={{
                  color: selected ? content : theme.text,
                }}
              >
                {option.label}
              </AppText>
            </MotionPressable>
          );
        })}
      </View>
    </DirectionScope>
  );
}

/** The sunken track with a raised sliding thumb, for the non-Material themes. */
function ThumbSegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  size,
  lockLtr,
}: SegmentedProps<T>) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const motionDuration = useMotionDurations();
  const { t, isRtl } = useLocalization();
  const rtl = lockLtr ? false : isRtl;
  const [width, setWidth] = useState(0);
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const inset = space.xxs;
  const segment = width > 0 ? (width - 2 * inset) / options.length : 0;
  const height = size === "compact" ? 44 : 48; // 44px is the minimum touch target

  // The thumb slides, which is travel: below the full level it jumps to the selected segment.
  const { travel } = useMotionPreference();
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: travel
          ? withTiming((rtl ? -1 : 1) * index * segment, {
              duration: motionDuration.enter,
              easing: motionCurves.standard,
              reduceMotion: ReduceMotion.System,
            })
          : (rtl ? -1 : 1) * index * segment,
      },
    ],
  }));

  return (
    <DirectionScope direction={rtl ? "rtl" : "ltr"}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t(label)}
        onLayout={(event: LayoutChangeEvent) =>
          setWidth(event.nativeEvent.layout.width)
        }
        style={[
          {
            flexDirection: "row",
            padding: inset,
            borderRadius: radius.pill,
            minHeight: height + 2 * inset,
          },
          materialStyle(theme, "sunken"),
        ]}
      >
        {segment > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: "absolute",
                top: inset,
                bottom: inset,
                start: inset,
                width: segment,
                borderRadius: radius.pill,
              },
              materialStyle(theme, "control"),
              thumbStyle,
            ]}
          />
        ) : null}
        {options.map((option) => {
          const selected = option.value === value;
          const selectedColor = theme.text;
          return (
            <MotionPressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={
                option.literal ? option.label : t(option.label)
              }
              accessibilityState={{ checked: selected }}
              aria-checked={selected}
              onPress={() => {
                if (selected) return;
                hapticSelection();
                onChange(option.value);
              }}
              pressedScale={0.97}
              style={{
                flex: 1,
                minHeight: height,
                minWidth: 44,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: space.xs,
                paddingHorizontal: space.sm,
                borderRadius: radius.pill,
              }}
            >
              {option.icon ? (
                <AppIcon
                  name={option.icon}
                  size={15}
                  color={selected ? selectedColor : theme.textMuted}
                />
              ) : null}
              <AppText
                selectable={false}
                literal={option.literal}
                numberOfLines={1}
                variant={size === "compact" ? "caption" : "label"}
                style={{
                  color: selected ? selectedColor : theme.textMuted,
                  fontWeight: selected ? "600" : "500",
                }}
              >
                {option.label}
              </AppText>
            </MotionPressable>
          );
        })}
      </View>
    </DirectionScope>
  );
}
