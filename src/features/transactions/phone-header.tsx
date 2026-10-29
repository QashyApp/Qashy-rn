import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Keyboard,
  TextInput,
  View,
  type TextInputInstance,
  type ViewStyle,
} from "react-native";
import Animated, {
  interpolate,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { AppIcon } from "@/components/ui/app-icon";
import { IconButton } from "@/components/ui/icon-button";
import {
  motionCurves,
  MotionPressable,
  useMotionDurations,
  useMotionPreference,
} from "@/components/ui/motion";
import { useLocalization } from "@/localization/localization";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import { fontStyle } from "@/theme/typography";

/** Browsers can take a covered block out of the tab order outright. */
const WEB = process.env.EXPO_OS === "web";

/** Without travel, the pill snaps to its new width as the fade passes this point. */
const SNAP_AT = 0.5;

/** The collapsed pill's share of the row, and the least it may shrink to before it is only an icon. */
const PILL_SHARE = 0.34;
/** The month bar's narrowest comfortable width: two arrows and the longest month name. */
const SWITCHER_MIN_WIDTH = 232;
/** Below this the collapsed pill has no room for its word, only the magnifier. */
const ICON_ONLY_BELOW = 108;

const TOUCH_TARGET = 44;
const ICON_SIZE = 18;
/** The visible size of the filter toggle; its touch target is padded out to 44 around it. */
const FILTER_TOGGLE_SIZE = 30;
/**
 * How far the filter toggle's frame reaches below the divider it sits on, which is how much layout
 * it takes under the section. (The visible circle is centred on the divider, so it is half of it.)
 */
export const FILTER_TOGGLE_BELOW_LINE = TOUCH_TARGET / 2;
/** How far the circle itself reaches above the divider, which the section's content has to clear. */
export const FILTER_TOGGLE_ABOVE_LINE = FILTER_TOGGLE_SIZE / 2;

/**
 * A 0 → 1 value that follows `on` with the theme's durations. `travelOnly` is for movement that
 * would be a flourish without travel (a chevron turning over): it then flips at once, where a fade
 * or a fold keeps running at the Minimal level.
 */
export function useTimedProgress(on: boolean, travelOnly = false) {
  const { instant, travel } = useMotionPreference();
  const durations = useMotionDurations();
  const value = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    const animated = travelOnly ? travel : !instant;
    value.set(
      withTiming(on ? 1 : 0, {
        duration: animated ? (on ? durations.enter : durations.exit) : 0,
        easing: on ? motionCurves.standard : motionCurves.exit,
        reduceMotion: instant ? ReduceMotion.Always : ReduceMotion.System,
      }),
    );
  }, [on, travelOnly, travel, instant, durations, value]);
  return value;
}

/** Whether the filters were left open, kept for the app session and reset by a restart. */
let filtersOpenForSession = false;

/**
 * Whether the filter row under the summary is open. It starts shut on every launch and then
 * remembers what the person chose while the app lives, so leaving the tab and coming back finds
 * it as it was.
 */
export function useFiltersOpen() {
  const [open, setOpen] = useState(() => filtersOpenForSession);
  const toggle = useCallback(() => {
    setOpen((current) => {
      filtersOpenForSession = !current;
      return !current;
    });
  }, []);
  return { open, toggle };
}

/**
 * The phone's top row: the month bar, and a search pill at its end edge. Tapping the pill grows it
 * toward the start edge over the whole row, and the month bar is gone while it is. The pill shrinks
 * back once it is blurred and empty; with text in it, it stays out so an active search shows.
 */
export function SearchPillRow({
  switcher,
  value,
  allMonths,
  onChangeText,
  onClear,
}: {
  /** The month bar. It is covered, and out of reach, while the pill is out. */
  switcher: ReactNode;
  value: string;
  /** The search reaches every month, which the placeholder says. */
  allMonths: boolean;
  onChangeText: (value: string) => void;
  onClear: () => void;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const { isRtl, t } = useLocalization();
  const { travel } = useMotionPreference();
  const inputRef = useRef<TextInputInstance>(null);
  const [rowWidth, setRowWidth] = useState(0);
  const [focused, setFocused] = useState(false);
  const expanded = focused || value.length > 0;
  const progress = useTimedProgress(expanded);

  // Closing the keyboard with the back button leaves the input focused on Android, so the pill
  // would stay out over the month bar with nothing in it. Hiding the keyboard ends the focus.
  useEffect(() => {
    if (process.env.EXPO_OS !== "android") return;
    const subscription = Keyboard.addListener("keyboardDidHide", () => {
      inputRef.current?.blur();
      setFocused(false);
    });
    return () => subscription.remove();
  }, []);

  // Matches the month bar, which is its 44px buttons inside a padding of `xxs`.
  const height = TOUCH_TARGET + space.xxs * 2;
  const collapsedWidth = rowWidth
    ? Math.round(
        Math.max(
          height,
          Math.min(
            rowWidth * PILL_SHARE,
            rowWidth - SWITCHER_MIN_WIDTH - space.sm,
          ),
        ),
      )
    : 0;
  // A pill too narrow for its word is only the magnifier, centred; it moves to the start edge as
  // the pill grows, and back as it shrinks.
  const narrow = collapsedWidth > 0 && collapsedWidth < ICON_ONLY_BELOW;
  const iconShift =
    (narrow ? (collapsedWidth - ICON_SIZE) / 2 - space.md : 0) *
    (isRtl ? -1 : 1);

  const pillStyle = useAnimatedStyle(() => {
    if (!rowWidth) return { width: `${PILL_SHARE * 100}%` };
    const p = progress.get();
    const grown = travel ? p : p >= SNAP_AT ? 1 : 0;
    return { width: collapsedWidth + (rowWidth - collapsedWidth) * grown };
  });
  const switcherStyle = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: interpolate(p, [0, SNAP_AT], [1, 0], "clamp"),
      ...(WEB
        ? ({ visibility: p >= SNAP_AT ? "hidden" : "visible" } as object)
        : null),
    };
  });

  const placeholder =
    narrow && !expanded
      ? ""
      : t(
          expanded
            ? allMonths
              ? "Search all months"
              : "Search this month"
            : "Search",
        );
  const iconStyle = useAnimatedStyle(() => {
    const p = progress.get();
    const grown = travel ? p : p >= SNAP_AT ? 1 : 0;
    return { transform: [{ translateX: iconShift * (1 - grown) }] };
  });
  return (
    <View
      onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
      style={{ minHeight: height, flexDirection: "row" }}
    >
      <Animated.View
        // Covered, the month bar takes no touch and a screen reader skips it.
        pointerEvents={expanded ? "none" : "auto"}
        importantForAccessibility={expanded ? "no-hide-descendants" : "auto"}
        aria-hidden={expanded ? true : undefined}
        style={[
          {
            flex: 1,
            minWidth: 0,
            marginEnd: rowWidth ? collapsedWidth + space.sm : "37%",
          },
          switcherStyle,
        ]}
      >
        {switcher}
      </Animated.View>
      <Animated.View
        style={[
          {
            position: "absolute",
            top: 0,
            end: 0,
            height,
            borderRadius: radius.pill,
            borderCurve: "continuous",
            overflow: "hidden",
            justifyContent: "center",
            ...materialStyle(theme, "control"),
            ...(focused
              ? { boxShadow: `inset 0 0 0 2px ${String(theme.accent)}` }
              : null),
          } as ViewStyle,
          pillStyle,
        ]}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              start: space.md,
              top: 0,
              bottom: 0,
              justifyContent: "center",
            },
            iconStyle,
          ]}
        >
          <AppIcon
            name="magnifyingglass"
            color={theme.textMuted}
            size={ICON_SIZE}
          />
        </Animated.View>
        <TextInput
          ref={inputRef}
          accessibilityLabel={t("Search transactions")}
          placeholder={placeholder}
          placeholderTextColor={theme.textMuted}
          value={value}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChangeText={onChangeText}
          style={{
            height,
            paddingStart: space.md + ICON_SIZE + space.sm,
            paddingEnd: value ? TOUCH_TARGET : space.md,
            color: theme.text,
            fontSize: 16,
            ...fontStyle("regular", theme.type),
            writingDirection: isRtl ? "rtl" : "ltr",
            textAlign: isRtl ? "right" : "left",
          }}
        />
        {value ? (
          <IconButton
            label="Clear search"
            icon="xmark"
            iconSize={17}
            enteringVariant="zoom"
            onPress={() => {
              onClear();
              // Clearing is usually to type something else: keep the pill out for it.
              inputRef.current?.focus();
            }}
            style={{
              position: "absolute",
              end: space.xxs,
              top: (height - TOUCH_TARGET) / 2,
            }}
          />
        ) : null}
      </Animated.View>
    </View>
  );
}

/**
 * The round tab on the top section's bottom line that opens and shuts the filter row. Half of it
 * sits above the line and half below, so it takes `FILTER_TOGGLE_BELOW_LINE` of the layout below
 * the section: a control hanging outside its parent's bounds gets no touches on Android. A dot on
 * it says that a filter is on while the row is shut.
 */
export function FilterToggle({
  open,
  filterActive,
  onToggle,
}: {
  open: boolean;
  /** A kind filter, or a search across every month, is on. */
  filterActive: boolean;
  onToggle: () => void;
}) {
  const theme = useQashyTheme();
  const { t } = useLocalization();
  const turn = useTimedProgress(open, true);
  const chevron = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.get() * 180}deg` }],
  }));
  const showDot = filterActive && !open;
  const hitSlop = (TOUCH_TARGET - FILTER_TOGGLE_SIZE) / 2;
  return (
    // A frame as tall as the touch target, so the padding around the circle is inside its parent
    // (Android gives a child no touches outside its parent's bounds); the circle is centred on the
    // divider and the frame lets touches through everywhere else.
    <View
      pointerEvents="box-none"
      style={{
        height: TOUCH_TARGET,
        marginTop: -TOUCH_TARGET / 2,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <MotionPressable
        delayPressIn={0}
        accessibilityRole="button"
        accessibilityLabel={t(open ? "Hide filters" : "Show filters")}
        accessibilityHint={showDot ? t("A filter is on") : undefined}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        hitSlop={hitSlop}
        onPress={onToggle}
        pressedScale={theme.motion.pressScale}
        stateLayerColor={theme.textMuted}
        style={{
          width: FILTER_TOGGLE_SIZE,
          height: FILTER_TOGGLE_SIZE,
          borderRadius: theme.radius.pill,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: theme.border,
          ...materialStyle(theme, "raised"),
        }}
      >
        <Animated.View style={chevron}>
          <AppIcon name="chevron.down" color={theme.textMuted} size={16} />
        </Animated.View>
        {showDot ? (
          <View
            testID="filter-active-dot"
            style={{
              position: "absolute",
              top: -2,
              end: -2,
              width: 10,
              height: 10,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.accent,
              borderWidth: 2,
              borderColor: theme.background,
            }}
          />
        ) : null}
      </MotionPressable>
    </View>
  );
}
