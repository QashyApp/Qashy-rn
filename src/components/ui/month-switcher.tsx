import { useState, type ReactNode } from "react";
import { Modal, Pressable, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";

import { AppText } from "@/components/ui/app-text";
import { IconButton } from "@/components/ui/icon-button";
import { slotDistance, useMonthSlot } from "@/components/ui/month-slot";
import { MotionPressable, MotionView } from "@/components/ui/motion";
import { monthIndex } from "@/components/ui/resolve-swipe";
import { useLocalization } from "@/localization/localization";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import {
  monthKey,
  monthLabel,
  moveMonth,
  parseLocalDate,
  startOfMonth,
} from "@/utils/date";
import { hapticSelection } from "@/utils/haptics";

export type MonthDirection = "left" | "right";

/**
 * Steps through calendar months. `value` is always the first day of a month
 * (`YYYY-MM-01`); `onChange` receives the new first day plus the direction of
 * travel, which a screen's month pager uses to slide toward that month.
 *
 * The label itself is a button: it opens a year/month grid for jumping further
 * than one step at a time.
 */
export function MonthSwitcher({
  value,
  onChange,
  max,
  disabled = false,
  position,
}: {
  value: string;
  onChange: (month: string, direction: MonthDirection) => void;
  /** First day of the latest selectable month. Omit to allow any future month. */
  max?: string;
  disabled?: boolean;
  /** A month pager's `position`: the title slides with the pages below it. */
  position?: SharedValue<number>;
}) {
  const theme = useQashyTheme();
  const { motion, radius, space } = theme;
  const { locale, isRtl, t } = useLocalization();
  const [pickerOpen, setPickerOpen] = useState(false);
  const atMax = max != null && value >= max;

  const step = (delta: number) => {
    hapticSelection();
    onChange(moveMonth(value, delta), delta > 0 ? "right" : "left");
  };

  // Chevrons point along the reading direction: "previous" is always toward the
  // start edge, which is the right edge in Hebrew.
  const backIcon = isRtl ? "chevron.right" : "chevron.left";
  const forwardIcon = isRtl ? "chevron.left" : "chevron.right";

  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: space.xxs,
          borderRadius: radius.pill,
          padding: space.xxs,
          opacity: disabled ? 0.45 : 1,
        },
        materialStyle(theme, "control"),
      ]}
    >
      <IconButton
        label="Previous month"
        icon={backIcon}
        iconSize={16}
        disabled={disabled}
        onPress={() => step(-1)}
      />
      <MotionPressable
        accessibilityRole="button"
        accessibilityLabel={`${monthLabel(value, locale)}. ${t("Choose month")}`}
        disabled={disabled}
        onPress={() => setPickerOpen(true)}
        pressedScale={motion.pressScale}
        style={{
          minHeight: 44,
          minWidth: 128,
          justifyContent: "center",
          paddingHorizontal: space.sm,
          borderRadius: radius.pill,
          overflow: "hidden",
        }}
      >
        <MonthTitle value={value} position={position} />
      </MotionPressable>
      <IconButton
        label="Next month"
        icon={forwardIcon}
        iconSize={16}
        disabled={disabled || atMax}
        onPress={() => step(1)}
      />
      <MonthPicker
        open={pickerOpen}
        value={value}
        max={max}
        onClose={() => setPickerOpen(false)}
        onSelect={(month) => {
          setPickerOpen(false);
          if (month !== value) {
            hapticSelection();
            onChange(month, month > value ? "right" : "left");
          }
        }}
      />
    </View>
  );
}

/** Clears the pill's padding, so a waiting month name is never seen at the edge. */
const TITLE_GAP = 64;

/**
 * The month name. With a pager `position` the previous and next names wait just outside the
 * pill and travel with the pages, so the title is part of the swipe instead of a label that
 * changes after it. Each name is keyed by its month and placed from that month and the shared
 * position, exactly like the pages, so a re-render for the new month never moves a name.
 */
function MonthTitle({
  value,
  position,
}: {
  value: string;
  position?: SharedValue<number>;
}) {
  const { locale } = useLocalization();
  // The step between names. The pill is as wide as the current name, which changes when the new
  // month renders, possibly mid-slide; the step only adopts a new width once the title is at
  // rest, so the names never jump a few pixels on the way.
  const measuredWidth = useSharedValue(0);
  const titleWidth = useSharedValue(0);
  useAnimatedReaction(
    () => {
      const at = position?.get() ?? 0;
      return Math.abs(at - Math.round(at)) < 0.001 ? measuredWidth.get() : -1;
    },
    (width) => {
      if (width >= 0) titleWidth.set(width);
    },
  );
  const label = (month: string) => (
    <AppText
      literal
      variant="label"
      numeric
      numberOfLines={1}
      style={{ textAlign: "center" }}
    >
      {monthLabel(month, locale)}
    </AppText>
  );
  if (!position) return label(value);
  return (
    <View
      onLayout={(event: LayoutChangeEvent) =>
        measuredWidth.set(event.nativeEvent.layout.width)
      }
    >
      {[moveMonth(value, -1), value, moveMonth(value, 1)].map((month) => (
        <TitleSlot
          key={month}
          index={monthIndex(month)}
          current={month === value}
          position={position}
          titleWidth={titleWidth}
        >
          {label(month)}
        </TitleSlot>
      ))}
    </View>
  );
}

function TitleSlot({
  index,
  current,
  position,
  titleWidth,
  children,
}: {
  index: number;
  current: boolean;
  position: SharedValue<number>;
  titleWidth: SharedValue<number>;
  children: ReactNode;
}) {
  const { isRtl } = useLocalization();
  const sign = isRtl ? -1 : 1;
  const pinned = useMonthSlot(index, position, current);
  const animated = useAnimatedStyle(() => {
    const distance = slotDistance(index, position, pinned);
    return {
      opacity: Math.abs(distance) > 1 ? 0 : 1,
      transform: [
        { translateX: distance * sign * (titleWidth.get() + TITLE_GAP) },
      ],
    };
  });
  return (
    <Animated.View
      // The current name sizes the pill; the others wait outside it.
      accessibilityElementsHidden={!current}
      importantForAccessibility={current ? "auto" : "no-hide-descendants"}
      pointerEvents="none"
      style={[
        current
          ? null
          : {
              position: "absolute",
              // Wider than the title, so a longer month name never wraps to fit it.
              left: -TITLE_GAP,
              right: -TITLE_GAP,
              top: 0,
              bottom: 0,
              alignItems: "center",
              justifyContent: "center",
            },
        animated,
      ]}
    >
      {children}
    </Animated.View>
  );
}

function MonthPicker({
  open,
  value,
  max,
  onClose,
  onSelect,
}: {
  open: boolean;
  value: string;
  max?: string;
  onClose: () => void;
  onSelect: (month: string) => void;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const { locale, isRtl, t } = useLocalization();
  const [year, setYear] = useState(() => parseLocalDate(value).getFullYear());
  const current = monthKey(value);
  const thisMonth = monthKey(startOfMonth());
  const shortMonth = new Intl.DateTimeFormat(locale, { month: "short" });
  const maxYear = max ? parseLocalDate(max).getFullYear() : undefined;

  return (
    <Modal
      transparent
      visible={open}
      animationType="fade"
      onShow={() => setYear(parseLocalDate(value).getFullYear())}
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: space.xxl,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Close")}
          onPress={onClose}
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: theme.scrim,
          }}
        />
        <MotionView
          variant="zoom"
          accessibilityViewIsModal
          style={{
            width: "100%",
            maxWidth: 360,
            gap: space.lg,
            padding: space.lg,
            borderRadius: radius.sheet,
            borderCurve: "continuous",
            backgroundColor: theme.surfaceElevated,
            boxShadow: theme.shadowOverlay,
            direction: isRtl ? "rtl" : "ltr",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <IconButton
              label="Previous year"
              icon={isRtl ? "chevron.right" : "chevron.left"}
              iconSize={16}
              onPress={() => setYear((y) => y - 1)}
            />
            <AppText
              literal
              variant="headline"
              numeric
              accessibilityRole="header"
            >
              {String(year)}
            </AppText>
            <IconButton
              label="Next year"
              icon={isRtl ? "chevron.left" : "chevron.right"}
              iconSize={16}
              disabled={maxYear != null && year >= maxYear}
              onPress={() => setYear((y) => y + 1)}
            />
          </View>
          <View
            accessibilityRole="radiogroup"
            style={{ flexDirection: "row", flexWrap: "wrap", rowGap: space.sm }}
          >
            {Array.from({ length: 12 }, (_, index) => {
              const key = `${year}-${String(index + 1).padStart(2, "0")}`;
              const first = `${key}-01`;
              const selected = key === current;
              const blocked = max != null && first > max;
              const label = shortMonth.format(new Date(year, index, 15));
              return (
                <View
                  key={key}
                  style={{ width: "33.333%", paddingHorizontal: space.xs }}
                >
                  <MotionPressable
                    accessibilityRole="radio"
                    accessibilityLabel={monthLabel(first, locale)}
                    accessibilityState={{
                      checked: selected,
                      disabled: blocked,
                    }}
                    aria-checked={selected}
                    disabled={blocked}
                    onPress={() => onSelect(first)}
                    pressedScale={0.95}
                    style={{
                      minHeight: 44,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: radius.pill,
                      backgroundColor: selected ? theme.accent : "transparent",
                      borderWidth: 1,
                      borderColor:
                        key === thisMonth && !selected
                          ? theme.border
                          : "transparent",
                      opacity: blocked ? 0.35 : 1,
                    }}
                  >
                    <AppText
                      literal
                      variant="label"
                      style={{ color: selected ? theme.onAccent : theme.text }}
                    >
                      {label}
                    </AppText>
                  </MotionPressable>
                </View>
              );
            })}
          </View>
        </MotionView>
      </View>
    </Modal>
  );
}
