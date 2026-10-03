import {
  SUPPORTED_CURRENCY_CODES,
  convertMinor,
  currencyDigits,
  formatMoney,
  localizeDecimalString,
  minorToDecimalString,
  minorToLocalizedDecimalString,
  normalizeDecimalString,
  parseInvariantMoney,
  parseMoney,
} from "@/utils/money";

describe("money utilities", () => {
  it("round-trips regular and zero-decimal currencies", () => {
    expect(parseMoney("12.34", "USD")).toBe(1234);
    expect(parseMoney("1200", "JPY")).toBe(1200);
    expect(minorToDecimalString(1234, "USD")).toBe("12.34");
  });

  it("converts using decimal rates and rounds at the destination currency", () => {
    expect(convertMinor(1000, "EUR", "USD", "1.125")).toBe(1125);
  });

  it("formats signed currency values", () => {
    expect(formatMoney(1250, "USD", "en-US", { sign: true })).toContain("+");
  });

  it("formats large and zero-decimal amounts exactly", () => {
    expect(formatMoney(900719925474099, "USD")).toContain(
      "9,007,199,254,740.99",
    );
    expect(formatMoney(Number.MAX_SAFE_INTEGER, "USD")).toContain(
      "90,071,992,547,409.91",
    );
    expect(formatMoney(1200, "JPY")).toContain("1,200");
  });

  it("parses locale decimal separators without changing magnitude", () => {
    expect(parseMoney("12,50", "EUR", "de-DE")).toBe(1250);
    expect(parseMoney("1.234,56", "EUR", "de-DE")).toBe(123456);
    expect(parseMoney("1,250.50", "USD", "en-US")).toBe(125050);
    expect(() => parseMoney("12,50", "USD", "en-US")).toThrow("valid amount");
    expect(() => parseMoney("12.50", "EUR", "de-DE")).toThrow("valid amount");
    expect(minorToLocalizedDecimalString(1250, "EUR", "de-DE")).toBe("12,50");
  });

  it("keeps CSV amounts invariant while localizing decimal form fields", () => {
    expect(parseInvariantMoney("12.50", "EUR", "de-DE")).toBe(1250);
    expect(localizeDecimalString("1.125", "de-DE")).toBe("1,125");
    expect(normalizeDecimalString("1,125", "de-DE")).toBe("1.125");
  });

  it("rejects precision that the currency cannot persist", () => {
    expect(() => parseMoney("10.999", "USD")).toThrow(
      "at most 2 decimal places",
    );
    expect(() => parseInvariantMoney("10.999", "USD")).toThrow(
      "at most 2 decimal places",
    );
  });

  it("rejects malformed amounts", () => {
    expect(() => parseMoney("12,3,4", "EUR", "de-DE")).toThrow("valid amount");
  });

  it("pins minor-unit digits instead of trusting the runtime's ICU data", () => {
    // Synced devices must agree on what a stored integer means, whatever CLDR they ship.
    const expected: Record<string, number> = {
      USD: 2,
      EUR: 2,
      JPY: 0,
      KRW: 0,
      VND: 0,
      COP: 0,
      HUF: 0,
      IDR: 0,
      IQD: 0,
      KWD: 3,
      BHD: 3,
      TND: 3,
      ILS: 2,
    };
    for (const [code, digits] of Object.entries(expected)) {
      expect(currencyDigits(code)).toBe(digits);
      expect(currencyDigits(code, "he-IL")).toBe(digits);
      expect(currencyDigits(code.toLowerCase())).toBe(digits);
    }
    for (const code of SUPPORTED_CURRENCY_CODES) {
      expect([0, 2, 3]).toContain(currencyDigits(code));
    }
  });
});
