import { budgetPace } from "@/utils/pace";
import { addRecurrence } from "@/utils/date";
import { occurrenceCountUntil } from "@/utils/recurrence-count";
import { normalizeDecimalString, parseMoney } from "@/utils/money";
import { normalizeFeePercent } from "@/utils/transaction-amounts";

describe("date recurrence bounds", () => {
  it("refuses a step past year 9999 with a RangeError", () => {
    expect(() => addRecurrence("9999-12-31", "day", 1)).toThrow(RangeError);
    expect(() => addRecurrence("9999-12-01", "month", 1)).toThrow(RangeError);
    expect(() => addRecurrence("9999-12-01", "year", 1)).toThrow(RangeError);
  });

  it("still steps within year 9999", () => {
    expect(addRecurrence("9999-11-30", "month", 1)).toBe("9999-12-30");
  });

  it("keeps a month-end anchor from drifting after February", () => {
    expect(addRecurrence("2026-02-28", "month", 1, "2026-01-30")).toBe(
      "2026-03-30",
    );
  });
});

describe("occurrenceCountUntil bounds", () => {
  it("stops at year 9999 instead of counting a string-sorted 10000 date", () => {
    expect(occurrenceCountUntil("9999-12-01", "month", 1, "9999-12-31")).toBe(
      1,
    );
    expect(occurrenceCountUntil("9999-12-30", "day", 1, "9999-12-31")).toBe(2);
  });
});

describe("budgetPace projection bounds", () => {
  it("clamps a projection that would exceed the safe-integer range", () => {
    const pace = budgetPace({
      spentMinor: 1e15,
      limitMinor: 1e15,
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31",
      today: "2026-05-01",
    });
    expect(Number.isSafeInteger(pace.projectedMinor)).toBe(true);
    expect(pace.projectedMinor).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("number input grouping", () => {
  it("accepts whitespace as a thousands separator in groups of three", () => {
    expect(parseMoney("1 234", "USD", "en-US")).toBe(123400);
    expect(parseMoney("12 345,67", "EUR", "fr-FR")).toBe(1234567);
  });

  it("rejects whitespace that is not a valid thousands grouping", () => {
    expect(() => parseMoney("12 50", "USD", "en-US")).toThrow(
      "Enter a valid amount.",
    );
    expect(() => parseMoney("1 2345,67", "EUR", "fr-FR")).toThrow(
      "Enter a valid amount.",
    );
    expect(() => parseMoney("1 234,5 6", "EUR", "fr-FR")).toThrow(
      "Enter a valid amount.",
    );
  });

  it("still reads a plain comma-grouped amount", () => {
    expect(parseMoney("1,234.50", "USD", "en-US")).toBe(123450);
  });
});

describe("fixed-point decimal output", () => {
  it("returns plain notation for tiny values", () => {
    expect(normalizeDecimalString("0.0000000089", "en-US")).toBe(
      "0.0000000089",
    );
    expect(normalizeDecimalString("0.00000008900", "en-US")).toBe(
      "0.000000089",
    );
    expect(normalizeDecimalString("-0", "en-US")).toBe("0");
  });

  it("returns plain notation for a tiny fee percentage", () => {
    expect(normalizeFeePercent("1e-7")).toBe("0.0000001");
    expect(normalizeFeePercent("2.50")).toBe("2.5");
  });
});
