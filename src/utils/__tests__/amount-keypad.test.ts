import { applyKeypadKey, type KeypadKey } from "@/utils/amount-keypad";

const context = {
  decimalSymbol: ".",
  resolve: (expression: string) => (expression === "2+3" ? "5" : null),
};
const press = (value: string, key: KeypadKey) =>
  applyKeypadKey(value, key, context);
const digit = (value: string): KeypadKey => ({ type: "digit", digit: value });
const operator = (value: "+" | "−" | "×" | "÷"): KeypadKey => ({
  type: "operator",
  operator: value,
});

describe("applyKeypadKey", () => {
  it("appends digits", () => {
    expect(press("1", digit("2"))).toBe("12");
  });

  it("ignores a leading operator", () => {
    expect(press("", operator("+"))).toBe("");
  });

  it("replaces a repeated operator instead of stacking it", () => {
    expect(press("5+", operator("×"))).toBe("5×");
  });

  it("allows one decimal separator per number", () => {
    expect(press("1.5", { type: "decimal" })).toBe("1.5");
    expect(press("1.5+2", { type: "decimal" })).toBe("1.5+2.");
  });

  it("does not stack leading zeros", () => {
    expect(press("0", digit("0"))).toBe("0");
  });

  it("backspace removes the last character", () => {
    expect(press("12", { type: "backspace" })).toBe("1");
  });

  it("equals collapses a complete expression and leaves others alone", () => {
    expect(press("2+3", { type: "equals" })).toBe("5");
    expect(press("2+", { type: "equals" })).toBe("2+");
  });
});
