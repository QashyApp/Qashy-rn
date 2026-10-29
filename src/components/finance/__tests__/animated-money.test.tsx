import { act, renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";

import {
  CountUpSubject,
  useAnimatedMinorAmount,
} from "@/components/finance/animated-money";
import { AnimationLevelContext } from "@/components/ui/animation-level-context";

jest.mock("@/theme/theme", () => ({
  useQashyTheme: () => ({
    motion: jest.requireActual("@/theme/themes/classic").classicTheme.motion,
  }),
}));

// The subject comes from a mutable holder so a rerender can change it.
const current = { subject: "2026-01-01" };

function setup(level: "all" | "off" = "all") {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AnimationLevelContext.Provider value={level}>
        <CountUpSubject subject={current.subject}>{children}</CountUpSubject>
      </AnimationLevelContext.Provider>
    );
  }
  return renderHook(
    ({ target }: { target: number; subject: string }) =>
      useAnimatedMinorAmount(target),
    { initialProps: { target: 1000, subject: "2026-01-01" }, wrapper: Wrapper },
  );
}

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

describe("useAnimatedMinorAmount", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    current.subject = "2026-01-01";
  });
  afterEach(() => jest.useRealTimers());

  async function update(
    hook: Awaited<ReturnType<typeof setup>>,
    target: number,
    subject: string,
  ) {
    current.subject = subject;
    await hook.rerender({ target, subject });
  }

  it("shows the target on first render", async () => {
    const hook = await setup();
    expect(hook.result.current).toBe(1000);
  });

  it("counts up within a month at once", async () => {
    const hook = await setup();
    await update(hook, 2000, "2026-01-01");
    await advance(100);
    expect(hook.result.current).toBeGreaterThan(1000);
    expect(hook.result.current).toBeLessThan(2000);
    await advance(400);
    expect(hook.result.current).toBe(2000);
  });

  it("holds the old value briefly, then counts to the new month", async () => {
    const hook = await setup();
    await update(hook, 5000, "2026-02-01");
    await advance(30);
    expect(hook.result.current).toBe(1000);
    await advance(100);
    expect(hook.result.current).toBeGreaterThan(1000);
    expect(hook.result.current).toBeLessThan(5000);
    await advance(400);
    expect(hook.result.current).toBe(5000);
  });

  it("restarts the wait on rapid month changes and ends on the latest value", async () => {
    const hook = await setup();
    await update(hook, 5000, "2026-02-01");
    await advance(40);
    await update(hook, 7000, "2026-03-01");
    await advance(40);
    await update(hook, 9000, "2026-04-01");
    await advance(40);
    expect(hook.result.current).toBe(1000);
    await advance(1000);
    expect(hook.result.current).toBe(9000);
  });

  it("starts from the displayed value when a change interrupts a count", async () => {
    const hook = await setup();
    await update(hook, 5000, "2026-02-01");
    await advance(160);
    const mid = hook.result.current;
    expect(mid).toBeGreaterThan(1000);
    await update(hook, 100, "2026-03-01");
    await advance(30);
    expect(hook.result.current).toBe(mid);
    await advance(800);
    expect(hook.result.current).toBe(100);
  });

  it("advances every counting figure from one shared frame callback", async () => {
    const raf = jest.spyOn(globalThis, "requestAnimationFrame");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AnimationLevelContext.Provider value="all">
        {children}
      </AnimationLevelContext.Provider>
    );
    const framesFor = async (figures: number) => {
      const hook = await renderHook(
        ({ target }: { target: number }) =>
          Array.from({ length: figures }, (_, index) =>
            useAnimatedMinorAmount(target * (index + 1)),
          ),
        { initialProps: { target: 1000 }, wrapper },
      );
      await hook.rerender({ target: 2000 });
      raf.mockClear();
      await advance(100);
      const frames = raf.mock.calls.length;
      const mid = hook.result.current;
      await advance(800);
      expect(hook.result.current).toEqual(
        Array.from({ length: figures }, (_, index) => 2000 * (index + 1)),
      );
      mid.forEach((value, index) => {
        expect(value).toBeGreaterThan(1000 * (index + 1));
        expect(value).toBeLessThan(2000 * (index + 1));
      });
      await hook.unmount();
      return frames;
    };
    const single = await framesFor(1);
    const many = await framesFor(5);
    // Five figures counting request no more frames than one: they share the loop.
    expect(single).toBeGreaterThan(0);
    expect(many).toBe(single);
    // Once every figure has landed the loop stops asking for frames.
    raf.mockClear();
    await advance(100);
    expect(raf).not.toHaveBeenCalled();
    raf.mockRestore();
  });

  it("snaps when animations are off", async () => {
    const hook = await setup("off");
    await update(hook, 5000, "2026-02-01");
    expect(hook.result.current).toBe(5000);
    await update(hook, 6000, "2026-02-01");
    expect(hook.result.current).toBe(6000);
  });
});
