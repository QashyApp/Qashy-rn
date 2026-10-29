import {
  fireEvent,
  render,
  renderHook,
  screen,
  act,
} from "@testing-library/react-native";
import { Keyboard, Text } from "react-native";

import {
  FilterToggle,
  SearchPillRow,
  useFiltersOpen,
} from "@/features/transactions/phone-header";

jest.mock("@/theme/theme", () => {
  const actual = jest.requireActual("@/theme/theme");
  return {
    ...actual,
    useQashyTheme: () => actual.accentTokens("#5966E9", false),
  };
});

jest.mock("@/localization/localization", () => ({
  useLocalization: () => ({
    t: (message: string) => message,
    isRtl: false,
    language: "en",
    locale: "en-US",
  }),
}));

jest.mock("@/services/haptics", () => ({ hapticSelection: jest.fn() }));

describe("useFiltersOpen", () => {
  it("starts shut, then keeps what was chosen for the rest of the session", async () => {
    const first = await renderHook(() => useFiltersOpen());
    expect(first.result.current.open).toBe(false);
    await act(async () => first.result.current.toggle());
    expect(first.result.current.open).toBe(true);
    await first.unmount();

    // Leaving the tab and coming back finds the filters as they were left.
    const second = await renderHook(() => useFiltersOpen());
    expect(second.result.current.open).toBe(true);
    await act(async () => second.result.current.toggle());
    expect(second.result.current.open).toBe(false);
    await second.unmount();

    const third = await renderHook(() => useFiltersOpen());
    expect(third.result.current.open).toBe(false);
  });
});

describe("FilterToggle", () => {
  const toggle = (props: { open: boolean; filterActive: boolean }) => (
    <FilterToggle {...props} onToggle={jest.fn()} />
  );

  it("offers to show the filters while they are shut", async () => {
    await render(toggle({ open: false, filterActive: false }));
    expect(
      screen.getByRole("button", { name: "Show filters", expanded: false }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hide filters" })).toBeNull();
  });

  it("offers to hide them while they are open", async () => {
    await render(toggle({ open: true, filterActive: false }));
    expect(
      screen.getByRole("button", { name: "Hide filters", expanded: true }),
    ).toBeTruthy();
  });

  it("presses through to the screen", async () => {
    const onToggle = jest.fn();
    await render(
      <FilterToggle open={false} filterActive={false} onToggle={onToggle} />,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Show filters" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("marks a filter that is on only while the row is shut", async () => {
    const { rerender } = await render(
      toggle({ open: false, filterActive: false }),
    );
    expect(screen.queryByTestId("filter-active-dot")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show filters" }).props,
    ).not.toHaveProperty("accessibilityHint");

    await rerender(toggle({ open: false, filterActive: true }));
    expect(screen.getByTestId("filter-active-dot")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show filters" })).toHaveProp(
      "accessibilityHint",
      "A filter is on",
    );

    // Open, the chips are in plain sight, so there is nothing to point out.
    await rerender(toggle({ open: true, filterActive: true }));
    expect(screen.queryByTestId("filter-active-dot")).toBeNull();
  });
});

describe("SearchPillRow", () => {
  const row = (
    props: { value?: string; allMonths?: boolean; onClear?: () => void } = {},
  ) => (
    <SearchPillRow
      switcher={<Text>Month bar</Text>}
      value={props.value ?? ""}
      allMonths={props.allMonths ?? false}
      onChangeText={jest.fn()}
      onClear={props.onClear ?? jest.fn()}
    />
  );
  const input = () => screen.getByLabelText("Search transactions");

  it("rests as a short pill beside the month bar", async () => {
    await render(row());
    expect(screen.getByText("Month bar")).toBeTruthy();
    expect(input()).toHaveProp("placeholder", "Search");
  });

  it("takes the row from the month bar on focus and gives it back on blur", async () => {
    await render(row());
    await fireEvent(input(), "focus");
    expect(screen.queryByText("Month bar")).toBeNull();
    expect(input()).toHaveProp("placeholder", "Search this month");

    await fireEvent(input(), "blur");
    expect(screen.getByText("Month bar")).toBeTruthy();
    expect(input()).toHaveProp("placeholder", "Search");
  });

  it("stays out while it holds text, even blurred", async () => {
    await render(row({ value: "rent" }));
    expect(screen.queryByText("Month bar")).toBeNull();
    await fireEvent(input(), "focus");
    await fireEvent(input(), "blur");
    expect(screen.queryByText("Month bar")).toBeNull();
    expect(screen.getByRole("button", { name: "Clear search" })).toBeTruthy();
  });

  it("says when the search reaches every month", async () => {
    await render(row({ allMonths: true }));
    await fireEvent(input(), "focus");
    expect(input()).toHaveProp("placeholder", "Search all months");
  });

  it("clears through its button", async () => {
    const onClear = jest.fn();
    await render(row({ value: "rent", onClear }));
    await fireEvent.press(screen.getByRole("button", { name: "Clear search" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("shrinks to the magnifier alone when the row leaves no room for a word", async () => {
    await render(row());
    await fireEvent(screen.getByText("Month bar").parent!.parent!, "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 288, height: 52 } },
    });
    expect(input()).toHaveProp("placeholder", "");
    await fireEvent(input(), "focus");
    expect(input()).toHaveProp("placeholder", "Search this month");
  });

  it("lets go of its focus when the keyboard goes away, as the back button leaves it", async () => {
    let hide: (() => void) | undefined;
    const remove = jest.fn();
    const listen = jest.spyOn(Keyboard, "addListener").mockImplementation(((
      name: string,
      handler: () => void,
    ) => {
      if (name === "keyboardDidHide") hide = handler;
      return { remove };
    }) as unknown as typeof Keyboard.addListener);
    try {
      const { unmount } = await render(row());
      await fireEvent(input(), "focus");
      expect(screen.queryByText("Month bar")).toBeNull();

      await act(async () => hide?.());
      expect(screen.getByText("Month bar")).toBeTruthy();
      expect(input()).toHaveProp("placeholder", "Search");

      await unmount();
      expect(remove).toHaveBeenCalled();
    } finally {
      listen.mockRestore();
    }
  });

  it("stays out with text in it when the keyboard goes away", async () => {
    let hide: (() => void) | undefined;
    const listen = jest.spyOn(Keyboard, "addListener").mockImplementation(((
      name: string,
      handler: () => void,
    ) => {
      if (name === "keyboardDidHide") hide = handler;
      return { remove: jest.fn() };
    }) as unknown as typeof Keyboard.addListener);
    try {
      await render(row({ value: "rent" }));
      await act(async () => hide?.());
      expect(screen.queryByText("Month bar")).toBeNull();
    } finally {
      listen.mockRestore();
    }
  });
});
