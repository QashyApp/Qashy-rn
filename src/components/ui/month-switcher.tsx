import { useRef, useState } from "react";
import { Modal, Pressable, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  useAnimatedStyle,
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
/** Names drawn on each side of the current one: enough for two quick swipes ahead of a render. */
const TITLE_REACH = 2;
/** Wide enough for any month name in any locale, so the sizer never truncates one. */
const SIZER_WIDTH = 1000;

const monthAt = (index: number) =>
  `${Math.floor((index - 1) / 12)}-${String(((index - 1) % 12) + 1).padStart(2, "0")}-01`;

function TitleText({ children }: { children: string }) {
  return (
    <AppText
      literal
      variant="label"
      numeric
      numberOfLines={1}
      style={{ textAlign: "center" }}
    >
      {children}
    </AppText>
  );
}

/**
 * The month name. With a `dragProgress` the neighbouring names sit beside it in one strip that
 * travels with the pages, so the title is part of the swipe.
 *
 * The current name is laid out in normal flow and gives the title its height. Nothing here is
 * sized by a measurement: Yoga measures a child no taller than a parent with a fixed height, so a
 * name sized by an `onLayout` result that started at zero stayed zero on native, and Android drew
 * nothing (web lays out with CSS and never showed it).
 *
 * The pill is as wide as the longest month name, measured off-screen, so it keeps one size from
 * month to month.
 */
function MonthTitle({
  value,
  dragProgress,
}: {
  value: string;
  dragProgress?: SharedValue<number>;
}) {
  const { locale, isRtl } = useLocalization();
  const [titleWidth, setTitleWidth] = useState(0);
  // Each name's own width, measured one by one. The widest sets a floor under the title.
  const widths = useRef<number[]>([]);
  const [nameWidth, setNameWidth] = useState(0);
  const centre = Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7));
  // Every month name of the year, laid out invisibly. Absolutely positioned and given a width but
  // no height, so each name is measured at its natural size and the sizer never affects the title.
  const sizer = (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: SIZER_WIDTH,
        opacity: 0,
      }}
    >
      {Array.from({ length: 12 }, (_, month) => (
        <View
          key={month}
          style={{ alignSelf: "flex-start" }}
          onLayout={(event: LayoutChangeEvent) => {
            widths.current[month] = event.nativeEvent.layout.width;
            const widest = Math.ceil(
              Math.max(...widths.current.filter(Boolean)),
            );
            setNameWidth((current) => (current === widest ? current : widest));
          }}
        >
          <TitleText>
            {monthLabel(
              `${value.slice(0, 4)}-${String(month + 1).padStart(2, "0")}-01`,
              locale,
            )}
          </TitleText>
        </View>
      ))}
    </View>
  );
  if (!dragProgress) {
    return (
      <View style={{ minWidth: nameWidth }}>
        {sizer}
        <TitleText>{monthLabel(value, locale)}</TitleText>
      </View>
    );
  }
  return (
    <View
      style={{ minWidth: nameWidth }}
      onLayout={(event: LayoutChangeEvent) => {
        const next = Math.round(event.nativeEvent.layout.width);
        setTitleWidth((current) => (current === next ? current : next));
      }}
    >
      {sizer}
      <TitleStrip
        key={value}
        centre={centre}
        sign={isRtl ? -1 : 1}
        position={dragProgress}
        step={titleWidth > 0 ? titleWidth + TITLE_GAP : 0}
        label={monthLabel(value, locale)}
        neighbours={Array.from({ length: TITLE_REACH * 2 }, (_, slot) => {
          const delta =
            slot < TITLE_REACH ? slot - TITLE_REACH : slot - TITLE_REACH + 1;
          return {
            delta,
            label: monthLabel(monthAt(centre + delta), locale),
          };
        })}
      />
    </View>
  );
}

/**
 * The current name with its neighbours one `step` apart on each side, moved as one by the pager's
 * position. Keyed by month: a new strip arrives with its own month at the centre, so the labels and
 * their offset can never come from different months. It rests at zero for every month.
 */
function TitleStrip({
  centre,
  sign,
  position,
  step,
  label,
  neighbours,
}: {
  centre: number;
  sign: 1 | -1;
  position: SharedValue<number>;
  step: number;
  label: string;
  neighbours: readonly { delta: number; label: string }[];
}) {
  const style = useAnimatedStyle(() => {
    // The pager's position measured from this strip's month, in page widths.
    const offset = centre * sign + position.get();
    // Beyond the drawn names is only ever a jump the pager has not reached yet (the month picker):
    // the new name waits at the centre for it.
    const shown =
      Number.isFinite(offset) && Math.abs(offset) <= TITLE_REACH ? offset : 0;
    return { transform: [{ translateX: shown * step }] };
  });
  return (
    <Animated.View pointerEvents="none" style={style}>
      <TitleText>{label}</TitleText>
      {/* The neighbours wait for the title's width, so they are never drawn inside the pill. */}
      {step > 0
        ? neighbours.map((neighbour) => (
            <View
              key={neighbour.delta}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                position: "absolute",
                // Wider than the title, so a longer month name never wraps or truncates.
                left: -TITLE_GAP,
                right: -TITLE_GAP,
                top: 0,
                bottom: 0,
                alignItems: "center",
                justifyContent: "center",
                transform: [{ translateX: neighbour.delta * sign * step }],
              }}
            >
              <TitleText>{neighbour.label}</TitleText>
            </View>
          ))
        : null}
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
