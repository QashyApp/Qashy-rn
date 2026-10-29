import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AmountKeypad } from "@/components/finance/amount-keypad";
import { hapticImpactLight, hapticSelection } from "@/services/haptics";

jest.mock("@/theme/theme", () => ({
  useQashyTheme: () =>
    ({
      ...(({ space, radius, tile, iconSize, motion, type }) => ({
        space,
        radius,
        tile,
        iconSize,
        motion,
        type,
      }))(jest.requireActual("@/theme/themes/classic").classicTheme),
      text: "#111111",
      textMuted: "#666666",
      accent: "#4040ff",
      onAccent: "#ffffff",
      accentContainer: "#ddddff",
      onAccentContainer: "#000044",
      surface: "#ffffff",
      surfaceMuted: "#eeeeee",
      materialControls: true,
    }) as never,
}));

jest.mock("@/localization/localization", () => ({
  useLocalization: () => ({
    t: (message: string) => message,
    isRtl: false,
    language: "en",
    locale: "en-US",
  }),
}));

jest.mock("@/services/haptics", () => ({
  hapticSelection: jest.fn(),
  hapticImpactLight: jest.fn(),
}));

const resolve = () => null;

/** A keypad whose prop only catches up when `flush` runs, like the field's round trip. */
function Harness({ onChange }: { onChange: (next: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <>
      <AmountKeypad
        value={value}
        onChange={(next) => {
          onChange(next);
          // Deliberately not applied here: the parent only re-renders on `flush`.
          pending.push(next);
        }}
        locale="en-US"
        result={null}
        resolve={resolve}
      />
      <FlushButton apply={(next) => setValue(next)} />
    </>
  );
}
const pending: string[] = [];
function FlushButton({ apply }: { apply: (next: string) => void }) {
  flush = () => {
    const [first] = pending.splice(0, 1);
    if (first !== undefined) apply(first);
  };
  return null;
}
let flush = () => {};

const key = (label: string) => screen.getByLabelText(label);
const tap = async (label: string) =>
  await fireEvent(key(label), "accessibilityAction", {
    nativeEvent: { actionName: "activate" },
  });

describe("AmountKeypad", () => {
  beforeEach(() => {
    pending.length = 0;
  });

  it("applies keys pressed faster than the value can come back", async () => {
    const onChange = jest.fn();
    await render(
      <GestureHandlerRootView>
        <Harness onChange={onChange} />
      </GestureHandlerRootView>,
    );
    await tap("1");
    await tap("2");
    await tap("3");

    expect(onChange.mock.calls.map(([next]) => next)).toEqual([
      "1",
      "12",
      "123",
    ]);
    await tap("plus");

    await act(async () => {
      flush();
    });
    // Late echoes of "1" must not rewind the expression.
    await tap("4");
    await tap("Delete last character");
    await tap("Multiply");

    expect(onChange.mock.calls.map(([next]) => next).slice(3)).toEqual([
      "123+",
      "123+4",
      "123+",
      "123×",
    ]);
  });

  describe("haptics", () => {
    beforeEach(() => {
      jest.mocked(hapticSelection).mockClear();
      jest.mocked(hapticImpactLight).mockClear();
    });
    const renderKeypad = (value: string, onChange = jest.fn()) =>
      render(
        <GestureHandlerRootView>
          <AmountKeypad
            value={value}
            onChange={onChange}
            locale="en-US"
            result={null}
            resolve={resolve}
          />
        </GestureHandlerRootView>,
      );

    it("ticks for a key that changes the amount, and stays silent for one that does nothing", async () => {
      await renderKeypad("");
      await tap("Delete last character");
      await tap("plus");
      expect(hapticSelection).not.toHaveBeenCalled();
      await tap("1");
      expect(hapticSelection).toHaveBeenCalledTimes(1);
    });

    it("clears with one heavier tap and not a second tick", async () => {
      const onChange = jest.fn();
      await renderKeypad("12", onChange);
      await fireEvent(key("Delete last character"), "accessibilityAction", {
        nativeEvent: { actionName: "clear" },
      });
      expect(onChange).toHaveBeenCalledWith("");
      expect(hapticImpactLight).toHaveBeenCalledTimes(1);
      expect(hapticSelection).not.toHaveBeenCalled();
    });

    it("does not buzz clearing an empty amount", async () => {
      await renderKeypad("");
      await fireEvent(key("Delete last character"), "accessibilityAction", {
        nativeEvent: { actionName: "clear" },
      });
      expect(hapticImpactLight).not.toHaveBeenCalled();
    });
  });

  it("offers clearing to a screen reader on the backspace key only", async () => {
    await render(
      <GestureHandlerRootView>
        <AmountKeypad
          value="1"
          onChange={jest.fn()}
          locale="en-US"
          result={null}
          resolve={resolve}
        />
      </GestureHandlerRootView>,
    );
    const names = (label: string) =>
      key(label).props.accessibilityActions.map(
        (action: { name: string }) => action.name,
      );
    expect(names("Delete last character")).toEqual(["activate", "clear"]);
    expect(names("7")).toEqual(["activate"]);
  });

  it("always holds the result key's place, but only offers it with a result", async () => {
    const hidden = { includeHiddenElements: true };
    const show = (result: string | null) => (
      <GestureHandlerRootView>
        <AmountKeypad
          value="2+3"
          onChange={jest.fn()}
          locale="en-US"
          result={result}
          resolve={resolve}
        />
      </GestureHandlerRootView>
    );
    const { rerender } = await render(show(null));
    // Present (so the panel does not grow when a result appears) but out of reach.
    const reserved = screen.getByLabelText(/^Calculate/, hidden);
    let node = reserved.parent;
    while (node && node.props.pointerEvents === undefined) node = node.parent;
    expect(node?.props.pointerEvents).toBe("none");
    expect(screen.queryByLabelText(/^Calculate/)).toBeNull();

    await rerender(show("5.00"));
    expect(screen.getByLabelText("Calculate, 5.00")).toBeTruthy();
  });
});
