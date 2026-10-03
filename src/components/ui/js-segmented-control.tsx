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
 * One choice out of a few, shown all at once. A sliding thumb marks the
 * selection, and the selected label also switches to the stronger text color
 * and weight so the state never rests on the thumb's fill alone.
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
  const { radius, space } = theme;
  const motionDuration = useMotionDurations();
  const { t, isRtl } = useLocalization();
  const rtl = lockLtr ? false : isRtl;
  const [width, setWidth] = useState(0);
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  // Material 3 (flat engine): an outlined group whose selected segment is filled with the
  // secondary container and marked with a check, instead of a sunken pill with a raised thumb.
  const m3 = theme.materialControls;
  const inset = m3 ? 0 : space.xxs;
  const border = m3 ? 1 : 0;
  const segment =
    width > 0 ? (width - 2 * (inset + border)) / options.length : 0;
  const height = size === "compact" ? 44 : 48; // 44px is the minimum touch target

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: withTiming((rtl ? -1 : 1) * index * segment, {
          duration: motionDuration.enter,
          easing: motionCurves.standard,
          reduceMotion: ReduceMotion.System,
        }),
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
            minHeight: height + 2 * (inset + border),
          },
          m3
            ? {
                borderWidth: border,
                borderColor: theme.textMuted,
                overflow: "hidden",
              }
            : materialStyle(theme, "sunken"),
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
              m3
                ? { backgroundColor: theme.secondaryContainer }
                : materialStyle(theme, "control"),
              thumbStyle,
            ]}
          />
        ) : null}
        {m3 && segment > 0
          ? options.slice(1).map((option, i) =>
              // The divider sits between segment i and i + 1; the filled one hides its own edges.
              i === index || i + 1 === index ? null : (
                <View
                  key={option.value}
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    start: (i + 1) * segment,
                    width: 1,
                    backgroundColor: theme.textMuted,
                    opacity: 0.5,
                  }}
                />
              ),
            )
          : null}
        {options.map((option) => {
          const selected = option.value === value;
          const selectedColor = m3 ? theme.onSecondaryContainer : theme.text;
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
              {m3 && selected ? (
                <AppIcon name="checkmark" size={16} color={selectedColor} />
              ) : option.icon ? (
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
