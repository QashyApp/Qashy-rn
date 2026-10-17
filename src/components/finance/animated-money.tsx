import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { StyleSheet, Text, type TextProps, type TextStyle } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { useAnimationLevel } from "@/components/ui/animation-level-context";
import { AppText } from "@/components/ui/app-text";
import { useQashyTheme } from "@/theme/theme";
import type { CurrencyCode } from "@/domain/models";
import { formatMoney, formatMoneyParts } from "@/utils/money";

const COUNT_DURATION = 420;
/** A month change counts up more briefly, so it stays out of the way of the next swipe. */
const MONTH_COUNT_DURATION = 250;
/**
 * How long a new subject must hold still before its amounts start to count. The pager commits a
 * month only once the swipe has landed, so this only has to coalesce a run of quick swipes: each
 * new subject restarts it, and the run pays for one count instead of renders between swipes.
 */
const SUBJECT_SETTLE_DELAY = 60;
/** The month count re-renders the figure at most this often (about 30 per second). */
const MONTH_FRAME_INTERVAL = 33;

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * What the amounts beneath belong to, such as the month a screen shows. When it changes the
 * amounts keep showing what they showed, wait for the swipe to settle, then count briefly to the
 * new values. Changes within one subject count up at once.
 */
const CountUpSubjectContext = createContext<string | null>(null);

export function CountUpSubject({
  subject,
  children,
}: {
  subject: string;
  children: ReactNode;
}) {
  return (
    <CountUpSubjectContext.Provider value={subject}>
      {children}
    </CountUpSubjectContext.Provider>
  );
}

/**
 * Rolls a minor-unit amount toward its target so value changes read as motion
 * instead of a snap. The first render shows the target immediately; only
 * subsequent changes animate. Reduced motion always snaps.
 */
export function useAnimatedMinorAmount(target: number) {
  // A count-up is movement: it runs only at the full animation level.
  const systemReduced = useReducedMotion();
  const level = useAnimationLevel();
  const reduceMotion = systemReduced || level !== "all";
  const subject = useContext(CountUpSubjectContext);
  const subjectRef = useRef(subject);
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);
  // Set when the subject changes; cleared once the month count has started.
  const subjectChangedRef = useRef(false);
  const settleAtRef = useRef(0);

  useEffect(() => {
    const cancel = () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    cancel();
    if (subjectRef.current !== subject) {
      subjectRef.current = subject;
      subjectChangedRef.current = true;
      settleAtRef.current = Date.now() + SUBJECT_SETTLE_DELAY;
    }
    const from = displayRef.current;
    if (!mountedRef.current || reduceMotion || from === target) {
      mountedRef.current = true;
      subjectChangedRef.current = false;
      displayRef.current = target;
      setDisplay(target);
      return;
    }
    const run = () => {
      timerRef.current = null;
      const monthChange = subjectChangedRef.current;
      subjectChangedRef.current = false;
      const duration = monthChange ? MONTH_COUNT_DURATION : COUNT_DURATION;
      const start = Date.now();
      let lastPaint = start;
      const step = () => {
        const now = Date.now();
        const progress = Math.min(1, (now - start) / duration);
        if (
          progress < 1 &&
          monthChange &&
          now - lastPaint < MONTH_FRAME_INTERVAL
        ) {
          frameRef.current = requestAnimationFrame(step);
          return;
        }
        lastPaint = now;
        const value =
          progress >= 1
            ? target
            : Math.round(from + (target - from) * easeOutCubic(progress));
        displayRef.current = value;
        setDisplay(value);
        if (progress < 1) frameRef.current = requestAnimationFrame(step);
        else frameRef.current = null;
      };
      frameRef.current = requestAnimationFrame(step);
    };
    const wait = subjectChangedRef.current
      ? Math.max(0, settleAtRef.current - Date.now())
      : 0;
    if (wait > 0) timerRef.current = setTimeout(run, wait);
    else run();
    return cancel;
  }, [reduceMotion, target, subject]);

  // Reduced motion never shows an in-between value, not even for the frame before the effect.
  return reduceMotion ? target : display;
}

/** Variants that split into a full-size integer/sign plus a visually subordinate currency+fraction run by default. */
const SPLIT_BY_DEFAULT = new Set(["hero", "display", "money"]);

export type AnimatedMoneyVariant =
  | "hero"
  | "display"
  | "title"
  | "headline"
  | "body"
  | "caption"
  | "label"
  | "eyebrow"
  | "money"
  | "figure";

export function AnimatedMoney({
  minor,
  currency,
  locale,
  compact = false,
  sign = false,
  variant = "body",
  // `figure` defaults on: an `AnimatedMoney` is a money amount, so it always
  // renders digits in the numeric display face regardless of `variant`. Money
  // callers that genuinely need Rubik digits (there are none today) can still
  // opt out with `figure={false}`.
  figure = true,
  split,
  scale = 1,
  style,
  ...props
}: TextProps & {
  /** Multiplies the variant's font size and line height, for a figure that must fit a width. */
  scale?: number;
  minor: number;
  currency: CurrencyCode;
  locale: string;
  variant?: AnimatedMoneyVariant;
  muted?: boolean;
  /** Fixed-width digits. Implied by `display` and `money`; set it on the rest. */
  numeric?: boolean;
  /** Forces the numeric display face (Space Grotesk) and tabular digits. */
  figure?: boolean;
  compact?: boolean;
  sign?: boolean;
  /**
   * Renders the sign and integer at full size, with the currency symbol and
   * fractional digits shrunk and muted — a statement figure reads as "$1,204"
   * with ".50" as a footnote, not three equally loud tokens. Defaults to true
   * for `hero`/`display`/`money` (the sizes actually used as statement
   * figures) and false everywhere else.
   */
  split?: boolean;
}) {
  const theme = useQashyTheme();
  const display = useAnimatedMinorAmount(minor);
  // Assistive tech should read the settled amount, not the mid-count value.
  const accessibilityLabel = formatMoney(minor, currency, locale, {
    compact,
    sign,
  });
  const typeScale = theme.type.scale;
  const shouldSplit = split ?? SPLIT_BY_DEFAULT.has(variant);
  const scaledStyle =
    scale === 1
      ? style
      : [
          {
            fontSize: typeScale[variant].fontSize * scale,
            lineHeight: typeScale[variant].lineHeight * scale,
          },
          style,
        ];

  if (!shouldSplit) {
    return (
      <AppText
        accessibilityLabel={accessibilityLabel}
        // Always a formatted amount, never dictionary copy.
        literal
        variant={variant}
        figure={figure}
        style={scaledStyle}
        {...props}
      >
        {formatMoney(display, currency, locale, { compact, sign })}
      </AppText>
    );
  }

  const parts = formatMoneyParts(display, currency, locale, { compact, sign });
  // `money` sits closer to body text than `hero`/`display` do, so its minor
  // run only needs to step down a little to read as subordinate; the larger
  // statement figures need the bigger drop to keep the minor run from
  // competing with the integer.
  const minorScale = variant === "money" ? 0.75 : 0.6;
  // A caller-chosen color (e.g. on-accent text over an accent fill) must carry
  // through to the minor run; the theme's muted grey is unreadable there.
  const callerColor = StyleSheet.flatten(style)?.color;
  const minorStyle: TextStyle = {
    fontSize: typeScale[variant].fontSize * minorScale * scale,
    lineHeight: typeScale[variant].lineHeight * scale,
    color: callerColor ?? theme.textMuted,
    opacity: callerColor ? 0.78 : 1,
  };
  return (
    <AppText
      accessibilityLabel={accessibilityLabel}
      literal
      variant={variant}
      figure={figure}
      style={scaledStyle}
      {...props}
    >
      {parts.literalBefore}
      {parts.sign}
      {parts.currencyPosition === "before" ? (
        <Text style={minorStyle}>{parts.currency}</Text>
      ) : null}
      {parts.integer}
      <Text style={minorStyle}>{parts.fraction}</Text>
      {parts.literalAfter}
      {parts.currencyPosition === "after" ? (
        <Text style={minorStyle}>{parts.currency}</Text>
      ) : null}
    </AppText>
  );
}
