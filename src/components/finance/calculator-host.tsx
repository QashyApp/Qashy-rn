import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Modal, Pressable, View } from "react-native";
import Animated, {
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AmountKeypad } from "@/components/finance/amount-keypad";
import { ActionButton } from "@/components/ui/action-button";
import { useAnimationLevel } from "@/components/ui/animation-level-context";
import { AppText } from "@/components/ui/app-text";
import { motionCurves, motionSpring } from "@/components/ui/motion";
import type { CurrencyCode } from "@/domain/models";
import { useLocalization } from "@/localization/localization";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import { evaluateAmountExpression } from "@/utils/amount-expression";

/** What the keypad needs from the field it is typing into. */
export interface CalculatorFieldConfig {
  /** The expression shown in the field. */
  value: string;
  onChange: (next: string) => void;
  /** The currency the amount is in: arithmetic rounds to its minor unit, once, at the end. */
  currency: CurrencyCode;
  /** Takes focus off the field, so tapping it again opens the keypad again. */
  blur: () => void;
}

interface CalculatorHostApi {
  /** Shows the keypad for a field. */
  open: (id: string, config: CalculatorFieldConfig) => void;
  /** Keeps the keypad in step with the field's latest value; ignored unless `id` is the open field. */
  sync: (id: string, config: CalculatorFieldConfig) => void;
  /** Hides the keypad, but only if `id` is the field it is open for. */
  release: (id: string) => void;
  /** Hides the keypad for any field. */
  dismiss: () => void;
}

const CalculatorHostContext = createContext<CalculatorHostApi | null>(null);

/** The host a field can open the keypad in, or null where there is none (the system keyboard is used). */
export function useCalculatorHost() {
  return use(CalculatorHostContext);
}

/**
 * A field that focuses while its screen is still being presented (an autofocused amount in a sheet
 * that is sliding up) waits this long after the host mounts before the keypad opens. iOS refuses to
 * present a modal while another presentation is in flight, and dimming a sheet mid-slide reads as a
 * glitch anywhere. A field focused later opens the keypad on the same frame.
 */
const PRESENTATION_SETTLE_MS = 550;

/** Closing is the same spring, stiffer: an exit gets out of the way faster than an entrance arrives. */
const closeSpring = { ...motionSpring, stiffness: 560 } as const;

/**
 * Gives a screen's amount fields the calculator keypad in place of the system keyboard.
 *
 * The keypad is a layer over the whole screen, not part of the screen's layout: it rises from the
 * bottom edge of the display (wherever the sheet holding the form happens to sit), the screen behind
 * it dims, and the form never resizes or scrolls underneath it. Because the form is covered, the
 * keypad shows the amount being typed itself. "Set amount", a tap on the dimmed screen, or back on
 * Android all finish the calculation and close it.
 */
export function CalculatorHost({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<{
    id: string;
    config: CalculatorFieldConfig;
  } | null>(null);
  const mountedAt = useRef(0);
  useEffect(() => {
    mountedAt.current = Date.now();
  }, []);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(openTimer.current), []);

  const api = useMemo<CalculatorHostApi>(
    () => ({
      open: (id, config) => {
        clearTimeout(openTimer.current);
        // The keypad does the typing, so the field gives up focus at once. Left focused, it would get
        // focus back when the layer closes (the web restores focus to what held it before), and that
        // would open the keypad again.
        config.blur();
        const wait = mountedAt.current + PRESENTATION_SETTLE_MS - Date.now();
        if (process.env.EXPO_OS === "web" || wait <= 0) {
          setActive({ id, config });
          return;
        }
        openTimer.current = setTimeout(() => setActive({ id, config }), wait);
      },
      sync: (id, config) =>
        setActive((current) => (current?.id === id ? { id, config } : current)),
      release: (id) => {
        clearTimeout(openTimer.current);
        setActive((current) => (current?.id === id ? null : current));
      },
      dismiss: () => {
        clearTimeout(openTimer.current);
        setActive(null);
      },
    }),
    [],
  );

  return (
    <CalculatorHostContext value={api}>
      {children}
      <CalculatorLayer
        config={active?.config}
        onClose={() => setActive(null)}
      />
    </CalculatorHostContext>
  );
}

function CalculatorLayer({
  config,
  onClose,
}: {
  config: CalculatorFieldConfig | undefined;
  onClose: () => void;
}) {
  const theme = useQashyTheme();
  const { space, radius } = theme;
  const insets = useSafeAreaInsets();
  const { locale, t } = useLocalization();
  const level = useAnimationLevel();

  // The layer keeps showing the last field's keys while it slides away.
  const [held, setHeld] = useState(config);
  if (config && held !== config) setHeld(config);
  const visible = Boolean(config);

  // 0 = off the bottom edge, 1 = in place. The panel's height lives on the UI thread, and the slide
  // starts from the panel's very first layout, so none of the motion plays out while it is hidden.
  const progress = useSharedValue(0);
  const panelHeight = useSharedValue(0);
  const wantVisible = useRef(visible);
  const animate = useCallback(
    (show: boolean) => {
      const settled = (finished?: boolean) => {
        "worklet";
        if (finished && !show) runOnJS(setHeld)(undefined);
      };
      if (level === "off") {
        progress.set(withTiming(show ? 1 : 0, { duration: 0 }, settled));
        return;
      }
      if (level === "minimal") {
        progress.set(
          withTiming(
            show ? 1 : 0,
            {
              duration: 120,
              easing: show ? motionCurves.standard : motionCurves.exit,
              reduceMotion: ReduceMotion.System,
            },
            settled,
          ),
        );
        return;
      }
      progress.set(
        withSpring(show ? 1 : 0, show ? motionSpring : closeSpring, settled),
      );
    },
    [level, progress],
  );
  useEffect(() => {
    wantVisible.current = visible;
    // Before the panel has been measured its first layout starts the slide (see `onLayout`).
    if (panelHeight.get() > 0) animate(visible);
  }, [visible, animate, panelHeight]);
  useEffect(() => {
    if (!held) {
      panelHeight.set(0);
      progress.set(0);
    }
  }, [held, panelHeight, progress]);

  const scrim = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const slide = useAnimatedStyle(() => {
    const height = panelHeight.get();
    return {
      opacity: height === 0 ? 0 : 1,
      transform: [{ translateY: height * (1 - progress.get()) }],
    };
  });

  const resolve = (expression: string) => {
    if (!held) return null;
    const result = evaluateAmountExpression(expression, held.currency, locale);
    return result.kind === "value" ? result.text : null;
  };
  const result = held ? resolve(held.value) : null;

  const done = () => {
    if (!config) return;
    // A calculation still showing is finished, so the form is left holding a plain amount.
    if (result !== null) config.onChange(result);
    config.blur();
    onClose();
  };

  if (!held) return null;
  const sheet = theme.materialControls
    ? { backgroundColor: theme.surfaceMuted }
    : materialStyle(theme, "overlay");
  return (
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={done}
    >
      <View
        pointerEvents={visible ? "auto" : "none"}
        style={{ flex: 1, justifyContent: "flex-end" }}
      >
        <Animated.View
          style={[
            { position: "absolute", inset: 0, backgroundColor: theme.scrim },
            scrim,
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Close")}
            onPress={done}
            style={{ flex: 1 }}
          />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          importantForAccessibility="yes"
          onLayout={(event) => {
            const height = event.nativeEvent.layout.height;
            const first = panelHeight.get() === 0;
            panelHeight.set(height);
            if (first && height > 0) animate(wantVisible.current);
          }}
          style={[
            {
              width: "100%",
              maxWidth: 560,
              alignSelf: "center",
              borderTopLeftRadius: radius.sheet,
              borderTopRightRadius: radius.sheet,
              borderCurve: "continuous",
              overflow: "hidden",
              paddingHorizontal: space.lg,
              paddingTop: space.lg,
              paddingBottom: Math.max(insets.bottom, space.md) + space.sm,
              gap: space.md,
            },
            sheet,
            slide,
          ]}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: space.sm,
            }}
          >
            <AppText variant="title" accessibilityRole="header">
              Enter amount
            </AppText>
            <View
              style={{
                borderRadius: radius.pill,
                paddingHorizontal: space.md,
                paddingVertical: space.xs,
                ...materialStyle(theme, "control"),
              }}
            >
              <AppText literal variant="label" style={{ fontWeight: "700" }}>
                {held.currency}
              </AppText>
            </View>
          </View>
          <AppText
            literal
            figure
            variant="hero"
            numberOfLines={1}
            adjustsFontSizeToFit
            accessibilityLiveRegion="polite"
            muted={held.value.length === 0}
            style={{ textAlign: "right", writingDirection: "ltr" }}
          >
            {held.value.length > 0 ? held.value : "0"}
          </AppText>
          <AmountKeypad
            value={held.value}
            onChange={held.onChange}
            locale={locale}
            result={result}
            resolve={resolve}
          />
          <ActionButton title="Set amount" icon="checkmark" onPress={done} />
        </Animated.View>
      </View>
    </Modal>
  );
}
