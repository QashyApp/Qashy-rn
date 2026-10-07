import { useRef, useState } from "react";
import { Modal, Pressable, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";

import { AppText } from "@/components/ui/app-text";
import { IconButton } from "@/components/ui/icon-button";
import { MotionPressable, MotionView } from "@/components/ui/motion";
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
  dragProgress,
}: {
  value: string;
  onChange: (month: string, direction: MonthDirection) => void;
  /** First day of the latest selectable month. Omit to allow any future month. */
  max?: string;
  disabled?: boolean;
  /** A month pager's drag, in page widths: the title slides with the pages below it. */
  dragProgress?: SharedValue<number>;
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
        <MonthTitle value={value} dragProgress={dragProgress} />
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

const monthAt = (index: number) =>
  `${Math.floor((index - 1) / 12)}-${String(((index - 1) % 12) + 1).padStart(2, "0")}-01`;

/**
 * The month name. With a `dragProgress` the previous, current and next names are placed by their
 * own month index against the pager's absolute position, so the title is part of the swipe and a
 * month change (which swaps the names and the position in separate steps) never shows the wrong
 * month for a frame. Every name keeps its identity across the change.
 *
 * Without one it is just the current name. Either way the pill is as wide as the longest month name,
 * so it keeps one size from month to month.
 */
function MonthTitle({
  value,
  dragProgress,
}: {
  value: string;
  dragProgress?: SharedValue<number>;
}) {
  const { locale, isRtl } = useLocalization();
  const titleWidth = useSharedValue(0);
  const [lineHeight, setLineHeight] = useState(0);
  // Each name's own width, measured one by one. The widest sets a floor under the title, so the
  // pill keeps its size even if a platform sizes the stack of names differently.
  const widths = useRef<number[]>([]);
  const [nameWidth, setNameWidth] = useState(0);
  const sign = isRtl ? -1 : 1;
  const centre = Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7));
  // Every month name, laid out invisibly: the width is the longest one's.
  const sizer = (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{
        height: dragProgress ? lineHeight : 0,
        overflow: "hidden",
        opacity: 0,
      }}
    >
      {Array.from({ length: 12 }, (_, month) => (
        <View
          key={month}
          style={{ alignSelf: "flex-start" }}
          onLayout={(event: LayoutChangeEvent) => {
            const { width, height } = event.nativeEvent.layout;
            widths.current[month] = width;
            const widest = Math.ceil(
              Math.max(...widths.current.filter(Boolean)),
            );
            setNameWidth((current) => (current === widest ? current : widest));
            if (month === 0) setLineHeight(height);
          }}
        >
          <AppText
            literal
            variant="label"
            numeric
            numberOfLines={1}
            style={{ textAlign: "center" }}
          >
            {monthLabel(
              `${value.slice(0, 4)}-${String(month + 1).padStart(2, "0")}-01`,
              locale,
            )}
          </AppText>
        </View>
      ))}
    </View>
  );
  if (!dragProgress) {
    return (
      <View style={{ minWidth: nameWidth }}>
        {sizer}
        <AppText
          literal
          variant="label"
          numeric
          numberOfLines={1}
          style={{ textAlign: "center" }}
        >
          {monthLabel(value, locale)}
        </AppText>
      </View>
    );
  }
  return (
    <View
      style={{ minWidth: nameWidth }}
      onLayout={(event: LayoutChangeEvent) =>
        titleWidth.set(event.nativeEvent.layout.width)
      }
    >
      {/* The sizer holds the row's width and one line of height; the names sit over it. */}
      {sizer}
      {[centre - 1, centre, centre + 1].map((index) => (
        <TitleName
          key={index}
          index={index}
          current={index === centre}
          sign={sign}
          position={dragProgress}
          titleWidth={titleWidth}
          label={monthLabel(monthAt(index), locale)}
        />
      ))}
    </View>
  );
}

function TitleName({
  index,
  current,
  sign,
  position,
  titleWidth,
  label,
}: {
  index: number;
  current: boolean;
  sign: 1 | -1;
  position: SharedValue<number>;
  titleWidth: SharedValue<number>;
  label: string;
}) {
  const style = useAnimatedStyle(() => ({
    transform: [
      {
        translateX:
          (index * sign + position.get()) * (titleWidth.get() + TITLE_GAP),
      },
    ],
  }));
  return (
    <Animated.View
      accessibilityElementsHidden={!current}
      importantForAccessibility={current ? "auto" : "no-hide-descendants"}
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          // Wider than the title, so a longer month name never wraps to fit it.
          left: -TITLE_GAP,
          right: -TITLE_GAP,
          top: 0,
          bottom: 0,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      <AppText
        literal
        variant="label"
        numeric
        numberOfLines={1}
        style={{ textAlign: "center" }}
      >
        {label}
      </AppText>
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
