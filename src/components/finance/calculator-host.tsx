import {
  createContext,
  useId,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { BackHandler, Modal, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AmountKeypad } from "@/components/finance/amount-keypad";
import { ActionButton } from "@/components/ui/action-button";
import { AppText } from "@/components/ui/app-text";
import {
  motionCurves,
  useMotionDurations,
  useMotionPreference,
} from "@/components/ui/motion";
import { useOverlay } from "@/components/ui/overlay-host";
import type { CurrencyCode } from "@/domain/models";
import { useLocalization } from "@/localization/localization";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import { evaluateAmountExpression } from "@/utils/amount-expression";
import { ExpressionBuffer } from "@/utils/amount-keypad";

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
 * that is sliding up) waits this long after the host mounts before the keypad opens. Dimming a sheet
 * mid-slide reads as a glitch. A field focused later opens the keypad on the same frame.
 */
const PRESENTATION_SETTLE_MS = 550;

/**
 * Gives a screen's amount fields the calculator keypad in place of the system keyboard.
 *
 * The keypad is a layer over the whole screen, not part of the screen's layout: it rises from the
 * bottom edge of the display (wherever the sheet holding the form happens to sit), the screen behind
 * it dims, and the form never resizes or scrolls underneath it. Because the form is covered, the
 * keypad shows the amount being typed itself. "Set amount", a tap on the dimmed screen, or back on
 * Android all finish the calculation and close it.
 *
 * Where the app has an overlay host (Android), the layer is drawn there, in the app's own window,
 * and stays mounted once it has been opened. A `Modal` would be a separate window on Android that
 * swallows every tap while it slides away and is rebuilt on each use, so the field could not be
 * tapped again for a moment after closing. On the web the layer is a `Modal`, a DOM portal that
 * touches pass through.
 */
export function CalculatorHost({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<{
    id: string;
    config: CalculatorFieldConfig;
  } | null>(null);
  const layerKey = useId();
  const mountedAt = useRef(0);
  useEffect(() => {
    mountedAt.current = Date.now();
  }, []);
  // With no motion there is no slide to wait for. `open` is a stable function, so it reads this.
  const { instant } = useMotionPreference();
  const instantRef = useRef(instant);
  useEffect(() => {
    instantRef.current = instant;
  }, [instant]);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(openTimer.current), []);

  const closeLayer = useCallback(() => setActive(null), []);
  const overlay = useOverlay();
  // Once opened, the layer stays in the overlay host (hidden) until this host unmounts, so a reopen
  // neither rebuilds nor re-measures it.
  const [opened, setOpened] = useState(false);
  if (active && !opened) setOpened(true);
  const config = active?.config;
  const layer = useMemo(
    () => (
      <CalculatorLayer
        config={config}
        onClose={closeLayer}
        windowed={Boolean(overlay)}
      />
    ),
    [config, closeLayer, overlay],
  );
  const modal = Boolean(config);
  useEffect(() => {
    if (!overlay || !opened) return;
    overlay.set(layerKey, { node: layer, modal });
  }, [overlay, opened, layerKey, layer, modal]);
  useEffect(() => {
    if (!overlay) return;
    return () => overlay.set(layerKey, null);
  }, [overlay, layerKey]);

  const api = useMemo<CalculatorHostApi>(
    () => ({
      open: (id, config) => {
        clearTimeout(openTimer.current);
        // The keypad does the typing, so the field gives up focus at once. Left focused, it would get
        // focus back when the layer closes (the web restores focus to what held it before), and that
        // would open the keypad again.
        config.blur();
        const wait = mountedAt.current + PRESENTATION_SETTLE_MS - Date.now();
        if (process.env.EXPO_OS === "web" || instantRef.current || wait <= 0) {
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
      {overlay ? null : layer}
    </CalculatorHostContext>
  );
}

function CalculatorLayer({
  config,
  onClose,
  windowed,
}: {
  config: CalculatorFieldConfig | undefined;
  onClose: () => void;
  /** True when the layer is drawn in the app's own window (it then outlives each use). */
  windowed: boolean;
}) {
  const theme = useQashyTheme();
  const { space, radius } = theme;
  const insets = useSafeAreaInsets();
  const { locale, t } = useLocalization();
  const { instant, travel } = useMotionPreference();
  const durations = useMotionDurations();

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
        // A windowed layer keeps its last keys and its measured height for the next use.
        if (finished && !show && !windowed) runOnJS(setHeld)(undefined);
      };
      // The theme's timing, with no overshoot: the panel is not dragged, so it just settles. It
      // arrives at the entrance time and leaves faster; at Minimal the durations are quick fades
      // and at `off` it jumps.
      progress.set(
        withTiming(
          show ? 1 : 0,
          {
            duration: instant ? 0 : show ? durations.enter : durations.exit,
            easing: show ? motionCurves.standard : motionCurves.exit,
            reduceMotion: instant ? ReduceMotion.Always : ReduceMotion.System,
          },
          settled,
        ),
      );
    },
    [instant, durations, progress, windowed],
  );
  useEffect(() => {
    wantVisible.current = visible;
    // Before the panel has been measured its first layout starts the slide (see `onLayout`).
    if (panelHeight.get() > 0) animate(visible);
  }, [visible, animate, panelHeight]);
  useEffect(() => {
    if (!held && !windowed) {
      panelHeight.set(0);
      progress.set(0);
    }
  }, [held, windowed, panelHeight, progress]);

  const scrim = useAnimatedStyle(() => ({ opacity: progress.get() }));
  // Without travel (Minimal) the panel stays in place and fades with the scrim instead of sliding.
  const slide = useAnimatedStyle(() => {
    const height = panelHeight.get();
    if (!travel)
      return { opacity: height === 0 ? 0 : progress.get(), transform: [] };
    return {
      opacity: height === 0 ? 0 : 1,
      transform: [{ translateY: height * (1 - progress.get()) }],
    };
  });

  // The keypad applies every key to this buffer and reconciles it with `held.value` as it renders, so
  // it holds the latest text even in the renders before a key's change comes back as `held.value`.
  const [buffer] = useState(() => new ExpressionBuffer(held?.value ?? ""));

  const resolve = (expression: string) => {
    if (!held) return null;
    const result = evaluateAmountExpression(expression, held.currency, locale);
    return result.kind === "value" ? result.text : null;
  };
  const result = held ? resolve(held.value) : null;

  const done = () => {
    if (!config) return;
    // A calculation still showing is finished, so the form is left holding a plain amount. It is read
    // from the buffer: "Set amount" tapped right after a key would otherwise finish the text before it.
    const finished = resolve(buffer.value);
    if (finished !== null) config.onChange(finished);
    config.blur();
    onClose();
  };

  // Back finishes the calculation, as a `Modal`'s back request did. It registers when the keypad
  // becomes visible, after the sheet underneath registered its own, and the latest listener is
  // called first, so back closes the keypad before it closes the sheet.
  const latestDone = useRef(done);
  useEffect(() => {
    latestDone.current = done;
  });
  useEffect(() => {
    if (!windowed || !visible) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        latestDone.current();
        return true;
      },
    );
    return () => subscription.remove();
  }, [windowed, visible]);

  if (!held) return null;
  const sheet = theme.materialControls
    ? { backgroundColor: theme.surfaceMuted }
    : materialStyle(theme, "overlay");
  const content = (
    <View
      pointerEvents={visible ? "auto" : "none"}
      // A hidden layer is off screen and out of reach of screen readers and touches.
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      accessibilityElementsHidden={!visible}
      style={windowed ? StyleSheet.absoluteFill : { flex: 1 }}
    >
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
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
            buffer={buffer}
          />
          <ActionButton title="Set amount" icon="checkmark" onPress={done} />
        </Animated.View>
      </View>
    </View>
  );
  if (windowed) return content;
  return (
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={done}
    >
      {content}
    </Modal>
  );
}
