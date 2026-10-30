import { act, renderHook } from "@testing-library/react-native";

import { useFormSheet } from "@/components/navigation/use-form-sheet";

type Prevented = (event: {
  data: { action: unknown };
  repeat: () => void;
}) => void;

let mockOnPrevented: Prevented | undefined;
let mockPrevent = false;
const mockConfirm = jest.fn<Promise<boolean>, []>();
const mockExit = jest.fn(async () => undefined);
const mockSetGuarded = jest.fn();

jest.mock("expo-router", () => ({
  router: { dismissTo: jest.fn(), replace: jest.fn() },
  useNavigation: () => ({ addListener: () => () => undefined }),
}));
jest.mock("expo-router/react-navigation", () => ({
  usePreventRemove: (prevent: boolean, onPrevented: Prevented) => {
    mockPrevent = prevent;
    mockOnPrevented = onPrevented;
  },
}));
jest.mock("@/components/navigation/sheet-shell-context", () => ({
  useSheetShell: () => ({ exit: mockExit, setGuarded: mockSetGuarded }),
}));
jest.mock("@/utils/confirm", () => ({
  confirmDestructive: () => mockConfirm(),
}));

const flush = () => act(async () => undefined);

describe("useFormSheet discard guard", () => {
  beforeEach(() => {
    mockConfirm.mockReset();
    mockExit.mockClear();
    mockOnPrevented = undefined;
  });

  it("guards only once the form differs from its first values", async () => {
    const view = await renderHook(
      ({ name }: { name: string }) =>
        useFormSheet({ ownerRoute: "/plan", values: { name } }),
      { initialProps: { name: "a" } },
    );
    expect(mockPrevent).toBe(false);
    await view.rerender({ name: "b" });
    expect(mockPrevent).toBe(true);
    expect(mockSetGuarded).toHaveBeenLastCalledWith(true);
  });

  it("asks once however many close attempts arrive while the prompt is open", async () => {
    let resolve: (confirmed: boolean) => void = () => undefined;
    mockConfirm.mockReturnValue(
      new Promise<boolean>((done) => {
        resolve = done;
      }),
    );
    const repeat = jest.fn();
    await renderHook(() => useFormSheet({ ownerRoute: "/plan", values: 1 }));
    const event = { data: { action: {} }, repeat };

    mockOnPrevented?.(event);
    mockOnPrevented?.(event);
    mockOnPrevented?.(event);
    expect(mockConfirm).toHaveBeenCalledTimes(1);

    await act(async () => resolve(false));
    expect(repeat).not.toHaveBeenCalled();

    // A cancelled prompt can be asked again.
    mockConfirm.mockResolvedValue(false);
    mockOnPrevented?.(event);
    await flush();
    expect(mockConfirm).toHaveBeenCalledTimes(2);
  });

  it("leaves through repeat, after the exit animation, once discard is confirmed", async () => {
    mockConfirm.mockResolvedValue(true);
    const repeat = jest.fn();
    await renderHook(() => useFormSheet({ ownerRoute: "/plan", values: 1 }));

    mockOnPrevented?.({ data: { action: {} }, repeat });
    await flush();

    expect(mockExit).toHaveBeenCalledTimes(1);
    expect(repeat).toHaveBeenCalledTimes(1);
  });
});
