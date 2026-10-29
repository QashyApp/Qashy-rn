import {
  DECK_DIM,
  DECK_RECEDE,
  LIVELY_OVERSHOOT,
  MAX_SLIDE_ORDER,
  cappedOrder,
  deckLook,
  dampingRatio,
  followBase,
  followStep,
  followerFor,
  liveVelocity,
  livelySpring,
  maxLag,
  resolveSlideStyle,
  settleThreshold,
  stepSpring,
} from "@/components/ui/month-pager/slide-style";
import { commitSpring } from "@/components/ui/resolve-swipe";
import { classicTheme } from "@/theme/themes/classic";
import { highContrastTheme } from "@/theme/themes/high-contrast";

const FRAME = 1 / 60;

/** The page: a critically damped spring from `from` to 0, released at `velocity`; one value per frame. */
function pageTrack(from: number, velocity: number, frames = 120) {
  const spring = classicTheme.motion.spring.snappy;
  const stiff = { ...spring, stiffness: spring.stiffness * 1.6 };
  const omega = Math.sqrt(stiff.stiffness / stiff.mass);
  const out: number[] = [];
  let x = from;
  let v = velocity;
  for (let i = 0; i < frames; i++) {
    const next = stepSpring(x, v, FRAME, omega, 1);
    x = next.x;
    v = next.v;
    out.push(x);
  }
  return out;
}

describe("resolveSlideStyle", () => {
  it("reads the setting and falls back to cascade", () => {
    expect(resolveSlideStyle("deck", true)).toBe("deck");
    expect(resolveSlideStyle("page", true)).toBe("page");
    expect(resolveSlideStyle("calm", true)).toBe("calm");
    expect(resolveSlideStyle("cascade", true)).toBe("cascade");
    expect(resolveSlideStyle(undefined, true)).toBe("cascade");
    expect(resolveSlideStyle("sideways", true)).toBe("cascade");
  });

  it("is the plain page whenever content may not travel", () => {
    for (const style of ["cascade", "page", "deck", "calm", undefined]) {
      expect(resolveSlideStyle(style, false)).toBe("calm");
    }
  });
});

describe("livelySpring", () => {
  it("keeps the theme's stiffness and mass and overshoots by about three percent", () => {
    for (const theme of [classicTheme, highContrastTheme]) {
      const base = theme.motion.spring.snappy;
      const lively = livelySpring(base);
      expect(lively.stiffness).toBe(base.stiffness);
      expect(lively.mass).toBe(base.mass);
      const zeta = dampingRatio(lively);
      expect(zeta).toBeLessThan(1);
      const overshoot = Math.exp(
        (-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta),
      );
      expect(overshoot).toBeCloseTo(LIVELY_OVERSHOOT, 3);
    }
  });

  it("never adds damping back to a spring that is already calmer, and not past critical", () => {
    const calm = { damping: 40, stiffness: 400, mass: 1 };
    expect(livelySpring(calm).damping).toBe(40);
    const heavy = { damping: 90, stiffness: 400, mass: 1 };
    expect(dampingRatio(livelySpring(heavy))).toBe(1);
  });

  it("settles on the target at the overshoot it promises", () => {
    const lively = livelySpring({
      ...classicTheme.motion.spring.snappy,
      stiffness: classicTheme.motion.spring.snappy.stiffness * 1.6,
    });
    const omega = Math.sqrt(lively.stiffness / lively.mass);
    let x = -400;
    let v = 0;
    let peak = -Infinity;
    for (let i = 0; i < 120; i++) {
      ({ x, v } = stepSpring(x, v, FRAME, omega, dampingRatio(lively)));
      peak = Math.max(peak, x);
    }
    // The frame grid misses the exact peak by a hair.
    expect(peak / 400).toBeGreaterThan(0.025);
    expect(peak / 400).toBeLessThan(0.031);
    expect(Math.abs(x)).toBeLessThan(0.1);
  });
});

describe("stepSpring", () => {
  it("is independent of how the time is cut up", () => {
    const whole = stepSpring(-100, 300, 0.2, 30, 0.74);
    let x = -100;
    let v = 300;
    for (let i = 0; i < 20; i++) ({ x, v } = stepSpring(x, v, 0.01, 30, 0.74));
    expect(x).toBeCloseTo(whole.x, 6);
    expect(v).toBeCloseTo(whole.v, 4);
  });

  it("agrees across the critical damping boundary", () => {
    const under = stepSpring(-100, 0, 0.1, 30, 0.9999);
    const critical = stepSpring(-100, 0, 0.1, 30, 1);
    expect(under.x).toBeCloseTo(critical.x, 1);
  });
});

describe("settleThreshold and liveVelocity", () => {
  const spring = { stiffness: 672, mass: 0.72 };

  it("ends sooner for a short settle than the width-sized threshold did", () => {
    expect(settleThreshold(400, 0, spring)).toBeLessThan(
      settleThreshold(100, 0, spring),
    );
    // About a pixel's energy: a 1px-from-target spring is at the threshold.
    expect(settleThreshold(100, 0, spring)).toBeCloseTo((1 / 100) ** 2 * 2, 6);
  });

  it("is a valid threshold at the extremes", () => {
    expect(settleThreshold(0, 0, spring)).toBe(1);
    expect(settleThreshold(0.5, 0, spring)).toBe(1);
    expect(settleThreshold(1e6, 1e6, spring)).toBeGreaterThan(0);
  });

  it("caps a flick from a short distance and leaves a long one alone", () => {
    const omega = Math.sqrt(spring.stiffness / spring.mass);
    expect(liveVelocity(9000, 50, spring)).toBeCloseTo(omega * 50);
    expect(liveVelocity(-9000, 50, spring)).toBeCloseTo(-omega * 50);
    expect(liveVelocity(1500, 400, spring)).toBe(1500);
  });
});

describe("cascade followers", () => {
  const base = followBase(classicTheme.motion.spring.snappy);

  it("gets softer with each order and stops at the cap", () => {
    let last = Infinity;
    for (let order = 0; order <= MAX_SLIDE_ORDER; order++) {
      const { omega } = followerFor(order, base);
      expect(omega).toBeLessThan(last);
      last = omega;
    }
    expect(followerFor(40, base)).toEqual(followerFor(MAX_SLIDE_ORDER, base));
    expect(followerFor(-3, base)).toEqual(followerFor(0, base));
    expect(followerFor(Number.NaN, base)).toEqual(followerFor(0, base));
    expect(cappedOrder(2.9)).toBe(2);
  });

  it("derives from the theme and overshoots a little", () => {
    expect(base.omega).toBeGreaterThan(
      Math.sqrt(
        classicTheme.motion.spring.snappy.stiffness /
          classicTheme.motion.spring.snappy.mass,
      ),
    );
    expect(base.zeta).toBeLessThan(1);
    expect(followBase(highContrastTheme.motion.spring.snappy).omega).not.toBe(
      base.omega,
    );
  });

  it("limits the lag to a fraction of the page, within bounds", () => {
    expect(maxLag(100)).toBe(24);
    expect(maxLag(400)).toBeCloseTo(64);
    expect(maxLag(3000)).toBe(96);
  });

  it("trails a steadily moving page and stays inside the lag", () => {
    const { omega, zeta } = followerFor(0, base);
    let x = 0;
    let v = 0;
    // The page moves at 800 px/s; x is the item's distance from it.
    for (let i = 0; i < 120; i++) {
      ({ x, v } = followStep(x - 800 * FRAME, v, FRAME, omega, zeta, 64));
    }
    expect(x).toBeLessThan(0);
    expect(Math.abs(x)).toBeLessThanOrEqual(64);
    const lower = followerFor(6, base);
    let lowerX = 0;
    let lowerV = 0;
    for (let i = 0; i < 120; i++) {
      ({ x: lowerX, v: lowerV } = followStep(
        lowerX - 800 * FRAME,
        lowerV,
        FRAME,
        lower.omega,
        lower.zeta,
        64,
      ));
    }
    expect(Math.abs(lowerX)).toBeGreaterThan(Math.abs(x));
  });

  it("is at rest exactly, and arrives top to bottom", () => {
    // A release: the page settles from 300px at a flick, items follow; each item's own offset.
    const track = pageTrack(300, 1800);
    const arrival: number[] = [];
    for (let order = 0; order <= MAX_SLIDE_ORDER; order++) {
      const { omega, zeta } = followerFor(order, base);
      let item = track[0] * 0 + 300; // starts with the page, 300px from the end
      let v = 0;
      let seen = 0;
      let previous = 300;
      let overshoot = 0;
      for (let frame = 0; frame < 120; frame++) {
        const target = track[frame];
        const next = followStep(item - target, v, FRAME, omega, zeta, 64);
        item = target + next.x;
        v = next.v;
        overshoot = Math.max(overshoot, -item);
        if (Math.abs(item) >= 0.5) seen = frame + 1;
        previous = item;
      }
      expect(previous).toBeCloseTo(0, 6);
      expect(overshoot).toBeLessThan(0.05 * 300);
      arrival.push(seen);
    }
    // The frame each item last moved more than half a pixel from its place: the ripple runs down.
    for (let i = 1; i < arrival.length; i++)
      expect(arrival[i]).toBeGreaterThanOrEqual(arrival[i - 1] - 1);
    expect(arrival[MAX_SLIDE_ORDER]).toBeGreaterThanOrEqual(arrival[0] + 3);
  });

  it("is at rest within 350ms of the page landing, at every order", () => {
    for (const theme of [classicTheme, highContrastTheme]) {
      const themeBase = followBase(theme.motion.spring.snappy);
      for (const [from, velocity] of [
        [400, 0],
        [300, 1800],
        [120, 3000],
        [60, -900],
      ] as const) {
        const spring = theme.motion.spring.snappy;
        const stiff = { ...spring, stiffness: spring.stiffness * 1.6 };
        const omegaPage = Math.sqrt(stiff.stiffness / stiff.mass);
        // The page lands once within a pixel (the threshold the pager uses).
        let px: number = from;
        let pv: number = velocity;
        const track: number[] = [];
        let landing = -1;
        const energy = settleThreshold(from, velocity, stiff);
        const initial =
          0.5 * stiff.stiffness * from * from +
          0.5 * stiff.mass * velocity * velocity;
        for (let frame = 0; frame < 240; frame++) {
          ({ x: px, v: pv } = stepSpring(px, pv, FRAME, omegaPage, 1));
          track.push(px);
          const left =
            0.5 * stiff.stiffness * px * px + 0.5 * stiff.mass * pv * pv;
          if (landing < 0 && left / initial <= energy) landing = frame;
        }
        expect(landing).toBeGreaterThan(0);
        for (let order = 0; order <= MAX_SLIDE_ORDER; order++) {
          const { omega, zeta } = followerFor(order, themeBase);
          let item = from;
          let v = 0;
          let settled = -1;
          for (let frame = 0; frame < 240; frame++) {
            const target = frame <= landing ? track[frame] : 0;
            const next = followStep(item - target, v, FRAME, omega, zeta, 64);
            item = target + next.x;
            v = next.v;
            if (Math.abs(item) > 0.5 || Math.abs(v) > 2) settled = -1;
            else if (settled < 0) settled = frame;
          }
          expect(settled).toBeGreaterThanOrEqual(0);
          const afterLanding = Math.max(0, settled - landing) * FRAME * 1000;
          if (process.env.DEBUG_SETTLE)
            console.log(
              theme.id,
              from,
              velocity,
              order,
              landing,
              settled,
              afterLanding,
            );
          expect(afterLanding).toBeLessThanOrEqual(350);
        }
      }
    }
  });
});

describe("deckLook", () => {
  it("keeps the page at rest on top and in place", () => {
    expect(deckLook(0)).toEqual({ lead: 0, covered: 0, scale: 1, dim: 0 });
  });

  it("parks the next month off screen and slides it in with the drag", () => {
    expect(deckLook(1).lead).toBe(1);
    expect(deckLook(2).lead).toBe(1);
    expect(deckLook(0.25).lead).toBe(0.25);
    expect(deckLook(0.25).covered).toBe(0);
  });

  it("recedes and dims the page under it in proportion, and hides it once covered", () => {
    const half = deckLook(-0.5);
    expect(half.lead).toBe(0);
    expect(half.scale).toBeCloseTo(1 - DECK_RECEDE / 2);
    expect(half.dim).toBeCloseTo(DECK_DIM / 2);
    const covered = deckLook(-1);
    expect(covered.covered).toBe(1);
    expect(covered.scale).toBeCloseTo(0.94);
    expect(covered.dim).toBeCloseTo(0.4);
    expect(deckLook(-3).covered).toBe(1);
  });

  it("depends on the continuous position alone, whatever re-basing says", () => {
    // Page widths from the pager's position: (index - base) + translate * sign / width.
    const look = (index: number, base: number, tx: number, sign: 1 | -1) =>
      deckLook(index - base + (tx * sign) / 400);
    for (const sign of [1, -1] as const) {
      // A forward slide grabbed 70% across and landed: base moves on, translate is re-based.
      const before = (index: number) =>
        look(index, 10, -0.7 * 400 * sign, sign);
      const after = (index: number) => look(index, 11, 0.3 * 400 * sign, sign);
      for (const index of [9, 10, 11, 12]) {
        expect(after(index).lead).toBeCloseTo(before(index).lead, 9);
        expect(after(index).covered).toBeCloseTo(before(index).covered, 9);
      }
      // The page that arrives is the one on top, the one it covers recedes.
      expect(before(11).lead).toBeCloseTo(0.3);
      expect(before(10).covered).toBeCloseTo(0.7);
    }
  });
});

describe("commitSpring is still the calm settle", () => {
  it("is critically damped", () => {
    const calm = commitSpring(classicTheme.motion.spring.snappy);
    expect(dampingRatio(calm)).toBeCloseTo(1);
  });
});
