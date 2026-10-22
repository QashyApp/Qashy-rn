import {
  applyKeypadKey,
  ExpressionBuffer,
  type KeypadKey,
} from "@/utils/amount-keypad";

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

describe("ExpressionBuffer", () => {
  const apply = (buffer: ExpressionBuffer, key: KeypadKey) => {
    const next = press(buffer.value, key);
    buffer.push(next);
    return next;
  };

  it("applies keys pressed before the prop has come back", () => {
    const buffer = new ExpressionBuffer("");
    apply(buffer, digit("1"));
    apply(buffer, digit("2"));
    apply(buffer, digit("3"));
    expect(buffer.value).toBe("123");
    apply(buffer, operator("+"));
    apply(buffer, digit("4"));
    apply(buffer, { type: "backspace" });
    apply(buffer, { type: "backspace" });
    apply(buffer, operator("×"));
    expect(buffer.value).toBe("123×");
  });

  it("keeps the newest text while earlier echoes arrive late", () => {
    const buffer = new ExpressionBuffer("");
    apply(buffer, digit("1"));
    apply(buffer, digit("2"));
    apply(buffer, digit("3"));
    buffer.reconcile("1");
    expect(buffer.value).toBe("123");
    buffer.reconcile("12");
    expect(buffer.value).toBe("123");
    buffer.reconcile("123");
    expect(buffer.value).toBe("123");
    apply(buffer, digit("4"));
    expect(buffer.value).toBe("1234");
  });

  it("copes with echoes that skip a value, and with repeated values", () => {
    const buffer = new ExpressionBuffer("");
    apply(buffer, digit("1"));
    apply(buffer, { type: "backspace" });
    apply(buffer, digit("1"));
    buffer.reconcile("1");
    buffer.reconcile("1");
    expect(buffer.value).toBe("1");
    apply(buffer, digit("2"));
    buffer.reconcile("12");
    expect(buffer.value).toBe("12");
  });

  it("takes a value changed from outside", () => {
    const buffer = new ExpressionBuffer("12");
    apply(buffer, digit("3"));
    buffer.reconcile("9");
    expect(buffer.value).toBe("9");
    apply(buffer, digit("1"));
    expect(buffer.value).toBe("91");
  });
});
