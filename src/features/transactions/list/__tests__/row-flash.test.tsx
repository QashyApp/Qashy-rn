import { act, render } from "@testing-library/react-native";

import { RowFlash } from "@/features/transactions/list/row-flash";

let mockMotion = { instant: false, travel: true };
jest.mock("@/components/ui/motion", () => ({
  ...jest.requireActual("@/components/ui/motion/durations"),
  useMotionPreference: () => mockMotion,
}));

const DURATION = { fast: 100, base: 160, slow: 280 };
jest.mock("@/theme/theme", () => {
  const actual = jest.requireActual("@/theme/theme");
  const theme = actual.accentTokens("#5966E9", false);
  return {
    ...actual,
    useQashyTheme: () => ({
      ...theme,
      motion: { ...theme.motion, duration: DURATION },
    }),
  };
});

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

/** Mounts the flash and returns when `onDone` was called, in ms after mounting (or null). */
async function doneAfter(flashes: number, within = 5000) {
  const onDone = jest.fn();
  await render(<RowFlash flashes={flashes} onDone={onDone} />);
  for (let elapsed = 0; elapsed <= within; elapsed += 10) {
    if (onDone.mock.calls.length > 0) return elapsed;
    await act(() => {
      jest.advanceTimersByTime(10);
    });
  }
  return null;
}

describe("RowFlash", () => {
  it("pulses once per flash at full motion, with the theme's durations", async () => {
    mockMotion = { instant: false, travel: true };
    // Each pulse: base up, slow down; then a little slack.
    const one = await doneAfter(1);
    const three = await doneAfter(3);
    expect(one).toBeGreaterThanOrEqual(DURATION.base + DURATION.slow);
    expect(one).toBeLessThan(DURATION.base + DURATION.slow + 100);
    expect(three).toBeGreaterThanOrEqual(3 * (DURATION.base + DURATION.slow));
  });

  it("fades a single time at minimal motion, however many flashes were asked for", async () => {
    mockMotion = { instant: false, travel: false };
    const three = await doneAfter(3);
    expect(three).toBeGreaterThanOrEqual(DURATION.fast + DURATION.base);
    expect(three).toBeLessThan(DURATION.fast + DURATION.base + 100);
  });

  it("holds one still highlight with no motion, then lets the row go", async () => {
    mockMotion = { instant: true, travel: false };
    const three = await doneAfter(3);
    expect(three).toBeGreaterThanOrEqual(DURATION.slow * 3);
    expect(three).toBeLessThan(DURATION.slow * 3 + 100);
  });

  it("does nothing for a row that was not flashed", async () => {
    mockMotion = { instant: false, travel: true };
    expect(await doneAfter(0, 2000)).toBeNull();
  });
});
