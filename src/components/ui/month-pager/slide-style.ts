import { MONTH_SLIDE_STYLES, type MonthSlideStyle } from "@/domain/models";
import type { SpringSpec } from "@/theme/themes/types";

/**
 * The arithmetic behind the month slide styles, kept apart from the gesture and animation plumbing
 * so it can be tested. The functions the UI thread calls are marked `worklet`; the rest runs once
 * per render.
 */

/** The style used when the setting is missing. */
export const DEFAULT_SLIDE_STYLE: MonthSlideStyle = "cascade";

/**
 * The style a pager actually plays. Without `travel` (Minimal, Off, the system's reduced motion)
 * every style is the plain page: the pager crossfades or cuts instead, and nothing moves per item.
 * A missing or unknown setting reads as the default.
 */
export function resolveSlideStyle(
  setting: string | undefined,
  travel: boolean,
): MonthSlideStyle {
  if (!travel) return "calm";
  return (
    MONTH_SLIDE_STYLES.find((style) => style === setting) ?? DEFAULT_SLIDE_STYLE
  );
}

// ── Springs ─────────────────────────────────────────────────────────────────

/** How far past its target a lively spring goes, as a fraction of the distance it travels. */
export const LIVELY_OVERSHOOT = 0.03;
/** The least distance (px) a settle is judged against, so an almost-done slide ends at once. */
const REST_PX = 1;

/** The damping ratio of a spring (1 is critically damped). */
export function dampingRatio(spring: SpringSpec) {
  return spring.damping / (2 * Math.sqrt(spring.stiffness * spring.mass));
}

/** The damping ratio of an underdamped spring whose first overshoot is `overshoot` of the travel. */
export function dampingRatioForOvershoot(overshoot: number) {
  const ln = Math.log(overshoot);
  return -ln / Math.sqrt(Math.PI * Math.PI + ln * ln);
}

/**
 * The theme's spring with just enough damping removed to overshoot by `LIVELY_OVERSHOOT`.
 * Stiffness and mass are the theme's own. A theme whose spring is already damped past that
 * (a stiff, calm one) keeps its own damping, so it overshoots by less, down to nothing at critical.
 */
export function livelySpring(spring: SpringSpec): SpringSpec {
  const ratio = Math.min(
    1,
    Math.max(dampingRatio(spring), dampingRatioForOvershoot(LIVELY_OVERSHOOT)),
  );
  return {
    ...spring,
    damping: ratio * 2 * Math.sqrt(spring.stiffness * spring.mass),
  };
}

/**
 * The energy threshold for a settle, so a spring stops once it is within about a pixel and moving
 * slowly (Reanimated compares the energy left with the energy it started with). A threshold sized
 * for the whole page width made a short settle run for a quarter of a second more than anyone
 * could see.
 */
export function settleThreshold(
  distance: number,
  velocity: number,
  spring: { stiffness: number; mass: number },
) {
  "worklet";
  const initial =
    0.5 * spring.stiffness * distance * distance +
    0.5 * spring.mass * velocity * velocity;
  if (initial <= 0) return 1;
  // Potential plus kinetic energy of a critically damped spring REST_PX from its target.
  const rest = spring.stiffness * REST_PX * REST_PX;
  return Math.min(1, Math.max(1e-9, rest / initial));
}

/**
 * A release velocity that cannot throw an underdamped spring far past its target: the speed is
 * capped at one spring period's worth of the distance left, which keeps the overshoot near the
 * spring's own (a hard flick from a short drag would otherwise swing a sixth of the page past).
 */
export function liveVelocity(
  velocity: number,
  distance: number,
  spring: { stiffness: number; mass: number },
) {
  "worklet";
  const cap = Math.sqrt(spring.stiffness / spring.mass) * distance;
  return Math.max(-cap, Math.min(cap, velocity));
}

// ── Cascade ─────────────────────────────────────────────────────────────────

/** Items from this order down all move alike, so the bottom of a long page is never sluggish. */
export const MAX_SLIDE_ORDER = 6;
/** How much softer each order is than the one above (the ripple's spacing). */
export const ORDER_SOFTENING = 0.17;
/** How much stiffer the top item's follow spring is than the theme's own snappy spring. */
const FOLLOW_STIFFNESS = 2;
/** After this long without the page moving every follower is at rest (ms). */
export const FOLLOW_IDLE_MS = 700;
/** The longest a follower trails the page, as a fraction of the page width and in px. */
const MAX_LAG_FRACTION = 0.16;
const MAX_LAG_PX = 96;
const MIN_LAG_PX = 24;

export interface FollowSpec {
  /** Natural frequency (rad/s) of the top item. */
  omega: number;
  /** Damping ratio shared by every item. */
  zeta: number;
}

/** The top item's follow spring, derived from the theme's own snappy spring. */
export function followBase(spring: SpringSpec): FollowSpec {
  const lively = livelySpring(spring);
  return {
    omega: FOLLOW_STIFFNESS * Math.sqrt(spring.stiffness / spring.mass),
    zeta: dampingRatio(lively),
  };
}

/** The order an item is moved by: whole, never negative, and capped. */
export function cappedOrder(order: number) {
  "worklet";
  if (!(order > 0)) return 0;
  return Math.min(MAX_SLIDE_ORDER, Math.floor(order));
}

/** The follow spring of the item at `order`: stiffer on top, softer and later further down. */
export function followerFor(order: number, base: FollowSpec): FollowSpec {
  const capped = cappedOrder(order);
  return {
    omega: base.omega / (1 + ORDER_SOFTENING * capped),
    zeta: base.zeta,
  };
}

/** How far (px) an item may trail its page. */
export function maxLag(width: number) {
  return Math.max(MIN_LAG_PX, Math.min(MAX_LAG_PX, width * MAX_LAG_FRACTION));
}

/**
 * Moves a spring `dt` seconds on: `x` is the distance from its target, `v` its speed, and the
 * result the same two, solved exactly so any frame time is stable. Under critical damping at most.
 */
export function stepSpring(
  x: number,
  v: number,
  dt: number,
  omega: number,
  zeta: number,
) {
  "worklet";
  if (zeta >= 1) {
    const envelope = Math.exp(-omega * dt);
    const push = v + omega * x;
    return {
      x: envelope * (x + push * dt),
      v: envelope * (v - omega * push * dt),
    };
  }
  const decay = zeta * omega;
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  const envelope = Math.exp(-decay * dt);
  const sin = Math.sin(damped * dt);
  const cos = Math.cos(damped * dt);
  const push = v + decay * x;
  const nextX = envelope * (x * cos + (push / damped) * sin);
  return {
    x: nextX,
    v: -decay * nextX + envelope * (push * cos - damped * x * sin),
  };
}

/**
 * One frame of an item following its page. `x` is the item's distance from the page's offset, `v`
 * its speed. The lag is clamped to `lag`: a follower pinned there stops pushing into the wall.
 */
export function followStep(
  x: number,
  v: number,
  dt: number,
  omega: number,
  zeta: number,
  lag: number,
) {
  "worklet";
  // Already at rest in its page (the tail of a run, after every item has snapped): nothing to solve.
  if (x === 0 && v === 0) return { x: 0, v: 0 };
  const next = stepSpring(x, v, dt, omega, zeta);
  let nextX = next.x;
  let nextV = next.v;
  if (Math.abs(nextX) > lag) {
    nextX = nextX < 0 ? -lag : lag;
    if (nextV * nextX > 0) nextV = 0;
  }
  // At rest within a hair: snap, so the item sits exactly in its page.
  if (Math.abs(nextX) < 0.05 && Math.abs(nextV) < 2) return { x: 0, v: 0 };
  return { x: nextX, v: nextV };
}

// ── Deck ────────────────────────────────────────────────────────────────────

/** How far the covered page shrinks by the time it is fully covered. */
export const DECK_RECEDE = 0.06;
/** How far the covered page dims (toward the background) by then. */
export const DECK_DIM = 0.4;

/**
 * The deck's look of a page `delta` months ahead of the pager's continuous position (the page at
 * rest is `0`, the next month `1`). Pages stack in month order, the later one on top: a page ahead
 * slides in from the edge (`lead`, in page widths, 1 parked off screen, 0 in place) and a page
 * behind stays put under it, shrinking and dimming (`covered`, 0 uncovered to 1 fully covered) as
 * the page above it arrives. It depends on the position alone, so the pager re-basing at a landing
 * changes nothing, and a drag back plays the same frames in reverse.
 */
export function deckLook(delta: number) {
  "worklet";
  const lead = Math.max(0, Math.min(1, delta));
  const covered = Math.max(0, Math.min(1, -delta));
  return {
    lead,
    covered,
    scale: 1 - DECK_RECEDE * covered,
    dim: DECK_DIM * covered,
  };
}

/**
 * What the deck draws of the page `distance` months from the pager's centre, with the pages dragged
 * `progress` page widths (negative toward the next month). On top of `deckLook`, a page more than a
 * slot away, a fully covered one and a fully parked one are `visible: false`: neither drawn nor hit.
 * The covered page is invisible but would still catch a tap, and the parked page's shadow would
 * bleed onto the page at rest. `zIndex` stacks the pages in month order.
 */
export function deckPage(distance: number, progress: number) {
  "worklet";
  const look = deckLook(distance + progress);
  return {
    ...look,
    visible: Math.abs(distance) <= 1 && look.covered < 1 && look.lead < 1,
    zIndex: Math.max(0, Math.min(2, distance + 1)),
  };
}
