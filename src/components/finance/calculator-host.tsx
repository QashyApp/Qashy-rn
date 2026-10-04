import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  View,
  type GestureResponderEvent,
  type ScrollView,
} from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AmountKeypad } from "@/components/finance/amount-keypad";
import { useAnimationLevel } from "@/components/ui/animation-level-context";
import { TextButton } from "@/components/ui/text-button";
import type { CurrencyCode } from "@/domain/models";
import { useLocalization } from "@/localization/localization";
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
  /** Reports where the field is in the window, so a tap on it is not a tap outside it. */
  measure: (
    report: (rect: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) => void,
  ) => void;
}

interface CalculatorHostApi {
  /** Shows the keypad for a field. `measureBottom` reports the field's bottom edge in the window. */
  open: (
    id: string,
    config: CalculatorFieldConfig,
    measureBottom: (report: (bottom: number) => void) => void,
  ) => void;
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
 * Lays out a screen's body with the calculator keypad beneath it.
 *
 * The keypad replaces the system keyboard for the amount fields in the body: it appears when one
 * of them takes focus and goes away with "Done" or when another kind of field is focused. It is part
 * of the screen's own layout rather than an overlay, so the body shrinks above it the way it does
 * above a keyboard, and the focused field is scrolled clear of it.
 */
export function CalculatorHost({
  children,
  scrollRef,
  scrollOffset,
}: {
  children: ReactNode;
  /** The body's scroll view, for scrolling the focused field into view. */
  scrollRef: RefObject<ScrollView | null>;
  /** The body's current scroll offset. */
  scrollOffset: RefObject<number>;
}) {
  const theme = useQashyTheme();
  const { space, radius } = theme;
  const insets = useSafeAreaInsets();
  const { locale } = useLocalization();
  const [active, setActive] = useState<{
    id: string;
    config: CalculatorFieldConfig;
  } | null>(null);
  const level = useAnimationLevel();
  const panelRef = useRef<View>(null);
  const touch = useRef<{ x: number; y: number; at: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(revealTimer.current), []);

  const reveal = useCallback(
    (measureBottom: (report: (bottom: number) => void) => void) => {
      clearTimeout(revealTimer.current);
      // After the body has been resized above the keypad.
      revealTimer.current = setTimeout(() => {
        measureBottom((fieldBottom) => {
          panelRef.current?.measureInWindow((_x, panelTop) => {
            const overlap = fieldBottom + space.lg - panelTop;
            if (overlap > 0)
              scrollRef.current?.scrollTo({
                y: scrollOffset.current + overlap,
                animated: true,
              });
          });
        });
      }, 280);
    },
    [scrollOffset, scrollRef, space.lg],
  );

  const api = useMemo<CalculatorHostApi>(
    () => ({
      open: (id, config, measureBottom) => {
        clearTimeout(closeTimer.current);
        setActive({ id, config });
        reveal(measureBottom);
      },
      sync: (id, config) =>
        setActive((current) => (current?.id === id ? { id, config } : current)),
      release: (id) =>
        setActive((current) => (current?.id === id ? null : current)),
      dismiss: () => setActive(null),
    }),
    [reveal],
  );

  const config = active?.config;
  const activeConfig = useRef(config);
  useEffect(() => {
    activeConfig.current = config;
  }, [config]);

  // A tap (not a scroll or a drag) anywhere in the body but on the field being edited closes the
  // keypad. The close waits a beat so a tap that lands on another amount field hands the keypad
  // over to it instead (its focus cancels the close).
  const onBodyTouchEnd = (event: GestureResponderEvent) => {
    const start = touch.current;
    touch.current = null;
    const field = activeConfig.current;
    if (!start || !field) return;
    const { pageX, pageY } = event.nativeEvent;
    if (
      Math.hypot(pageX - start.x, pageY - start.y) > 10 ||
      Date.now() - start.at > 500
    )
      return;
    field.measure(({ x, y, width, height }) => {
      const pad = 4;
      const inside =
        pageX >= x - pad &&
        pageX <= x + width + pad &&
        pageY >= y - pad &&
        pageY <= y + height + pad;
      if (inside) return;
      clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => {
        activeConfig.current?.blur();
        setActive(null);
      }, 120);
    });
  };

  // The panel keeps showing the last field's keys while it slides away. It is one view moved by one
  // transform, measured before it is ever shown, so no part of it can appear ahead of the rest.
  const [held, setHeld] = useState(active);
  if (active && held !== active) setHeld(active);
  const [panelHeight, setPanelHeight] = useState(0);
  const progress = useSharedValue(0);
  const visible = Boolean(config);
  useEffect(() => {
    if (!visible && !held) return;
    progress.set(
      withTiming(
        visible ? 1 : 0,
        {
          duration:
            level === "off" ? 0 : visible ? (level === "all" ? 240 : 120) : 180,
          easing: Easing.out(Easing.cubic),
          reduceMotion: ReduceMotion.System,
        },
        (finished) => {
          if (finished && !visible) runOnJS(setHeld)(null);
        },
      ),
    );
    // `held` only decides whether there is anything to animate; `visible` drives it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, level, progress]);
  const slide = useAnimatedStyle(() => ({
    opacity: panelHeight === 0 ? 0 : 1,
    transform: [{ translateY: panelHeight * (1 - progress.get()) }],
  }));
  const resolve = (expression: string) => {
    if (!config) return null;
    const result = evaluateAmountExpression(
      expression,
      config.currency,
      locale,
    );
    return result.kind === "value" ? result.text : null;
  };
  const result = config ? resolve(config.value) : null;

  const done = () => {
    if (!config) return;
    // A calculation still showing is finished, so the form is left holding a plain amount.
    if (result !== null) config.onChange(result);
    config.blur();
    setActive(null);
  };

  return (
    <CalculatorHostContext value={api}>
      <View style={{ flex: 1 }}>
        <View
          style={{ flex: 1 }}
          onTouchStart={(event) => {
            touch.current = {
              x: event.nativeEvent.pageX,
              y: event.nativeEvent.pageY,
              at: Date.now(),
            };
          }}
          onTouchEnd={onBodyTouchEnd}
        >
          {children}
        </View>
        {held ? (
          <Animated.View
            pointerEvents={visible ? "auto" : "none"}
            onLayout={(event) =>
              setPanelHeight(event.nativeEvent.layout.height)
            }
            style={slide}
          >
            <View
              ref={panelRef}
              collapsable={false}
              style={{
                borderTopLeftRadius: radius.sheet,
                borderTopRightRadius: radius.sheet,
                borderCurve: "continuous",
                boxShadow: "0 -4px 16px rgba(0,0,0,0.12)",
                paddingHorizontal: space.lg,
                paddingTop: space.xs,
                paddingBottom: Math.max(insets.bottom, space.md),
                gap: space.xs,
                borderTopWidth: 1,
                borderTopColor: theme.border,
                backgroundColor: theme.background,
              }}
            >
              <View style={{ alignItems: "flex-end" }}>
                <TextButton title="Done" icon="checkmark" onPress={done} />
              </View>
              <AmountKeypad
                value={held.config.value}
                onChange={held.config.onChange}
                locale={locale}
                result={result}
                resolve={resolve}
              />
            </View>
          </Animated.View>
        ) : null}
      </View>
    </CalculatorHostContext>
  );
}
