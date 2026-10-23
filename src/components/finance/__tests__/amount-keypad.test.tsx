import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AmountKeypad } from "@/components/finance/amount-keypad";

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
});
