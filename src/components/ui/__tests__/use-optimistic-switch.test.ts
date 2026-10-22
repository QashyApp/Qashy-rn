import { act, renderHook } from "@testing-library/react-native";

import {
  OPTIMISTIC_SWITCH_TIMEOUT_MS,
  useOptimisticSwitch,
} from "@/components/ui/use-optimistic-switch";

describe("useOptimisticSwitch", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("shows the toggled value immediately and forwards the change", async () => {
    const onValueChange = jest.fn();
    const { result } = await renderHook(
      ({ value }: { value: boolean }) =>
        useOptimisticSwitch(value, onValueChange),
      { initialProps: { value: false } },
    );
    await act(async () => {
      result.current.onValueChange(true);
    });
    expect(result.current.value).toBe(true);
    expect(onValueChange).toHaveBeenCalledWith(true);
  });

  it("follows the prop once it catches up and stays after the timeout", async () => {
    const { result, rerender } = await renderHook(
      ({ value }: { value: boolean }) => useOptimisticSwitch(value, undefined),
      { initialProps: { value: false } },
    );
    await act(async () => {
      result.current.onValueChange(true);
    });
    await rerender({ value: true });
    expect(result.current.value).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(OPTIMISTIC_SWITCH_TIMEOUT_MS * 2);
    });
    expect(result.current.value).toBe(true);
  });

  it("falls back to the prop when the save never lands", async () => {
    const { result } = await renderHook(() =>
      useOptimisticSwitch(false, undefined),
    );
    await act(async () => {
      result.current.onValueChange(true);
    });
    expect(result.current.value).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(OPTIMISTIC_SWITCH_TIMEOUT_MS - 1);
    });
    expect(result.current.value).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.value).toBe(false);
  });

  it("follows the prop when it changes for other reasons", async () => {
    const { result, rerender } = await renderHook(
      ({ value }: { value: boolean }) => useOptimisticSwitch(value, undefined),
      { initialProps: { value: false } },
    );
    await act(async () => {
      result.current.onValueChange(true);
    });
    await rerender({ value: true });
    await rerender({ value: false });
    expect(result.current.value).toBe(false);
  });
});
